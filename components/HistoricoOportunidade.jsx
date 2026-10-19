'use client';

import { useState } from 'react';
import { fmtDataHoraSP } from '../lib/tempo.js';
import { fmtDataBR } from '../lib/agenda.js';

// HISTÓRICO CRONOLÓGICO UNIFICADO — anotações, atendimentos, tentativas, envios
// e visualizações estimadas de proposta, entradas em estágio. Só exibe o que está
// registrado: "quando aconteceu" ausente aparece como "não informado" (nunca é
// inventado) e é sempre diferente de "quando foi registrado".

const ROTULO_TIPO = {
  atendimento: 'Atendimento',
  nota: 'Anotação',
  arquivo: 'Arquivo anexado',
  arquivo_removido: 'Arquivo removido',
  proposta: 'Proposta',
  proposta_envio: 'Proposta enviada',
  proposta_visualizacao: 'Interação com a proposta',
  estagio: 'Estágio',
  handoff: 'Entrega (handoff)',
  vinculo: 'Empresa/contato',
  criacao: 'Criação',
};

const ICONE = {
  atendimento: '✅',
  nota: '📝',
  arquivo: '📎',
  arquivo_removido: '🗑️',
  proposta: '📑',
  proposta_envio: '📤',
  proposta_visualizacao: '👁️',
  estagio: '🏷️',
  handoff: '🤝',
  vinculo: '🏢',
  criacao: '🆕',
};

const BADGE = {
  efetivo: { texto: 'Contato efetivo', cls: 'ok' },
  tentativa: { texto: 'Tentativa sem resposta', cls: 'warn' },
  interno: { texto: 'Interno', cls: 'muted' },
  nao_informado: { texto: 'Contato não classificado', cls: 'muted' },
};

const FILTROS = [
  { id: 'todos', label: 'Tudo', test: () => true },
  { id: 'contatos', label: 'Contatos efetivos', test: (e) => e.categoria === 'efetivo' },
  { id: 'tentativas', label: 'Tentativas', test: (e) => e.categoria === 'tentativa' },
  { id: 'notas', label: 'Anotações e internos', test: (e) => e.tipo === 'nota' || e.categoria === 'interno' },
  { id: 'propostas', label: 'Propostas', test: (e) => String(e.tipo).startsWith('proposta') || e.tipo === 'arquivo' },
  { id: 'estagio', label: 'Estágio', test: (e) => e.tipo === 'estagio' || e.tipo === 'criacao' },
];

function fmtMomento(v) {
  if (!v) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDataBR(v) : fmtDataHoraSP(v);
}

const LIMITE_INICIAL = 6;

export default function HistoricoOportunidade({ historico, expandido, onToggleExpandido }) {
  const [filtro, setFiltro] = useState('todos');
  const { eventos = [], carregando, erro, truncado, rastreioTruncado } = historico || {};
  const f = FILTROS.find((x) => x.id === filtro) || FILTROS[0];
  const lista = eventos.filter(f.test);
  const visiveis = expandido ? lista : lista.slice(0, LIMITE_INICIAL);

  return (
    <div className="drawer-section" id="secao-historico" data-testid="secao-historico">
      <h3>Histórico da oportunidade</h3>
      {erro && <div className="banner banner-error" style={{ borderRadius: 8, marginBottom: 8 }}>Não foi possível carregar o histórico: {erro}</div>}
      {truncado && (
        <div className="schema-warning">O monday.com tem mais de 600 atualizações neste lead; as mais antigas não foram carregadas aqui.</div>
      )}
      {rastreioTruncado && (
        <div className="schema-warning" data-testid="aviso-rastreio-truncado">
          O registro de rastreio de propostas excedeu o limite do monday.com (2.000 caracteres) e foi cortado: só os envios que
          chegaram inteiros aparecem. Nada foi apagado ou reescrito por aqui.
        </div>
      )}
      <div className="hist-filtros">
        {FILTROS.map((x) => (
          <button key={x.id} type="button" className={filtro === x.id ? 'ativo' : ''} onClick={() => setFiltro(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      {carregando && <div className="opp-sub">Carregando…</div>}
      {!carregando && lista.length === 0 && <div className="opp-sub">Nenhum evento neste filtro.</div>}
      <div className="hist-lista" data-testid="hist-lista">
        {visiveis.map((e) => {
          const b = BADGE[e.categoria];
          return (
            <div key={e.id} className={`hist-item tipo-${e.tipo} cat-${e.categoria}`} data-tipo={e.tipo} data-categoria={e.categoria}>
              <div className="hist-cab">
                <span className="hist-tipo">
                  {ICONE[e.tipo] || '•'} {ROTULO_TIPO[e.tipo] || e.tipo}
                  {e.canal ? ` · ${e.canal}` : ''}
                </span>
                {b && e.categoria !== 'nao_informado' && <span className={`hist-badge ${b.cls}`}>{b.texto}</span>}
                {e.categoria === 'nao_informado' && e.tipo === 'nota' && <span className="hist-badge muted">Anotação</span>}
              </div>
              <div className="hist-corpo">{e.conteudo}</div>
              <div className="hist-meta">
                <span>
                  Aconteceu: {e.ocorreuEm ? fmtMomento(e.ocorreuEm) : <em>não informado</em>}
                </span>
                {e.registradoEm && <span>Registrado: {fmtMomento(e.registradoEm)}</span>}
                <span>Autor: {e.autor || <em>não informado</em>}</span>
              </div>
            </div>
          );
        })}
      </div>
      {lista.length > LIMITE_INICIAL && (
        <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={onToggleExpandido} data-testid="hist-expandir">
          {expandido ? 'Mostrar só os mais recentes' : `Ver histórico completo (${lista.length})`}
        </button>
      )}
    </div>
  );
}
