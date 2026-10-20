'use client';

import {
  trilhaDoItem,
  getAcao,
  dataDaTrilha,
  responsavelEfetivo,
  pendenciasProximaAcao,
  diffDays,
  fmtDataBR,
  TRILHA_LABEL,
} from '../lib/agenda.js';
import { hojeSP } from '../lib/tempo.js';
import { SITUACAO_LABEL } from '../lib/propostas.js';
import { origemDaAcao } from '../lib/automacao.js';

// RESUMO DA OPORTUNIDADE — a primeira coisa que o vendedor vê ao abrir. Só LÊ
// dados já registrados (nada é inferido nem gerado por IA); o que não foi
// informado aparece como "não informado". Cada informação aparece aqui uma vez:
// a edição fica nas seções abaixo, que não repetem estes campos.
// Abrir o WhatsApp daqui NÃO registra contato — só abre a conversa.

function nomeDe(meta, id) {
  if (!id) return null;
  const all = [...(meta?.users || []), ...(meta?.allUsers || [])];
  return all.find((u) => String(u.id) === String(id))?.name || `#${id}`;
}

function waLink(item) {
  if (item.whatsappUrl) return item.whatsappUrl;
  const d = String(item.telefone || '').replace(/\D+/g, '');
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith('55') && d.length >= 12 ? d : `55${d}`}`;
}

const CATEGORIA_LABEL = {
  efetivo: 'contato efetivo',
  tentativa: 'tentativa sem resposta',
  interno: 'registro interno',
  nao_informado: 'anotação (contato não classificado)',
};

function quandoTexto(dataStr, hoje) {
  if (!dataStr) return '';
  const d = diffDays(dataStr, hoje);
  if (d === 0) return 'hoje';
  if (d === 1) return 'ontem';
  if (d > 1) return `há ${d} dias`;
  return '';
}

function Linha({ rotulo, children, vazio }) {
  return (
    <div className="opp-campo">
      <div className="opp-label">{rotulo}</div>
      <div className={`opp-valor${vazio ? ' unknown' : ''}`}>{children}</div>
    </div>
  );
}

export default function OportunidadeResumo({
  item,
  meta,
  historico, // { carregando, ultimoContatoEfetivo, ultimaAtividade, atendimentoSemProximoPasso }
  propostas, // visão de propostas (ou null)
  onRegistrar,
  onAgendar,
  onAbrirProposta,
  onHistorico,
}) {
  const hoje = hojeSP();
  const trilha = trilhaDoItem(item);
  const acao = getAcao(item, trilha);
  const dataAcao = dataDaTrilha(item, trilha);
  const respAcao = responsavelEfetivo(item, trilha);
  const pend = pendenciasProximaAcao(item);
  const stage = (meta?.stages || []).find((s) => s.value === item.estagio);
  const ids = (item.responsavelIds || []).map(String).filter((id) => String(item.vendedorPosVenda || '') !== id || trilha === 'posVenda');
  const principal = ids[0] || null;
  const outros = ids.slice(1);
  const valor = Number(item.valorEstimado) > 0 ? Number(item.valorEstimado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : null;
  const assunto = item.oportunidade?.nome || item.produtoInteresse || null;
  const wa = waLink(item);
  const vig = propostas?.vigente || null;
  const naoClassificados = propostas ? propostas.arquivos.filter((a) => !propostas.docs.some((d) => d.arquivos.includes(a.assetId))).length : 0;

  const uce = historico?.ultimoContatoEfetivo || (item.ultimoContato ? { data: String(item.ultimoContato).slice(0, 10), fonte: 'coluna' } : null);
  const ua = historico?.ultimaAtividade || null;
  const ur = item.planoAcao?.ultimoResultado || null;

  return (
    <div className="drawer-section opp-resumo" data-testid="opp-resumo">
      <div className="opp-topo">
        <div className="opp-cliente">
          <div className="opp-empresa" data-testid="opp-empresa">
            {item.empresa || 'Empresa não identificada'}
            {item.empresaId ? '' : item.empresa ? <span className="opp-tag">texto livre, não vinculada</span> : null}
          </div>
          <div className="opp-assunto" data-testid="opp-assunto">
            Assunto: {assunto || <em className="unknown">não informado</em>}
          </div>
        </div>
        <span className="opp-estagio" style={{ background: stage?.color || '#9aa5af', color: stage?.textColor || '#fff' }}>
          {item.estagio || 'Sem estágio'}
        </span>
      </div>

      <div className="opp-grid">
        <Linha rotulo="Responsável" vazio={!principal}>
          {principal ? nomeDe(meta, principal) : 'não informado'}
          {outros.length > 0 && <span className="opp-sub"> + {outros.map((i) => nomeDe(meta, i)).join(', ')}</span>}
        </Linha>
        <Linha rotulo="Valor estimado" vazio={!valor}>
          {valor || 'não informado'}
        </Linha>
        <Linha rotulo={`Próxima ação · ${TRILHA_LABEL[trilha]}`} vazio={!acao.acao}>
          <span data-testid="opp-proxima-acao">
            {acao.acao || 'não informada'}
            {acao.compromissoCliente ? <span className="opp-tag combinado">combinado com o cliente</span> : null}
          </span>
          {acao.acao && (
            <div className="opp-sub" data-testid="opp-origem">
              Origem: {origemDaAcao(acao)?.rotulo}
              {acao.regra ? ` (regra ${acao.regra})` : ''}
            </div>
          )}
          <div className="opp-sub">
            {respAcao ? nomeDe(meta, respAcao) : 'sem responsável'} ·{' '}
            {dataAcao ? (
              <span className={dataAcao < hoje ? 'opp-atrasada' : ''}>
                {fmtDataBR(dataAcao)}
                {acao.hora ? ` às ${acao.hora}` : ''}
                {dataAcao < hoje ? ` (atrasada ${diffDays(dataAcao, hoje)}d)` : dataAcao === hoje ? ' (hoje)' : ''}
              </span>
            ) : (
              'sem data'
            )}
          </div>
          {pend.length > 0 && (
            <div className="opp-pendente" data-testid="opp-pendente">
              ⚠ pendente: falta {pend.join(', ')}
            </div>
          )}
        </Linha>
        <Linha rotulo="Prazo previsto de compra" vazio={!item.prazoCompra}>
          {item.prazoCompra ? fmtDataBR(String(item.prazoCompra).slice(0, 10)) : 'não informado'}
        </Linha>
        <Linha rotulo="Principal impedimento" vazio={!item.principalImpedimento}>
          {item.principalImpedimento || 'não informado'}
        </Linha>
        <Linha rotulo="Último contato efetivo" vazio={!uce}>
          <span data-testid="opp-ultimo-contato">
            {uce ? (
              <>
                {fmtDataBR(uce.data)} <span className="opp-sub">({quandoTexto(uce.data, hoje) || '—'}{uce.canal ? ` · ${uce.canal}` : ''})</span>
              </>
            ) : historico?.carregando ? (
              'carregando…'
            ) : (
              'nenhum registrado'
            )}
          </span>
        </Linha>
        <Linha rotulo="Última atividade" vazio={!ua && !ur}>
          <span data-testid="opp-ultima-atividade">
            {ua ? (
              <>
                {ua.data ? fmtDataBR(ua.data) : ''}{' '}
                <span className="opp-sub">
                  ({CATEGORIA_LABEL[ua.categoria] || ua.categoria}
                  {ua.canal ? ` · ${ua.canal}` : ''}
                  {ua.autor ? ` · ${ua.autor}` : ''})
                </span>
              </>
            ) : ur ? (
              <>
                {fmtDataBR(ur.data)} <span className="opp-sub">({ur.contatoRealizado ? 'contato efetivo' : 'sem contato efetivo'} · {ur.canal})</span>
              </>
            ) : historico?.carregando ? (
              'carregando…'
            ) : (
              'nenhuma registrada'
            )}
          </span>
          {historico?.atendimentoSemProximoPasso && <div className="opp-pendente">⚠ o último atendimento ficou sem próximo passo</div>}
        </Linha>
        <Linha rotulo="Proposta vigente" vazio={!vig}>
          <span data-testid="opp-proposta-vigente">
            {vig ? (
              <>
                {vig.titulo} <span className="opp-tag">{SITUACAO_LABEL[vig.situacao]}</span>
                {vig.data ? <span className="opp-sub"> · {fmtDataBR(vig.data)}</span> : null}
              </>
            ) : propostas ? (
              propostas.docs.length > 0 ? 'nenhuma marcada como vigente' : 'nenhuma proposta registrada'
            ) : (
              'não disponível'
            )}
          </span>
          {naoClassificados > 0 && <div className="opp-sub">{naoClassificados} arquivo(s) anexado(s) ainda sem classificação</div>}
        </Linha>
      </div>

      <div className="opp-acoes">
        {wa ? (
          <a className="btn btn-secondary" href={wa} target="_blank" rel="noreferrer" title="Só abre a conversa — não registra contato">
            💬 Abrir WhatsApp
          </a>
        ) : (
          <button type="button" className="btn btn-secondary" disabled title="Sem telefone/WhatsApp cadastrado">
            💬 Abrir WhatsApp
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={onRegistrar} data-testid="acao-registrar-atendimento">
          ✅ Registrar atendimento
        </button>
        <button type="button" className="btn btn-secondary" onClick={onAgendar} data-testid="acao-agendar">
          📅 Agendar próximo passo
        </button>
        <button type="button" className="btn btn-secondary" onClick={onAbrirProposta} disabled={!vig || !vig.arquivosInfo?.some((a) => !a.removido)} data-testid="acao-abrir-proposta">
          📄 Abrir proposta vigente
        </button>
        <button type="button" className="btn btn-secondary" onClick={onHistorico} data-testid="acao-historico">
          🕑 Histórico completo
        </button>
      </div>
      <p className="opp-nota">Abrir o WhatsApp, editar o cadastro ou ver uma proposta não registram contato efetivo.</p>
    </div>
  );
}
