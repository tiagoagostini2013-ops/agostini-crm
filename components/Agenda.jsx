'use client';

import { useMemo } from 'react';

const CLOSED_STAGES = ['Fechado', 'Perdido'];

function todayStr() {
  const d = new Date();
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

export default function Agenda({ items, usersById, onSelect }) {
  const { atrasados, hoje, proximos7, semData } = useMemo(() => computeAgenda(items), [items]);

  const sections = [
    { key: 'atrasados', title: '⚠ Atrasados', items: atrasados, empty: 'Nenhum follow-up atrasado. 🎉', className: 'agenda-danger' },
    { key: 'hoje', title: 'Hoje', items: hoje, empty: 'Nada agendado para hoje.' },
    { key: 'proximos7', title: 'Próximos 7 dias', items: proximos7, empty: 'Nada agendado para os próximos 7 dias.' },
    { key: 'semData', title: 'Sem follow-up agendado (parados há mais de 5 dias)', items: semData, empty: 'Tudo com follow-up marcado. 🎉' },
  ];

  return (
    <div className="agenda-view">
      {sections.map((s) => (
        <div className={`metrics-section agenda-section ${s.className || ''}`} key={s.key}>
          <h3>
            {s.title} {s.items.length > 0 && <span className="agenda-count">{s.items.length}</span>}
          </h3>
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
        </div>
      ))}
    </div>
  );
}
