'use client';

import { useMemo, useState } from 'react';
import { calcularPrioridades, PESOS, SCORE_MINIMO, valorConhecido } from '../lib/prioridades.js';
import {
  TRILHAS,
  getAcao,
  dataDaTrilha,
  responsavelEfetivo,
  fmtDataCurta,
  toLocalDateStr,
} from '../lib/agenda.js';

const VISIVEIS = 8;

function fmtMoney(n) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

// "Minhas prioridades de hoje" — lista objetiva das oportunidades de vendas
// ativas que merecem atenção agora, com o MOTIVO de cada uma. Os leads que
// chegam aqui já passaram pelos mesmos filtros do resto da tela (responsável,
// segmento, canal, busca, período) — o título diz o escopo de verdade, em vez
// de chamar de "minhas" uma lista que é da equipe inteira.
export default function PrioridadesHoje({
  items,
  usersById,
  responsavelFiltro,
  meuId,
  onSelect,
  onConcluirAtividade,
  onFiltrarMeus,
  onLimparResponsavel,
  outrasTrilhas, // { reativacaoHoje, reativacaoVencidas, posVendaAtrasados, posVendaHoje }
  onIrParaTrilha,
}) {
  const hojeStr = useMemo(() => toLocalDateStr(), []);
  const { itens, totalAtivos, totalComCompromisso } = useMemo(
    () => calcularPrioridades(items, hojeStr),
    [items, hojeStr]
  );
  const [verTodas, setVerTodas] = useState(false);
  const visiveis = verTodas ? itens : itens.slice(0, VISIVEIS);

  const souEu = responsavelFiltro && String(responsavelFiltro) === String(meuId);
  const nomeFiltro = responsavelFiltro ? usersById[responsavelFiltro]?.name || `#${responsavelFiltro}` : null;
  const titulo = souEu
    ? 'Minhas prioridades de hoje'
    : nomeFiltro
      ? `Prioridades de hoje — ${nomeFiltro}`
      : 'Prioridades de hoje — equipe inteira';

  const nomeResp = (it) => {
    const id = responsavelEfetivo(it, TRILHAS.VENDAS);
    return id ? usersById[id]?.name?.split(' ')[0] || null : null;
  };

  return (
    <div className="metrics-section prio-panel" data-testid="prioridades-hoje">
      <h3>{titulo}</h3>
      <p className="prio-sub">
        {totalAtivos} oportunidade(s) ativa(s) neste escopo · {totalComCompromisso} com próxima ação vencida ou para
        hoje · mostrando só o que merece atenção agora.
        {!responsavelFiltro && meuId && (
          <>
            {' '}
            <button className="btn-link" onClick={onFiltrarMeus} style={{ fontWeight: 700 }}>
              Ver só as minhas
            </button>
          </>
        )}
        {souEu && (
          <>
            {' '}
            <button className="btn-link" onClick={onLimparResponsavel} style={{ fontWeight: 700 }}>
              Ver equipe inteira
            </button>
          </>
        )}
      </p>

      {itens.length === 0 && (
        <div className="agenda-empty">Nada urgente neste escopo. 🎉 Confira a lista abaixo para o que vem a seguir.</div>
      )}

      <div className="prio-list">
        {visiveis.map((p, idx) => {
          const it = p.item;
          const acao = getAcao(it, TRILHAS.VENDAS);
          const data = dataDaTrilha(it, TRILHAS.VENDAS);
          const valor = valorConhecido(it);
          const resp = nomeResp(it);
          return (
            <div
              key={it.id}
              className={`prio-card${p.compromisso ? ' has-commitment' : ''}`}
              title={`Pontuação interna: ${p.score}`}
            >
              <div className="prio-rank">{idx + 1}</div>
              <div className="prio-main">
                <div className="prio-head">
                  <div>
                    <span className="prio-name" onClick={() => onSelect(it.id)}>
                      {it.name}
                    </span>{' '}
                    <span className="chip">{it.estagio || 'sem estágio'}</span>
                    {it.empresa && <div className="prio-empresa">{it.empresa}</div>}
                  </div>
                  {valor !== null ? (
                    <span className="prio-valor">{fmtMoney(valor)}</span>
                  ) : (
                    <span className="prio-valor unknown">valor não informado</span>
                  )}
                </div>

                {acao.acao ? (
                  <div className="prio-next">
                    → <strong>{acao.acao}</strong>
                    {resp ? ` · ${resp}` : ''}
                    {data ? ` · ${fmtDataCurta(data)}` : ''}
                  </div>
                ) : (
                  <div className="prio-next missing">⚠ Falta definir a próxima ação (ação concreta, responsável e data).</div>
                )}

                <ul className="prio-motivos" aria-label="Motivos da prioridade">
                  {p.motivos.map((m, i) => (
                    <li key={i} className={i === 0 && p.compromisso ? 'top' : ''}>
                      {m.texto}
                    </li>
                  ))}
                </ul>
                {p.desconhecidos.length > 0 && (
                  <div className="prio-unknown">Não informado: {p.desconhecidos.map((d) => d.replace(/ não informado$/, '')).join(' · ')}</div>
                )}

                <div className="prio-actions">
                  <button className="btn-mini" onClick={() => onSelect(it.id)}>
                    Abrir lead
                  </button>
                  <button className="btn-mini" onClick={() => onConcluirAtividade(it.id)}>
                    ✅ Registrar atividade
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {itens.length > VISIVEIS && (
        <div className="prio-more">
          <button className="btn btn-secondary" onClick={() => setVerTodas((v) => !v)}>
            {verTodas ? 'Mostrar menos' : `Ver todas (${itens.length})`}
          </button>
        </div>
      )}

      {outrasTrilhas &&
        (outrasTrilhas.posVendaAtrasados + outrasTrilhas.posVendaHoje + outrasTrilhas.reativacaoVencidas + outrasTrilhas.reativacaoHoje > 0) && (
          <div className="prio-others">
            {outrasTrilhas.posVendaAtrasados + outrasTrilhas.posVendaHoje > 0 && (
              <button onClick={() => onIrParaTrilha('posVenda')}>
                📞 Pós-venda: {outrasTrilhas.posVendaAtrasados} atrasado(s) · {outrasTrilhas.posVendaHoje} hoje
              </button>
            )}
            {outrasTrilhas.reativacaoVencidas + outrasTrilhas.reativacaoHoje > 0 && (
              <button onClick={() => onIrParaTrilha('reativacao')}>
                🔁 Reativação: {outrasTrilhas.reativacaoVencidas} prevista(s) · {outrasTrilhas.reativacaoHoje} hoje
              </button>
            )}
          </div>
        )}

      <details className="prio-criteria">
        <summary>Como esta lista é montada</summary>
        <p style={{ margin: '6px 0' }}>
          Cada oportunidade soma pontos por critério; um compromisso assumido com o cliente pesa mais que o valor. Campo
          em branco é tratado como desconhecido: não soma nem desconta ponto. Entra na lista quem tem próxima ação
          vencida/para hoje ou pelo menos {SCORE_MINIMO} pontos.
        </p>
        <table className="metrics-table">
          <tbody>
            <tr><td>Próxima ação para hoje</td><td>{PESOS.compromissoHoje} pts</td></tr>
            <tr><td>Próxima ação vencida</td><td>{PESOS.compromissoVencidoBase} + {PESOS.compromissoVencidoPorDia}/dia de atraso (até +{PESOS.compromissoVencidoMaxExtra})</td></tr>
            <tr><td>Combinado com o cliente (junto de ação vencida/de hoje)</td><td>+{PESOS.combinadoComCliente} pts</td></tr>
            <tr><td>Estágio (Em Negociação / Proposta / Qualificado / Lead)</td><td>{PESOS.estagio['Em Negociação']} / {PESOS.estagio['Proposta Enviada']} / {PESOS.estagio['Qualificado']} / {PESOS.estagio['Lead']} pts</td></tr>
            <tr><td>Valor estimado (de R$ 1 até R$ 1 mi+)</td><td>2 a {PESOS.valor[0].pontos} pts</td></tr>
            <tr><td>Prazo de compra (vencido / ≤30d / ≤60d / ≤90d)</td><td>{PESOS.prazoVencido} / {PESOS.prazo30} / {PESOS.prazo60} / {PESOS.prazo90} pts</td></tr>
            <tr><td>Cliente abriu ou baixou a proposta (últimos 3 dias)</td><td>+{PESOS.propostaAbertaRecente} pts</td></tr>
            <tr><td>Proposta enviada há 3+ dias e não aberta</td><td>+{PESOS.propostaSemAbertura} pts</td></tr>
            <tr><td>Lead sem nenhum contato (dentro do SLA de 24h / SLA vencido)</td><td>{PESOS.nuncaContatadoLead} / {PESOS.nuncaContatadoLeadSlaVencido} pts</td></tr>
            <tr><td>Outros estágios: nenhum contato registrado / sem contato há mais de 14 dias / há 8–14 dias</td><td>{PESOS.nuncaContatadoOutros} / {PESOS.semContato14} / {PESOS.semContato8} pts</td></tr>
          </tbody>
        </table>
      </details>
    </div>
  );
}
