'use client';

import { useEffect, useState } from 'react';
import { fmtDataBR } from '../lib/agenda.js';

// VISÃO SEMANAL DO GESTOR (aba Gerencial, só administrador). Só leitura: lista as
// oportunidades por critério, com o critério escrito na tela. "Sem registro" quer
// dizer que o CRM não tem o registro — não prova que não houve atendimento.
const SECOES = [
  { chave: 'semProximaAcao', titulo: 'Ativas sem próxima ação' },
  { chave: 'compromissosVencidos', titulo: 'Compromissos vencidos' },
  { chave: 'propostasSemAvanco', titulo: 'Propostas sem avanço' },
  { chave: 'compras30', titulo: 'Compras previstas — 30 dias' },
  { chave: 'compras60', titulo: 'Compras previstas — 60 dias' },
  { chave: 'passagemPosVenda', titulo: 'Passagem para pós-venda pendente' },
];

function detalhe(chave, x) {
  switch (chave) {
    case 'semProximaAcao':
      return x.ultimoContato ? `último contato registrado: ${fmtDataBR(x.ultimoContato)}` : 'nenhum contato efetivo registrado';
    case 'compromissosVencidos':
      return `${x.acao || 'ação combinada'} — era para ${fmtDataBR(x.data)} (${x.diasAtraso} dia${x.diasAtraso > 1 ? 's' : ''} de atraso)`;
    case 'propostasSemAvanco':
      return `enviada em ${fmtDataBR(x.enviadoEm)} (${x.dias} dias; fonte: ${x.fonteEnvio})`;
    case 'compras30':
    case 'compras60':
      return `prazo ${fmtDataBR(x.prazo)} · impedimento: ${x.impedimento || 'não informado'} · próxima ação: ${x.proximaAcao ? `${x.proximaAcao.acao}${x.proximaAcao.data ? ` em ${fmtDataBR(x.proximaAcao.data)}` : ''}` : 'nenhuma'}`;
    case 'passagemPosVenda':
      return `${x.semAcao ? 'sem ação de pós-venda' : ''}${x.semAcao && x.semVendedor ? ' · ' : ''}${x.semVendedor ? 'sem vendedor de pós-venda' : ''}${x.fechadoEm ? ` · fechada em ${fmtDataBR(x.fechadoEm)}` : ''}`;
    default:
      return '';
  }
}

export default function AcompanhamentoSemanal({ usersById = {}, onSelect }) {
  const [resp, setResp] = useState('');
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [aberta, setAberta] = useState('semProximaAcao');

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(`/api/automacao/semana${resp ? `?responsavelId=${encodeURIComponent(resp)}` : ''}`);
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || 'Não foi possível carregar a visão semanal.');
        if (vivo) {
          setDados(j);
          setErro('');
        }
      } catch (e) {
        if (vivo) setErro(e.message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [resp]);

  return (
    <div className="metrics-section" data-testid="semana-gestor">
      <h3>Acompanhamento comercial da semana</h3>
      <p className="acao-help">
        Leitura do que existe no CRM hoje. Cada lista mostra o critério usado; "sem registro" não é prova de que não houve atendimento.
      </p>
      <div className="field-row">
        <div className="field">
          <label>Responsável</label>
          <select value={resp} onChange={(e) => setResp(e.target.value)} aria-label="Filtrar visão semanal por responsável">
            <option value="">Todos</option>
            {Object.values(usersById).map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
          </select>
        </div>
      </div>
      {erro && <div className="schema-warning" role="alert">{erro}</div>}
      {dados && (
        <>
          <div className="semana-grid">
            {SECOES.map((s) => (
              <button key={s.chave} type="button" className={`semana-card${aberta === s.chave ? ' ativo' : ''}`} onClick={() => setAberta(s.chave)} data-testid={`semana-${s.chave}`}>
                <div className="n">{dados[s.chave].length}</div>
                <div className="t">{s.titulo}</div>
              </button>
            ))}
          </div>
          <div className="opp-sub" data-testid="semana-criterio">Critério: {dados.criterios[aberta]}{aberta === 'propostasSemAvanco' ? ` (limite configurado: ${dados.diasPropostaSemAvanco} dias)` : ''}</div>
          {dados[aberta].length === 0 && <div className="agenda-empty">Nenhuma oportunidade neste critério.</div>}
          {dados[aberta].map((x) => (
            <div className="agenda-row" key={`${aberta}-${x.itemId}`} onClick={() => onSelect?.(x.itemId)}>
              <div className="agenda-row-main">
                <div className="agenda-row-name">{x.nome}</div>
                <div className="agenda-row-sub">
                  {x.estagio} · {(x.responsavelIds || []).map((id) => usersById[id]?.name || `#${id}`).join(', ') || 'sem responsável'}
                </div>
                <div className="agenda-row-next">{detalhe(aberta, x)}</div>
              </div>
              <div className="agenda-row-right"><span className="agenda-row-label">Abrir</span></div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
