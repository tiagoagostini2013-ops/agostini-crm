'use client';

import { useMemo } from 'react';

// Visão de "Pós-venda / Base Instalada" — Fase 4 do roadmap. Em vez de criar
// um board novo no monday.com (opção descartada pelo Tiago), esta visão só
// filtra os leads já carregados (mesma fonte do Kanban/Métricas/Agenda) pelos
// que estão em "Fechado", ou seja, já viraram cliente. O objetivo é separar
// "vender" (Kanban/Métricas) de "reter e dar suporte" (esta tela), com seus
// próprios KPIs — sem duplicar dados nem exigir nenhuma chamada extra ao
// monday.com.

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function formatMoney(v) {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

// Diferente do alerta de follow-up do funil de vendas (que cobra contato em
// poucos dias) — pós-venda é uma relação de manutenção, não de conversão.
// 60 dias sem contato aqui é o sinal de "cliente esfriando", não de lead
// perdido.
const DIAS_SEM_CONTATO_ALERTA = 60;

export default function PosVenda({ items, usersById, onSelect }) {
  const baseInstalada = useMemo(() => items.filter((it) => it.estagio === 'Fechado'), [items]);

  const porSegmento = useMemo(() => {
    const map = {};
    baseInstalada.forEach((it) => {
      const s = it.segmento || 'Sem segmento';
      map[s] = (map[s] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [baseInstalada]);

  const porResponsavel = useMemo(() => {
    const map = {};
    baseInstalada.forEach((it) => {
      const ids = it.responsavelIds.length ? it.responsavelIds : ['sem-responsavel'];
      ids.forEach((id) => {
        map[id] = (map[id] || 0) + 1;
      });
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [baseInstalada]);

  const valorTotal = useMemo(
    () => baseInstalada.reduce((acc, it) => acc + (Number(it.valorEstimado) || 0), 0),
    [baseInstalada]
  );

  const semContatoRecente = useMemo(
    () =>
      baseInstalada.filter((it) => {
        const d = daysSince(it.ultimoContato);
        return d === null || d > DIAS_SEM_CONTATO_ALERTA;
      }),
    [baseInstalada]
  );

  const semContatosDecisao = useMemo(
    () => baseInstalada.filter((it) => !it.contatos || it.contatos.length === 0),
    [baseInstalada]
  );

  return (
    <div className="metrics-view">
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Clientes na base instalada</div>
          <div className="metric-value">{baseInstalada.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Valor total (estimado, acumulado)</div>
          <div className="metric-value">{formatMoney(valorTotal) || '—'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Sem contato há mais de {DIAS_SEM_CONTATO_ALERTA} dias</div>
          <div className="metric-value">{semContatoRecente.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Sem contatos/decisores cadastrados</div>
          <div className="metric-value">{semContatosDecisao.length}</div>
        </div>
      </div>

      {baseInstalada.length === 0 && (
        <div className="metrics-section">
          <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            Nenhum lead fechado ainda no filtro atual — assim que um lead virar "Fechado", ele aparece aqui como
            base instalada.
          </div>
        </div>
      )}

      {baseInstalada.length > 0 && (
        <>
          <div className="metrics-columns">
            <div className="metrics-section">
              <h3>Base instalada por segmento</h3>
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>Segmento</th>
                    <th>Clientes</th>
                  </tr>
                </thead>
                <tbody>
                  {porSegmento.map(([s, c]) => (
                    <tr key={s}>
                      <td>{s}</td>
                      <td>{c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="metrics-section">
              <h3>Base instalada por responsável (pós-venda)</h3>
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>Responsável</th>
                    <th>Clientes</th>
                  </tr>
                </thead>
                <tbody>
                  {porResponsavel.map(([id, c]) => (
                    <tr key={id}>
                      <td>{id === 'sem-responsavel' ? 'Sem responsável' : usersById[id]?.name || `#${id}`}</td>
                      <td>{c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="metrics-section">
            <h3>Clientes (base instalada)</h3>
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Segmento</th>
                  <th>Responsável(is)</th>
                  <th>Contatos/decisores</th>
                  <th>Último contato</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {baseInstalada.map((it) => {
                  const dias = daysSince(it.ultimoContato);
                  const stale = dias === null || dias > DIAS_SEM_CONTATO_ALERTA;
                  return (
                    <tr
                      key={it.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onSelect(it.id)}
                      title="Abrir lead"
                    >
                      <td>
                        <strong>{it.name}</strong>
                        {it.empresa && <div style={{ color: 'var(--ink-soft)', fontSize: '0.78rem' }}>{it.empresa}</div>}
                      </td>
                      <td>{it.segmento || '—'}</td>
                      <td>
                        {it.responsavelIds.map((id) => usersById[id]?.name).filter(Boolean).join(', ') ||
                          'Sem responsável'}
                      </td>
                      <td>{it.contatos && it.contatos.length > 0 ? it.contatos.length : '—'}</td>
                      <td style={stale ? { color: 'var(--danger)' } : undefined}>
                        {fmtDate(it.ultimoContato)}
                        {stale && dias !== null && ` (${dias}d)`}
                      </td>
                      <td>{formatMoney(it.valorEstimado) || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
