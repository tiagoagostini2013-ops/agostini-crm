'use client';

import { useEffect, useMemo, useState } from 'react';
import { FORECAST_STAGES } from '../lib/config';

function formatMoney(v) {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return 'R$ 0';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

// Datas do CRM vêm sem hora (colunas "date" do monday.com) — comparar como
// meia-noite UTC evita diferença de fuso horário mudar o número de dias.
function toDateOnly(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffDays(from, to) {
  if (!from || !to) return null;
  const d = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
  return d >= 0 ? d : null;
}

function avgOf(values) {
  const nums = values.filter((v) => v !== null && v !== undefined);
  if (!nums.length) return { media: null, n: 0 };
  return { media: nums.reduce((a, b) => a + b, 0) / nums.length, n: nums.length };
}

// Coluna de data de entrada em cada estágio — usada tanto no "tempo médio por
// estágio" quanto no "forecast: previsto vs. realizado" (Fase 7). "Lead" usa
// a própria criação do item, que sempre existe.
const STAGE_ENTRY_FIELD = {
  Lead: 'createdAt',
  Qualificado: 'dataQualificacao',
  'Proposta Enviada': 'dataPropostaEnviada',
  'Em Negociação': 'dataNegociacao',
};

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

  // ---------- Fase 7 — velocidade e qualidade do funil ----------
  // Todas as datas de entrada em estágio usadas aqui (Qualificação, Proposta
  // Enviada, Início Negociação, Primeiro Contato) só existem a partir de
  // 20/08/2026 pra frente (ver comentário em lib/config.js) — os números
  // ficam mais completos e confiáveis conforme os dados se acumulam.

  // "Meu tempo até o 1º contato" — pessoal, não é comparação entre
  // vendedores (isso fica só no Dashboard Gerencial, admin-only, por decisão
  // do Tiago em 20/08/2026). Só aparece pra quem está de fato vinculado a
  // uma pessoa do monday.com (currentUser.mondayUserId, ver /api/auth/me).
  const meuPrimeiroContato = useMemo(() => {
    if (!currentUser?.mondayUserId) return null;
    const meusLeads = items.filter((it) => it.responsavelIds.includes(String(currentUser.mondayUserId)));
    const diffs = meusLeads.map((it) => diffDays(toDateOnly(it.createdAt), toDateOnly(it.dataPrimeiroContato)));
    const { media, n } = avgOf(diffs);
    if (!n) return { media: null, n: 0, noPrazoPct: null };
    const noPrazo = diffs.filter((d) => d !== null && d <= 1).length;
    return { media, n, noPrazoPct: (noPrazo / n) * 100 };
  }, [items, currentUser]);

  // Tempo médio em cada etapa do funil — agregado, sem quebra por pessoa
  // (aberto a todos, como o resto da aba Métricas).
  const temposPorEstagio = useMemo(() => {
    function etapa(label, fromField, toField) {
      const diffs = items.map((it) => diffDays(toDateOnly(it[fromField]), toDateOnly(it[toField])));
      return { label, ...avgOf(diffs) };
    }
    function etapaAteResultado(label, fromField) {
      const diffs = items.map((it) => {
        const from = toDateOnly(it[fromField]);
        const to = toDateOnly(it.dataFechamento) || toDateOnly(it.dataPerda);
        return diffDays(from, to);
      });
      return { label, ...avgOf(diffs) };
    }
    return [
      etapa('Lead → Qualificado', 'createdAt', 'dataQualificacao'),
      etapa('Qualificado → Proposta Enviada', 'dataQualificacao', 'dataPropostaEnviada'),
      etapa('Proposta Enviada → Em Negociação', 'dataPropostaEnviada', 'dataNegociacao'),
      etapaAteResultado('Em Negociação → Fechado/Perdido', 'dataNegociacao'),
    ];
  }, [items]);

  // Conversão por segmento (aberto a todos — conversão por VENDEDOR fica só
  // no Dashboard Gerencial, admin-only).
  const conversaoPorSegmento = useMemo(() => {
    const map = {};
    items.forEach((it) => {
      const seg = it.segmento || 'Sem segmento';
      if (!map[seg]) map[seg] = { segmento: seg, total: 0, fechados: 0, perdidos: 0 };
      map[seg].total += 1;
      if (it.estagio === 'Fechado') map[seg].fechados += 1;
      if (it.estagio === 'Perdido') map[seg].perdidos += 1;
    });
    return Object.values(map)
      .map((r) => ({
        ...r,
        taxa: r.fechados + r.perdidos > 0 ? (r.fechados / (r.fechados + r.perdidos)) * 100 : null,
      }))
      .sort((a, b) => b.total - a.total);
  }, [items]);

  // Motivo de perda cruzado com segmento e canal de origem — pra achar
  // padrões escondidos (ex: "perdemos por preço quase só num segmento").
  const motivosDetalhado = useMemo(() => {
    const map = {};
    perdidos.forEach((it) => {
      const motivo = it.motivoPerda || 'Não informado';
      const segmento = it.segmento || 'Sem segmento';
      const canal = it.canalOrigem || 'Sem canal';
      const key = `${motivo}|${segmento}|${canal}`;
      if (!map[key]) map[key] = { motivo, segmento, canal, qtd: 0 };
      map[key].qtd += 1;
    });
    return Object.values(map).sort((a, b) => b.qtd - a.qtd);
  }, [perdidos]);

  // Forecast previsto (probabilidade configurada) vs. realizado (taxa
  // empírica de fechamento entre os leads que passaram por cada estágio e já
  // têm resultado). Usa as mesmas datas de entrada em estágio de cima.
  const realizadoPorEstagio = useMemo(() => {
    const map = {};
    FORECAST_STAGES.forEach((s) => {
      const field = STAGE_ENTRY_FIELD[s];
      const passaram = field === 'createdAt' ? items : items.filter((it) => it[field]);
      const resolvidos = passaram.filter((it) => it.estagio === 'Fechado' || it.estagio === 'Perdido');
      const fechados = resolvidos.filter((it) => it.estagio === 'Fechado');
      map[s] = resolvidos.length > 0 ? { pct: (fechados.length / resolvidos.length) * 100, n: resolvidos.length } : { pct: null, n: 0 };
    });
    return map;
  }, [items]);

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
        {currentUser?.mondayUserId && (
          <div className="metric-card">
            <div className="metric-label">Meu tempo até o 1º contato</div>
            <div className="metric-value">
              {meuPrimeiroContato?.media != null ? `${meuPrimeiroContato.media.toFixed(1)} dia(s)` : '—'}
            </div>
            <div className="metric-sub">
              {meuPrimeiroContato?.n
                ? `${meuPrimeiroContato.noPrazoPct.toFixed(0)}% no mesmo dia ou dia seguinte (${meuPrimeiroContato.n} lead(s) com dado)`
                : 'Ainda sem dados suficientes'}
            </div>
          </div>
        )}
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
          <h3>Tempo médio por etapa do funil</h3>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: -6, marginBottom: 12 }}>
            Mostra onde o funil mais emperra. Dado confiável a partir de 20/08/2026 — etapas com poucos casos (n
            baixo) ainda não têm amostra suficiente.
          </p>
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Etapa</th>
                <th>Tempo médio</th>
                <th>Amostra</th>
              </tr>
            </thead>
            <tbody>
              {temposPorEstagio.map((t) => (
                <tr key={t.label}>
                  <td>{t.label}</td>
                  <td>{t.media != null ? `${t.media.toFixed(1)} dia(s)` : '—'}</td>
                  <td>{t.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="metrics-section">
          <h3>Conversão por segmento</h3>
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Segmento</th>
                <th>Total</th>
                <th>Fechados</th>
                <th>Perdidos</th>
                <th>Taxa (entre resolvidos)</th>
              </tr>
            </thead>
            <tbody>
              {conversaoPorSegmento.map((r) => (
                <tr key={r.segmento}>
                  <td>{r.segmento}</td>
                  <td>{r.total}</td>
                  <td>{r.fechados}</td>
                  <td>{r.perdidos}</td>
                  <td>{r.taxa != null ? `${r.taxa.toFixed(0)}%` : '—'}</td>
                </tr>
              ))}
              {conversaoPorSegmento.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--ink-soft)' }}>
                    Sem dados no filtro atual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
          {' '}A coluna "Realizado" mostra a taxa de fechamento real (histórica) de quem passou por cada estágio, pra
          comparar com a probabilidade configurada — confiável a partir de 20/08/2026, quando essas datas passaram a
          ser registradas automaticamente.
        </p>
        {probsError && <div className="banner banner-error" style={{ borderRadius: 8, marginBottom: 12 }}>{probsError}</div>}
        <table className="metrics-table">
          <thead>
            <tr>
              <th>Estágio</th>
              <th>Valor em aberto</th>
              <th>Probabilidade (configurada)</th>
              <th>Realizado (histórico)</th>
              <th>Contribuição no forecast</th>
            </tr>
          </thead>
          <tbody>
            {FORECAST_STAGES.map((s) => {
              const valorAberto = valorAbertoPorEstagio[s] || 0;
              const p = draft ? Number(draft[s]) : null;
              const contribuicao = probs ? valorAberto * ((probs[s] || 0) / 100) : null;
              const realizado = realizadoPorEstagio[s];
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
                  <td>
                    {realizado?.pct != null ? `${realizado.pct.toFixed(0)}% (n=${realizado.n})` : '— (sem dado ainda)'}
                  </td>
                  <td>{contribuicao === null ? '—' : formatMoney(contribuicao)}</td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>
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

      <div className="metrics-section">
        <h3>Motivos de perda × segmento × canal de origem</h3>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: -6, marginBottom: 12 }}>
          Cruza os três campos pra achar padrões escondidos (ex: "perdemos por preço quase só num segmento
          específico").
        </p>
        {motivosDetalhado.length === 0 && (
          <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>Nenhum lead perdido no filtro atual.</div>
        )}
        {motivosDetalhado.length > 0 && (
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Motivo</th>
                <th>Segmento</th>
                <th>Canal de origem</th>
                <th>Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {motivosDetalhado.map((r) => (
                <tr key={`${r.motivo}|${r.segmento}|${r.canal}`}>
                  <td>{r.motivo}</td>
                  <td>{r.segmento}</td>
                  <td>{r.canal}</td>
                  <td>{r.qtd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
