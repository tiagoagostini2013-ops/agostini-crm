'use client';

import { useMemo } from 'react';

function formatMoney(v) {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return 'R$ 0';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

// Painel de métricas — calculado inteiramente no navegador a partir dos
// mesmos leads que já carregam para o Kanban (respeitando os filtros ativos),
// sem precisar de nenhuma chamada extra ao monday.com.
export default function Metrics({ items, meta, usersById }) {
  const total = items.length;

  const stageCounts = useMemo(() => {
    const map = {};
    (meta.stages || []).forEach((s) => (map[s.value] = 0));
    items.forEach((it) => {
      if (it.estagio && map[it.estagio] !== undefined) map[it.estagio] += 1;
    });
    return map;
  }, [items, meta]);

  const fechados = useMemo(() => items.filter((it) => it.estagio === 'Fechado'), [items]);
  const perdidos = useMemo(() => items.filter((it) => it.estagio === 'Perdido'), [items]);

  const ticketMedio = useMemo(() => {
    const valores = fechados
      .map((it) => Number(it.valorEstimado))
      .filter((n) => !Number.isNaN(n) && n > 0);
    if (!valores.length) return null;
    return valores.reduce((a, b) => a + b, 0) / valores.length;
  }, [fechados]);

  const taxaConversao = useMemo(() => {
    if (!total) return null;
    return (fechados.length / total) * 100;
  }, [fechados, total]);

  const motivosPerda = useMemo(() => {
    const map = {};
    perdidos.forEach((it) => {
      const m = it.motivoPerda || 'Não informado';
      map[m] = (map[m] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [perdidos]);

  const ranking = useMemo(() => {
    const map = {};
    items.forEach((it) => {
      const ids = it.responsavelIds.length ? it.responsavelIds : ['sem-responsavel'];
      ids.forEach((id) => {
        if (!map[id]) map[id] = { id, total: 0, fechados: 0, valorFechado: 0 };
        map[id].total += 1;
        if (it.estagio === 'Fechado') {
          map[id].fechados += 1;
          const v = Number(it.valorEstimado);
          if (!Number.isNaN(v)) map[id].valorFechado += v;
        }
      });
    });
    return Object.values(map).sort(
      (a, b) => b.valorFechado - a.valorFechado || b.fechados - a.fechados || b.total - a.total
    );
  }, [items]);

  const maxStageCount = Math.max(1, ...Object.values(stageCounts));

  return (
    <div className="metrics-view">
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total de leads (no filtro atual)</div>
          <div className="metric-value">{total}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Taxa de conversão (Lead → Fechado)</div>
          <div className="metric-value">{taxaConversao === null ? '—' : `${taxaConversao.toFixed(1)}%`}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Ticket médio (fechados)</div>
          <div className="metric-value">{ticketMedio === null ? '—' : formatMoney(ticketMedio)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Motivo de perda mais comum</div>
          <div className="metric-value metric-value-text">{motivosPerda.length ? motivosPerda[0][0] : '—'}</div>
          {motivosPerda.length > 0 && (
            <div className="metric-sub">{motivosPerda[0][1]} caso(s) no filtro atual</div>
          )}
        </div>
      </div>

      <div className="metrics-section">
        <h3>Funil por estágio</h3>
        <div className="funnel">
          {(meta.stages || []).map((s) => (
            <div className="funnel-row" key={s.value}>
              <div className="funnel-label">{s.value}</div>
              <div className="funnel-bar-track">
                <div
                  className="funnel-bar"
                  style={{ width: `${(stageCounts[s.value] / maxStageCount) * 100}%`, background: s.color }}
                />
              </div>
              <div className="funnel-count">{stageCounts[s.value]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="metrics-columns">
        <div className="metrics-section">
          <h3>Ranking por responsável</h3>
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Responsável</th>
                <th>Leads</th>
                <th>Fechados</th>
                <th>Valor fechado</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r) => (
                <tr key={r.id}>
                  <td>{r.id === 'sem-responsavel' ? 'Sem responsável' : usersById[r.id]?.name || `#${r.id}`}</td>
                  <td>{r.total}</td>
                  <td>{r.fechados}</td>
                  <td>{formatMoney(r.valorFechado)}</td>
                </tr>
              ))}
              {ranking.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--ink-soft)' }}>
                    Sem dados no filtro atual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="metrics-section">
          <h3>Motivos de perda</h3>
          {motivosPerda.length === 0 && (
            <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>
              Nenhum lead perdido no filtro atual.
            </div>
          )}
          {motivosPerda.length > 0 && (
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Motivo</th>
                  <th>Quantidade</th>
                </tr>
              </thead>
              <tbody>
                {motivosPerda.map(([m, c]) => (
                  <tr key={m}>
                    <td>{m}</td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
