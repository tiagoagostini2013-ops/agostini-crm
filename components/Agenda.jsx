'use client';

import { useMemo, useState } from 'react';

const CLOSED_STAGES = ['Fechado', 'Perdido'];
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function daysSince(dateStr) {
  const d = dateOnly(dateStr);
  if (!d) return null;
  const parsed = new Date(d + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
}

function formatMoney(v) {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function fmtDatePt(dateStr) {
  const d = dateOnly(dateStr);
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Calcula as listas de follow-up a partir dos mesmos leads que já estão
// carregados (respeitando os filtros ativos). "Atrasados" e "sem data" são a
// base do alerta que aparece no topo do Kanban.
export function computeAgenda(items) {
  const today = todayStr();
  const in7 = new Date();
  in7.setDate(in7.getDate() + 7);
  const in7Str = [in7.getFullYear(), String(in7.getMonth() + 1).padStart(2, '0'), String(in7.getDate()).padStart(2, '0')].join('-');

  const atrasados = [];
  const hoje = [];
  const proximos7 = [];
  const semData = [];

  for (const it of items) {
    if (CLOSED_STAGES.includes(it.estagio)) continue;
    const fu = dateOnly(it.proximoFollowUp);
    if (fu) {
      if (fu < today) atrasados.push(it);
      else if (fu === today) hoje.push(it);
      else if (fu <= in7Str) proximos7.push(it);
    } else {
      const dias = daysSince(it.ultimoContato);
      if (dias === null || dias > 5) semData.push(it);
    }
  }

  atrasados.sort((a, b) => dateOnly(a.proximoFollowUp).localeCompare(dateOnly(b.proximoFollowUp)));
  hoje.sort((a, b) => (a.empresa || a.name).localeCompare(b.empresa || b.name));
  proximos7.sort((a, b) => dateOnly(a.proximoFollowUp).localeCompare(dateOnly(b.proximoFollowUp)));
  semData.sort((a, b) => (daysSince(b.ultimoContato) ?? 999) - (daysSince(a.ultimoContato) ?? 999));

  return { atrasados, hoje, proximos7, semData };
}

// Agrupa todos os leads (em aberto) que têm próximo follow-up marcado, por
// data — usado pela visualização em calendário.
function computeByDate(items) {
  const map = {};
  for (const it of items) {
    if (CLOSED_STAGES.includes(it.estagio)) continue;
    const fu = dateOnly(it.proximoFollowUp);
    if (!fu) continue;
    if (!map[fu]) map[fu] = [];
    map[fu].push(it);
  }
  return map;
}

function AgendaRow({ item, usersById, onSelect, rightLabel }) {
  return (
    <div className="agenda-row" onClick={() => onSelect(item.id)}>
      <div className="agenda-row-main">
        <div className="agenda-row-name">{item.name}</div>
        <div className="agenda-row-sub">
          {item.empresa && <span>{item.empresa}</span>}
          {item.responsavelIds
            .map((id) => usersById[id]?.name)
            .filter(Boolean)
            .join(', ') && (
            <span>
              {' '}
              · {item.responsavelIds.map((id) => usersById[id]?.name).filter(Boolean).join(', ')}
            </span>
          )}
        </div>
      </div>
      <div className="agenda-row-right">
        {formatMoney(item.valorEstimado) && <span className="valor">{formatMoney(item.valorEstimado)}</span>}
        <span className="agenda-row-label">{rightLabel}</span>
      </div>
    </div>
  );
}

function CalendarView({ items, usersById, onSelect, calMonth, setCalMonth }) {
  const byDate = useMemo(() => computeByDate(items), [items]);
  const today = todayStr();
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
            <div
              key={i}
              className={`calendar-cell${inMonth ? '' : ' out-month'}${isToday ? ' is-today' : ''}`}
            >
              <div className="calendar-cell-num">{date.getDate()}</div>
              <div className="calendar-cell-items">
                {dayItems.slice(0, 3).map((it) => (
                  <div
                    key={it.id}
                    className={`calendar-chip${isPast && inMonth ? ' overdue' : ''}`}
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

export default function Agenda({ items, usersById, onSelect }) {
  const { atrasados, hoje, proximos7, semData } = useMemo(() => computeAgenda(items), [items]);
  const [subView, setSubView] = useState('lista');
  const [collapsed, setCollapsed] = useState({});
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  function toggleSection(key) {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  }

  const sections = [
    { key: 'atrasados', title: '⚠ Atrasados', items: atrasados, empty: 'Nenhum follow-up atrasado. 🎉', className: 'agenda-danger' },
    { key: 'hoje', title: 'Hoje', items: hoje, empty: 'Nada agendado para hoje.' },
    { key: 'proximos7', title: 'Próximos 7 dias', items: proximos7, empty: 'Nada agendado para os próximos 7 dias.' },
    { key: 'semData', title: 'Sem follow-up agendado (parados há mais de 5 dias)', items: semData, empty: 'Tudo com follow-up marcado. 🎉' },
  ];

  return (
    <div className="agenda-view">
      <div className="agenda-subtoggle">
        <button className={subView === 'lista' ? 'active' : ''} onClick={() => setSubView('lista')}>
          Lista
        </button>
        <button className={subView === 'calendario' ? 'active' : ''} onClick={() => setSubView('calendario')}>
          Calendário
        </button>
      </div>

      {subView === 'lista' &&
        sections.map((s) => {
          const isCollapsed = !!collapsed[s.key];
          return (
            <div className={`metrics-section agenda-section ${s.className || ''}`} key={s.key}>
              <h3 className="agenda-section-header">
                <button
                  type="button"
                  className="agenda-toggle-icon"
                  onClick={() => toggleSection(s.key)}
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
                      usersById={usersById}
                      onSelect={onSelect}
                      rightLabel={
                        s.key === 'semData'
                          ? daysSince(it.ultimoContato) !== null
                            ? `${daysSince(it.ultimoContato)} dias sem contato`
                            : 'sem contato registrado'
                          : it.proximoFollowUp
                          ? fmtDatePt(it.proximoFollowUp)
                          : ''
                      }
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
