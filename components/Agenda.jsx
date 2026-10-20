'use client';

import { useMemo, useState } from 'react';
import PrioridadesHoje from './PrioridadesHoje';
import SugestoesAcompanhamento from './SugestoesAcompanhamento';
import { origemDaAcao } from '../lib/automacao.js';
import {
  TRILHAS,
  TRILHA_LABEL,
  TRILHA_CAMPO_DATA,
  getAcao,
  dataDaTrilha,
  responsavelEfetivo,
  pendenciasProximaAcao,
  diasDesde,
  dateOnly,
  fmtDataBR,
  toLocalDateStr,
} from '../lib/agenda.js';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatMoney(v) {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Mantido por compatibilidade com quem ainda importa computeAgenda (a v1 de
// prioridades moveu o cálculo para lib/agenda.js — computeAgendaPorTrilha —,
// que separa vendas / reativação / pós-venda).
export { computeAgendaPorTrilha as computeAgenda } from '../lib/agenda.js';

// Agrupa os leads da trilha escolhida por data (visão de calendário).
function computeByDate(items, trilha) {
  const campo = TRILHA_CAMPO_DATA[trilha];
  const map = {};
  for (const it of items) {
    if (it.estagio === 'Perdido' ? trilha !== TRILHAS.REATIVACAO : it.estagio === 'Fechado' ? trilha !== TRILHAS.POS_VENDA : trilha !== TRILHAS.VENDAS) continue;
    const d = dateOnly(it[campo]);
    if (!d) continue;
    if (!map[d]) map[d] = [];
    map[d].push(it);
  }
  return map;
}

function AgendaRow({ item, trilha, usersById, onSelect, rightLabel, onConcluirAtividade }) {
  const acao = getAcao(item, trilha);
  const respId = responsavelEfetivo(item, trilha);
  const respNome = respId ? usersById[respId]?.name : null;
  const pend = pendenciasProximaAcao(item);
  return (
    <div className="agenda-row" onClick={() => onSelect(item.id)}>
      <div className="agenda-row-main">
        <div className="agenda-row-name">{item.name}</div>
        <div className="agenda-row-sub">
          {item.empresa && <span>{item.empresa}</span>}
          {respNome && <span> · {respNome}</span>}
        </div>
        {acao.acao && <div className="agenda-row-next">→ {acao.acao}</div>}
        {acao.acao && (
          <div className="agenda-row-origem" data-testid="agenda-origem">
            {origemDaAcao(acao)?.rotulo}
            {acao.hora ? ` · ${acao.hora} (lembrete interno)` : ''}
          </div>
        )}
        {pend.length > 0 && <div className="agenda-row-pend">⚠ Registro incompleto: falta {pend.join(', ')}</div>}
      </div>
      <div className="agenda-row-right">
        {formatMoney(item.valorEstimado) && <span className="valor">{formatMoney(item.valorEstimado)}</span>}
        <span className="agenda-row-label">{rightLabel}</span>
        {onConcluirAtividade && (
          <button
            className="btn-mini"
            onClick={(e) => {
              e.stopPropagation();
              onConcluirAtividade(item.id);
            }}
          >
            ✅ Registrar
          </button>
        )}
      </div>
    </div>
  );
}

function CalendarView({ items, trilha, usersById, onSelect, calMonth, setCalMonth }) {
  const byDate = useMemo(() => computeByDate(items, trilha), [items, trilha]);
  const today = toLocalDateStr();
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push({ date: new Date(year, month, 1 - (startWeekday - i)), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ date: new Date(year, month, day), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const d = new Date(cells[cells.length - 1].date);
    d.setDate(d.getDate() + 1);
    cells.push({ date: d, inMonth: false });
  }

  const monthLabel = capitalize(calMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));

  return (
    <div className="calendar-view">
      <div className="calendar-nav">
        <button className="btn btn-secondary" onClick={() => setCalMonth(new Date(year, month - 1, 1))}>
          ← Mês anterior
        </button>
        <h4>{monthLabel}</h4>
        <button className="btn btn-secondary" onClick={() => setCalMonth(new Date(year, month + 1, 1))}>
          Próximo mês →
        </button>
        <button
          className="btn-link"
          onClick={() => {
            const d = new Date();
            setCalMonth(new Date(d.getFullYear(), d.getMonth(), 1));
          }}
        >
          Hoje
        </button>
      </div>
      <div className="calendar-grid">
        {WEEKDAYS.map((w) => (
          <div className="calendar-weekday" key={w}>
            {w}
          </div>
        ))}
        {cells.map(({ date, inMonth }, i) => {
          const dStr = toDateStr(date);
          const dayItems = byDate[dStr] || [];
          const isToday = dStr === today;
          const isPast = dStr < today;
          return (
            <div key={i} className={`calendar-cell${inMonth ? '' : ' out-month'}${isToday ? ' is-today' : ''}`}>
              <div className="calendar-cell-num">{date.getDate()}</div>
              <div className="calendar-cell-items">
                {dayItems.slice(0, 3).map((it) => (
                  <div
                    key={it.id}
                    // Só vendas e pós-venda "vencem" em vermelho — reativação
                    // é oportunidade, não cobrança.
                    className={`calendar-chip${isPast && inMonth && trilha !== TRILHAS.REATIVACAO ? ' overdue' : ''}`}
                    onClick={() => onSelect(it.id)}
                    title={`${it.name}${it.empresa ? ' · ' + it.empresa : ''}`}
                  >
                    {it.name}
                  </div>
                ))}
                {dayItems.length > 3 && <div className="calendar-more">+{dayItems.length - 3} mais</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const AJUDA_TRILHA = {
  vendas:
    'Leads de Lead até Em Negociação. O alerta vem da data da próxima ação (follow-up); o prazo previsto de compra é outro campo e não gera alerta.',
  reativacao:
    'Negócios perdidos. Têm agendamento próprio de reativação e NÃO geram alerta de follow-up comercial vencido. Os agendamentos antigos continuam guardados (seção "Agendamento comercial antigo").',
  posVenda:
    'Clientes fechados. As atividades aqui são do pós-venda (responsável padrão: o vendedor de pós-venda do handoff).',
};

export default function Agenda({
  items,
  agendas,
  usersById,
  escopo,
  responsavelFiltro,
  meuId,
  onSelect,
  onConcluirAtividade,
  onFiltrarMeus,
  onLimparResponsavel,
  admin = false,
  onAplicado,
  refreshKey = 0,
}) {
  const [trilha, setTrilha] = useState(TRILHAS.VENDAS);
  const [subView, setSubView] = useState('lista');
  const [collapsed, setCollapsed] = useState({ 'vendas:incompletos': true, 'reativacao:legado': true });
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const hojeStr = agendas.hojeStr;

  function toggleSection(key) {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  }

  const { vendas, reativacao, posVenda } = agendas;
  const tabs = [
    { key: TRILHAS.VENDAS, count: vendas.atrasados.length + vendas.semData.length, alert: true },
    { key: TRILHAS.REATIVACAO, count: reativacao.vencidas.length + reativacao.hoje.length, alert: false },
    { key: TRILHAS.POS_VENDA, count: posVenda.atrasados.length, alert: true },
  ];

  const labelData = (it) => (dataDaTrilha(it, trilha) ? fmtDataBR(dataDaTrilha(it, trilha)) : '');
  const diasLabel = (it) =>
    diasDesde(it.ultimoContato, hojeStr) !== null
      ? `${diasDesde(it.ultimoContato, hojeStr)} dias sem contato`
      : 'sem contato registrado';

  const sectionsByTrilha = {
    vendas: [
      { key: 'atrasados', title: '⚠ Atrasados', items: vendas.atrasados, empty: 'Nenhum follow-up atrasado. 🎉', className: 'agenda-danger', label: labelData },
      { key: 'hoje', title: 'Hoje', items: vendas.hoje, empty: 'Nada agendado para hoje.', label: labelData },
      { key: 'proximos7', title: 'Próximos 7 dias', items: vendas.proximos7, empty: 'Nada agendado para os próximos 7 dias.', label: labelData },
      { key: 'semData', title: 'Sem follow-up agendado (parados há mais de 5 dias)', items: vendas.semData, empty: 'Tudo com follow-up marcado. 🎉', label: diasLabel },
      {
        key: 'incompletos',
        title: 'Registros incompletos (falta ação concreta, data ou responsável)',
        items: vendas.incompletos,
        empty: 'Todos os leads ativos têm próxima ação completa. 🎉',
        className: 'agenda-info',
        label: labelData,
      },
    ],
    reativacao: [
      { key: 'vencidas', title: 'Reativações previstas (data já passou)', items: reativacao.vencidas, empty: 'Nenhuma reativação com data vencida.', className: 'agenda-reativ', label: labelData },
      { key: 'hoje', title: 'Reativar hoje', items: reativacao.hoje, empty: 'Nenhuma reativação para hoje.', className: 'agenda-reativ', label: labelData },
      { key: 'proximos30', title: 'Próximos 30 dias', items: reativacao.proximos30, empty: 'Nada agendado para os próximos 30 dias.', label: labelData },
      {
        key: 'legado',
        title: 'Agendamento comercial antigo (perdidos) — sem alertas',
        items: reativacao.legado,
        empty: 'Nenhum perdido com agendamento antigo.',
        className: 'agenda-info',
        label: (it) => `follow-up antigo: ${fmtDataBR(it.proximoFollowUp)}`,
      },
    ],
    posVenda: [
      { key: 'atrasados', title: '⚠ Atrasados', items: posVenda.atrasados, empty: 'Nenhum contato de pós-venda atrasado. 🎉', className: 'agenda-danger', label: labelData },
      { key: 'hoje', title: 'Hoje', items: posVenda.hoje, empty: 'Nada agendado para hoje.', label: labelData },
      { key: 'proximos7', title: 'Próximos 7 dias', items: posVenda.proximos7, empty: 'Nada agendado para os próximos 7 dias.', label: labelData },
    ],
  };
  const sections = sectionsByTrilha[trilha];

  return (
    <div className="agenda-view">
      <div className="agenda-scope" data-testid="agenda-escopo">
        <span>
          <strong>{escopo.texto}</strong>
        </span>
        <span>· contadores e listas desta tela usam exatamente este escopo.</span>
      </div>

      <div className="agenda-tracks" role="tablist" aria-label="Trilha de atividades">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={trilha === t.key}
            className={trilha === t.key ? 'active' : ''}
            onClick={() => setTrilha(t.key)}
          >
            {TRILHA_LABEL[t.key]}
            <span className={`tcount${t.alert && t.count > 0 ? ' alert' : ''}`}>{t.count}</span>
          </button>
        ))}
      </div>
      <p className="agenda-track-help">{AJUDA_TRILHA[trilha]}</p>

      <div className="agenda-subtoggle">
        <button className={subView === 'lista' ? 'active' : ''} onClick={() => setSubView('lista')}>
          Lista
        </button>
        <button className={subView === 'calendario' ? 'active' : ''} onClick={() => setSubView('calendario')}>
          Calendário
        </button>
      </div>

      {subView === 'lista' && trilha !== TRILHAS.REATIVACAO && (
        <SugestoesAcompanhamento
          trilha={trilha}
          usersById={usersById}
          admin={admin}
          responsavelFiltro={responsavelFiltro}
          onSelect={onSelect}
          onAplicado={onAplicado}
          refreshKey={refreshKey}
          titulo={trilha === TRILHAS.POS_VENDA ? 'Pendências de passagem para pós-venda (sugestões)' : 'Próximos passos sugeridos'}
        />
      )}

      {subView === 'lista' && trilha === TRILHAS.VENDAS && (
        <PrioridadesHoje
          items={items}
          usersById={usersById}
          responsavelFiltro={responsavelFiltro}
          meuId={meuId}
          onSelect={onSelect}
          onConcluirAtividade={onConcluirAtividade}
          onFiltrarMeus={onFiltrarMeus}
          onLimparResponsavel={onLimparResponsavel}
          outrasTrilhas={{
            reativacaoVencidas: reativacao.vencidas.length,
            reativacaoHoje: reativacao.hoje.length,
            posVendaAtrasados: posVenda.atrasados.length,
            posVendaHoje: posVenda.hoje.length,
          }}
          onIrParaTrilha={setTrilha}
        />
      )}

      {subView === 'lista' &&
        sections.map((s) => {
          const toggleKey = `${trilha}:${s.key}`;
          const isCollapsed = !!collapsed[toggleKey];
          return (
            <div className={`metrics-section agenda-section ${s.className || ''}`} key={`${trilha}-${s.key}`}>
              <h3 className="agenda-section-header">
                <button
                  type="button"
                  className="agenda-toggle-icon"
                  onClick={() => toggleSection(toggleKey)}
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? `Expandir grupo ${s.title}` : `Recolher grupo ${s.title}`}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
                {s.title} {s.items.length > 0 && <span className="agenda-count">{s.items.length}</span>}
              </h3>
              {!isCollapsed && (
                <>
                  {s.items.length === 0 && <div className="agenda-empty">{s.empty}</div>}
                  {s.items.map((it) => (
                    <AgendaRow
                      key={it.id}
                      item={it}
                      trilha={trilha}
                      usersById={usersById}
                      onSelect={onSelect}
                      rightLabel={s.label(it)}
                      onConcluirAtividade={s.key === 'legado' ? null : onConcluirAtividade}
                    />
                  ))}
                </>
              )}
            </div>
          );
        })}

      {subView === 'calendario' && (
        <div className="metrics-section">
          <CalendarView
            items={items}
            trilha={trilha}
            usersById={usersById}
            onSelect={onSelect}
            calMonth={calMonth}
            setCalMonth={setCalMonth}
          />
        </div>
      )}
    </div>
  );
}
