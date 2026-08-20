'use client';

import { useEffect, useMemo, useState } from 'react';
import { FORECAST_STAGES } from '../lib/config';

function formatMoney(v) {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return 'R$ 0';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

// Painel de métricas — calculado inteiramente no navegador a partir dos
// mesmos leads que já carregam para o Kanban (respeitando os filtros ativos),
// sem precisar de nenhuma chamada extra ao monday.com. A única exceção é o
// forecast ponderado (Fase 5) logo abaixo, que busca as probabilidades por
// estágio salvas no board de Configurações.
export default function Metrics({ items, meta, usersById, currentUser }) {
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

  // ---------- Forecast ponderado por estágio (Fase 5) ----------
  // Ideia: um lead em estágio mais avançado tem, historicamente, mais chance
  // de virar venda — então "quanto deve fechar" não é simplesmente a soma do
  // valor estimado de tudo que está em aberto, é essa soma ponderada pela
  // probabilidade de cada estágio. Fechado/Perdido ficam de fora: já são
  // resultado, não previsão.
  const [probs, setProbs] = useState(null); // salvo no servidor
  const [draft, setDraft] = useState(null); // rascunho em edição (só admin)
  const [probsLoading, setProbsLoading] = useState(true);
  const [probsSaving, setProbsSaving] = useState(false);
  const [probsError, setProbsError] = useState('');
  const [savedJustNow, setSavedJustNow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/forecast')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.probabilities) {
          setProbs(data.probabilities);
          setDraft(data.probabilities);
        }
      })
      .catch(() => {
        if (!cancelled) setProbsError('Não foi possível carregar as probabilidades de forecast.');
      })
      .finally(() => {
        if (!cancelled) setProbsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const valorAbertoPorEstagio = useMemo(() => {
    const map = {};
    FORECAST_STAGES.forEach((s) => (map[s] = 0));
    items.forEach((it) => {
      if (map[it.estagio] === undefined) return;
      const v = Number(it.valorEstimado);
      if (!Number.isNaN(v)) map[it.estagio] += v;
    });
    return map;
  }, [items]);

  const forecastTotal = useMemo(() => {
    if (!probs) return null;
    return FORECAST_STAGES.reduce((acc, s) => acc + (valorAbertoPorEstagio[s] || 0) * ((probs[s] || 0) / 100), 0);
  }, [probs, valorAbertoPorEstagio]);

  function updateDraft(stage, value) {
    setSavedJustNow(false);
    setDraft((d) => ({ ...d, [stage]: value }));
  }

  async function saveProbs() {
    setProbsSaving(true);
    setProbsError('');
    try {
      const payload = {};
      for (const s of FORECAST_STAGES) {
        const n = Number(draft[s]);
        if (Number.isNaN(n) || n < 0 || n > 100) {
          throw new Error(`Probabilidade de "${s}" precisa ser um número entre 0 e 100.`);
        }
        payload[s] = n;
      }
      const res = await fetch('/api/settings/forecast', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ probabilities: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar.');
      setProbs(data.probabilities);
      setDraft(data.probabilities);
      setSavedJustNow(true);
    } catch (err) {
      setProbsError(err.message);
    } finally {
      setProbsSaving(false);
    }
  }

  const probsDirty = probs && draft && FORECAST_STAGES.some((s) => Number(draft[s]) !== Number(probs[s]));

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
        <div className="metric-card">
          <div className="metric-label">Previsão ponderada (forecast)</div>
          <div className="metric-value">
            {probsLoading ? '...' : forecastTotal === null ? '—' : formatMoney(forecastTotal)}
          </div>
          <div className="metric-sub">Funil aberto × probabilidade por estágio</div>
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

      <div className="metrics-section">
        <h3>Previsão ponderada por estágio</h3>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.82rem', marginTop: -6, marginBottom: 12 }}>
          Cada estágio tem uma probabilidade histórica de virar venda — o valor em aberto de cada um é multiplicado
          por essa probabilidade. "Fechado" e "Perdido" ficam de fora: já são resultado, não previsão.
          {currentUser?.admin
            ? ' Como administrador, você pode ajustar as probabilidades abaixo.'
            : ' Só administradores podem ajustar as probabilidades.'}
        </p>
        {probsError && <div className="banner banner-error" style={{ borderRadius: 8, marginBottom: 12 }}>{probsError}</div>}
        <table className="metrics-table">
          <thead>
            <tr>
              <th>Estágio</th>
              <th>Valor em aberto</th>
              <th>Probabilidade</th>
              <th>Contribuição no forecast</th>
            </tr>
          </thead>
          <tbody>
            {FORECAST_STAGES.map((s) => {
              const valorAberto = valorAbertoPorEstagio[s] || 0;
              const p = draft ? Number(draft[s]) : null;
              const contribuicao = probs ? valorAberto * ((probs[s] || 0) / 100) : null;
              return (
                <tr key={s}>
                  <td>{s}</td>
                  <td>{formatMoney(valorAberto)}</td>
                  <td>
                    {currentUser?.admin ? (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={p === null || Number.isNaN(p) ? '' : p}
                        onChange={(e) => updateDraft(s, e.target.value)}
                        style={{ width: 64, padding: '4px 6px' }}
                        disabled={probsLoading || probsSaving}
                      />
                    ) : (
                      `${probs ? probs[s] : '—'}%`
                    )}
                    {currentUser?.admin && '%'}
                  </td>
                  <td>{contribuicao === null ? '—' : formatMoney(contribuicao)}</td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>
                Total (previsão ponderada)
              </td>
              <td style={{ fontWeight: 700 }}>{forecastTotal === null ? '—' : formatMoney(forecastTotal)}</td>
            </tr>
          </tbody>
        </table>
        {currentUser?.admin && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-primary" disabled={!probsDirty || probsSaving} onClick={saveProbs}>
              {probsSaving ? 'Salvando...' : 'Salvar probabilidades'}
            </button>
            {savedJustNow && !probsDirty && (
              <span style={{ color: '#037f4c', fontSize: '0.85rem' }}>✓ Salvo</span>
            )}
          </div>
        )}
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
