'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { TEMPERATURAS_PAINEL_VENDAS, TEMPERATURA_CORES } from '../lib/config';

const CHART_H = 160;
const CHART_PAD_TOP = 16;
const BAR_W = 34;
const GROUP_GAP = 14;
const MAX_GROUP_GAP = 40; // limite pra não esticar demais o espaçamento com poucas semanas salvas
const TOOLTIP_HALF_W = 110; // largura aproximada do tooltip ÷ 2, pra não deixar ele vazar pra fora do gráfico

// Mantém o tooltip dentro da área do gráfico mesmo perto das bordas (poucas
// semanas = gráfico estreito) — sem isso, centralizar sempre na barra faz o
// tooltip cobrir as barras vizinhas quando o gráfico é mais estreito que ele.
function clampTooltipLeftPx(anchorPx, chartW) {
  const minL = TOOLTIP_HALF_W;
  const maxL = chartW - TOOLTIP_HALF_W;
  if (minL > maxL) return chartW / 2;
  return Math.min(Math.max(anchorPx, minL), maxL);
}

function fmtShort(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

// Painel de Vendas semanal (pedido do Tiago em 28/08/2026) — reproduz dentro
// do CRM o resumo manual que ele já fazia num caderno: uma lista de negócios
// em andamento (nome, valor, status "ok", "temperatura" Frio/Morno/Quente/
// Fechado) e um fechamento da semana com quatro categorias narrativas,
// digitadas livremente (Apalavreamentos, Evoluções, Surgidos, Perdidas).
// Tudo manual, sem vínculo com os leads do funil principal — ver nota em
// lib/config.js sobre o board separado que guarda isso (um item por semana).

function blankNegocio() {
  return { nome: '', valor: '', ok: false, temperatura: 'Morno' };
}

function todayStr() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function fmtMoney(v) {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

// Versão curta pro eixo do gráfico e pros rótulos em cima das barras (não cabe
// "R$ 1.234.567" ali) — "R$ 1,2mi" / "R$ 850mil".
function fmtMoneyCompact(v) {
  const n = Number(v) || 0;
  if (n >= 1000000) return `R$ ${(n / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}mi`;
  if (n >= 1000) return `R$ ${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}mil`;
  return `R$ ${n.toLocaleString('pt-BR')}`;
}

function fmtDatePt(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function blankForm() {
  return {
    inicioSemana: '',
    fimSemana: '',
    negocios: [blankNegocio()],
    apalavreamentos: '',
    evolucoes: '',
    surgidos: '',
    perdidas: '',
  };
}

export default function PainelVendas() {
  const [semanas, setSemanas] = useState(null);
  const [selectedId, setSelectedId] = useState(null); // null = nova semana não salva
  const [form, setForm] = useState(blankForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hoverIdx, setHoverIdx] = useState(null);
  const [chartContainerW, setChartContainerW] = useState(0);
  const chartWrapRef = useRef(null);

  // Mede a largura disponível pro gráfico de evolução, pra poder esticar o
  // espaçamento entre barras quando há poucas semanas salvas (em vez de deixar
  // um gráfico minúsculo encostado à esquerda) — ver evolucaoLayout abaixo.
  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setChartContainerW(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/painel-vendas');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar o painel de vendas.');
      setSemanas(data.semanas);
      if (data.semanas.length > 0) {
        selectSemana(data.semanas[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectSemana(s) {
    setSelectedId(s.id);
    setForm({
      inicioSemana: s.inicioSemana || '',
      fimSemana: s.fimSemana || '',
      negocios: s.negocios.length > 0 ? s.negocios.map((n) => ({ ...n })) : [blankNegocio()],
      apalavreamentos: s.apalavreamentos || '',
      evolucoes: s.evolucoes || '',
      surgidos: s.surgidos || '',
      perdidas: s.perdidas || '',
    });
    setError('');
  }

  function novaSemana(duplicarNegocios) {
    setSelectedId(null);
    const negociosBase =
      duplicarNegocios && semanas && semanas.length > 0
        ? semanas[0].negocios.map((n) => ({ ...n }))
        : [blankNegocio()];
    setForm({ ...blankForm(), inicioSemana: todayStr(), negocios: negociosBase });
    setError('');
  }

  function updateNegocio(index, patch) {
    setForm((f) => ({
      ...f,
      negocios: f.negocios.map((n, i) => (i === index ? { ...n, ...patch } : n)),
    }));
  }

  function addNegocio() {
    setForm((f) => ({ ...f, negocios: [...f.negocios, blankNegocio()] }));
  }

  function removeNegocio(index) {
    setForm((f) => ({ ...f, negocios: f.negocios.filter((_, i) => i !== index) }));
  }

  const total = useMemo(
    () => form.negocios.reduce((acc, n) => acc + (Number(n.valor) || 0), 0),
    [form.negocios]
  );

  // Agrupa os negócios já digitados acima por status (pedido do Tiago em
  // 28/08/2026) — é só uma reorganização visual da mesma lista, não um dado
  // separado: mudar a temperatura de um negócio no editor de cima já move ele
  // pro grupo certo aqui embaixo automaticamente, sem nenhum passo extra.
  const gruposPorStatus = useMemo(() => {
    const map = {};
    TEMPERATURAS_PAINEL_VENDAS.forEach((t) => (map[t] = []));
    for (const n of form.negocios) {
      if (!n.nome.trim() && !n.valor) continue; // ignora linha em branco
      const t = TEMPERATURAS_PAINEL_VENDAS.includes(n.temperatura) ? n.temperatura : TEMPERATURAS_PAINEL_VENDAS[0];
      map[t].push(n);
    }
    return map;
  }, [form.negocios]);

  // Evolução semanal (pedido do Tiago em 28/08/2026) — soma o valor de todos
  // os negócios de cada semana já salva, quebrado por status, em ordem
  // cronológica. Mostra como a "expectativa de vendas" (o quanto está em cada
  // temperatura) muda de semana pra semana — não depende da semana
  // selecionada no editor, olha o histórico inteiro salvo no board.
  const evolucaoSemanal = useMemo(() => {
    if (!semanas) return [];
    return [...semanas]
      .sort((a, b) => (a.inicioSemana || '').localeCompare(b.inicioSemana || ''))
      .map((s) => {
        const porStatus = {};
        TEMPERATURAS_PAINEL_VENDAS.forEach((t) => (porStatus[t] = 0));
        for (const n of s.negocios) {
          const t = TEMPERATURAS_PAINEL_VENDAS.includes(n.temperatura) ? n.temperatura : TEMPERATURAS_PAINEL_VENDAS[0];
          porStatus[t] += Number(n.valor) || 0;
        }
        const total = Object.values(porStatus).reduce((a, b) => a + b, 0);
        return { id: s.id, inicioSemana: s.inicioSemana, fimSemana: s.fimSemana, porStatus, total };
      });
  }, [semanas]);

  const evolucaoMaxRaw = Math.max(1, ...evolucaoSemanal.map((s) => s.total));
  // Eixo Y arredondado pra um número "redondo" acima do maior total real.
  const evolucaoYMax = useMemo(() => {
    const step =
      evolucaoMaxRaw <= 5000 ? 1000
      : evolucaoMaxRaw <= 50000 ? 5000
      : evolucaoMaxRaw <= 200000 ? 25000
      : evolucaoMaxRaw <= 1000000 ? 100000
      : evolucaoMaxRaw <= 5000000 ? 500000
      : 1000000;
    return Math.ceil(evolucaoMaxRaw / step) * step;
  }, [evolucaoMaxRaw]);
  const evolucaoYTicks = useMemo(() => {
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => Math.round((evolucaoYMax / n) * i));
  }, [evolucaoYMax]);
  // Largura do gráfico: com poucas semanas salvas, estica o espaçamento entre
  // barras (até um limite) pra preencher a largura disponível em vez de deixar
  // um gráfico minúsculo encostado à esquerda; com muitas semanas, mantém o
  // espaçamento padrão e passa a rolar horizontalmente (ver overflow-x no JSX).
  const evolucaoN = evolucaoSemanal.length;
  const evolucaoMinChartW = GROUP_GAP + evolucaoN * (BAR_W + GROUP_GAP);
  const evolucaoMaxStretchedW = evolucaoN > 0 ? MAX_GROUP_GAP + evolucaoN * (BAR_W + MAX_GROUP_GAP) : evolucaoMinChartW;
  const evolucaoChartW =
    evolucaoN > 0 ? Math.min(Math.max(evolucaoMinChartW, chartContainerW || 0), evolucaoMaxStretchedW) : evolucaoMinChartW;
  const evolucaoGap = evolucaoN > 0 ? (evolucaoChartW - evolucaoN * BAR_W) / (evolucaoN + 1) : GROUP_GAP;
  const hoveredSemana = hoverIdx !== null ? evolucaoSemanal[hoverIdx] : null;

  function yToPxEvo(v) {
    return CHART_PAD_TOP + (CHART_H - CHART_PAD_TOP) * (1 - v / evolucaoYMax);
  }

  async function salvar() {
    if (!form.inicioSemana || !form.fimSemana) {
      setError('Preencha início e fim da semana antes de salvar.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // Não manda linhas de negócio totalmente em branco (linha extra deixada
      // sem preencher) — só o que tem nome ou valor.
      const negocios = form.negocios.filter((n) => n.nome.trim() || n.valor);
      const payload = { ...form, negocios };

      const isNew = selectedId === null;
      const res = await fetch(isNew ? '/api/painel-vendas' : `/api/painel-vendas/${selectedId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar.');
      await load();
      if (isNew && data.id) setSelectedId(data.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function excluir() {
    if (selectedId === null) return;
    if (!confirm('Excluir esta semana do painel de vendas? Não dá pra desfazer.')) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/painel-vendas/${selectedId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro ao excluir.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="metrics-section">Carregando painel de vendas...</div>;

  return (
    <div className="painel-vendas">
      {error && <div className="banner banner-error">{error}</div>}

      <div className="metrics-section">
        <h3>Evolução semanal das expectativas de vendas</h3>

        {evolucaoSemanal.length === 0 ? (
          <div className="agenda-empty">
            Nenhuma semana salva ainda — o gráfico aparece assim que houver ao menos uma semana registrada.
          </div>
        ) : (
          <>
            <div className="gerencial-legend">
              {TEMPERATURAS_PAINEL_VENDAS.map((t) => (
                <span key={t}>
                  <i style={{ background: TEMPERATURA_CORES[t] }} /> {t}
                </span>
              ))}
            </div>

            {/* overflow-x: auto — a lista de semanas só cresce, então em vez de
                espremer as barras conforme o histórico aumenta, o gráfico
                mantém a largura de barra e passa a rolar horizontalmente. */}
            <div style={{ overflowX: 'auto' }} ref={chartWrapRef}>
            <div style={{ position: 'relative', width: evolucaoChartW }}>
              <svg
                viewBox={`0 0 ${evolucaoChartW} ${CHART_H + 26}`}
                width={evolucaoChartW}
                height={CHART_H + 26}
                role="img"
                aria-label="Evolução semanal do valor em negociação, por status"
                style={{ display: 'block' }}
              >
                {evolucaoYTicks.map((t, i) => (
                  <g key={i}>
                    <line x1={0} x2={evolucaoChartW} y1={yToPxEvo(t)} y2={yToPxEvo(t)} stroke="#e1e0d9" strokeWidth={1} />
                    <text x={0} y={yToPxEvo(t) - 4} fontSize="9" fill="#898781">
                      {fmtMoneyCompact(t)}
                    </text>
                  </g>
                ))}
                <line x1={0} x2={evolucaoChartW} y1={CHART_H} y2={CHART_H} stroke="#c3c2b7" strokeWidth={1} />

                {evolucaoSemanal.map((s, i) => {
                  const gx = evolucaoGap + i * (BAR_W + evolucaoGap);
                  const isHover = hoverIdx === i;
                  let cum = 0;
                  const segs = TEMPERATURAS_PAINEL_VENDAS.map((t) => {
                    const v = s.porStatus[t] || 0;
                    const yTop = yToPxEvo(cum + v);
                    const yBottom = yToPxEvo(cum);
                    cum += v;
                    return { t, v, yTop, yBottom };
                  });
                  return (
                    <g key={s.id}>
                      {/* hit target — cobre todo o grupo + espaçamento, maior que a barra */}
                      <rect
                        x={gx - evolucaoGap / 2}
                        y={0}
                        width={BAR_W + evolucaoGap}
                        height={CHART_H}
                        fill="transparent"
                        tabIndex={0}
                        role="button"
                        aria-label={`Semana de ${fmtShort(s.inicioSemana)}: total ${fmtMoney(s.total) || 'R$ 0'}`}
                        onMouseEnter={() => setHoverIdx(i)}
                        onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
                        onFocus={() => setHoverIdx(i)}
                        onBlur={() => setHoverIdx((cur) => (cur === i ? null : cur))}
                      />
                      {isHover && (
                        <rect
                          x={gx - evolucaoGap / 2}
                          y={0}
                          width={BAR_W + evolucaoGap}
                          height={CHART_H}
                          fill="#2a78d6"
                          opacity={0.06}
                          pointerEvents="none"
                        />
                      )}
                      {segs.map((seg) => {
                        if (seg.v <= 0) return null;
                        const rawH = seg.yBottom - seg.yTop;
                        const h = Math.max(1, rawH - 2);
                        const y = rawH > 2 ? seg.yTop + 1 : seg.yTop;
                        return (
                          <rect
                            key={seg.t}
                            x={gx}
                            y={y}
                            width={BAR_W}
                            height={h}
                            rx={2}
                            fill={TEMPERATURA_CORES[seg.t]}
                            opacity={isHover || hoverIdx === null ? 1 : 0.35}
                            pointerEvents="none"
                          />
                        );
                      })}
                      {/* Valor exato só no tooltip (hover) — evita rótulo fixo em cima de
                          cada barra colidindo com as marcações do eixo Y, mesma lógica do
                          gráfico de Evolução semanal em Gerencial.jsx. */}
                      <text x={gx + BAR_W / 2} y={CHART_H + 16} fontSize="9" fill="#898781" textAnchor="middle">
                        {fmtShort(s.inicioSemana)}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {hoveredSemana && (
                <div
                  className="gerencial-tooltip"
                  style={{
                    left: `${(clampTooltipLeftPx(evolucaoGap + hoverIdx * (BAR_W + evolucaoGap) + BAR_W / 2, evolucaoChartW) / evolucaoChartW) * 100}%`,
                  }}
                >
                  <div className="gerencial-tooltip-title">
                    Semana de {fmtDatePt(hoveredSemana.inicioSemana)} a {fmtDatePt(hoveredSemana.fimSemana)}
                  </div>
                  {TEMPERATURAS_PAINEL_VENDAS.map((t) => (
                    <div key={t}>
                      <i style={{ background: TEMPERATURA_CORES[t] }} /> {t}:{' '}
                      <strong>{fmtMoney(hoveredSemana.porStatus[t]) || 'R$ 0'}</strong>
                    </div>
                  ))}
                  <div style={{ marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.25)', paddingTop: 4 }}>
                    Total: <strong>{fmtMoney(hoveredSemana.total) || 'R$ 0'}</strong>
                  </div>
                </div>
              )}
            </div>
            </div>
          </>
        )}
      </div>

      <div className="painel-vendas-layout">
        <div className="metrics-section painel-vendas-sidebar">
          <h3>Semanas</h3>
          <button className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }} onClick={() => novaSemana(true)}>
            + Nova semana
          </button>
          {semanas.length === 0 && <div className="agenda-empty">Nenhuma semana registrada ainda.</div>}
          <div className="painel-vendas-semana-list">
            {semanas.map((s) => (
              <button
                key={s.id}
                className={`painel-vendas-semana-item${selectedId === s.id ? ' active' : ''}`}
                onClick={() => selectSemana(s)}
              >
                {fmtDatePt(s.inicioSemana)} – {fmtDatePt(s.fimSemana)}
              </button>
            ))}
          </div>
        </div>

        <div className="painel-vendas-main">
          <div className="metrics-section">
            <h3>Período da semana</h3>
            <div className="field-row">
              <div className="field">
                <label>Início</label>
                <input
                  type="date"
                  value={form.inicioSemana}
                  onChange={(e) => setForm((f) => ({ ...f, inicioSemana: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Fim</label>
                <input
                  type="date"
                  value={form.fimSemana}
                  onChange={(e) => setForm((f) => ({ ...f, fimSemana: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="metrics-section">
            <h3>Negócios da semana</h3>
            <div className="painel-vendas-negocios">
              <div className="painel-vendas-negocio-row painel-vendas-negocio-header">
                <span>OK</span>
                <span>Negócio</span>
                <span>Valor</span>
                <span>Temperatura</span>
                <span></span>
              </div>
              {form.negocios.map((n, i) => (
                <div className="painel-vendas-negocio-row" key={i}>
                  <input type="checkbox" checked={!!n.ok} onChange={(e) => updateNegocio(i, { ok: e.target.checked })} />
                  <input
                    type="text"
                    placeholder="Nome do negócio"
                    value={n.nome}
                    onChange={(e) => updateNegocio(i, { nome: e.target.value })}
                  />
                  <input
                    type="number"
                    placeholder="0"
                    value={n.valor}
                    onChange={(e) => updateNegocio(i, { valor: e.target.value })}
                  />
                  <select value={n.temperatura} onChange={(e) => updateNegocio(i, { temperatura: e.target.value })}>
                    {TEMPERATURAS_PAINEL_VENDAS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button className="painel-vendas-remove" title="Remover" onClick={() => removeNegocio(i)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={addNegocio}>
              + Adicionar negócio
            </button>
            {total > 0 && (
              <div className="painel-vendas-total">
                Total: <strong>{fmtMoney(total)}</strong>
              </div>
            )}
          </div>

          <div className="metrics-section">
            <h3>Negócios por status</h3>
            <div className="painel-vendas-grupos">
              {TEMPERATURAS_PAINEL_VENDAS.map((t) => (
                <div className="painel-vendas-grupo" key={t}>
                  <div className={`painel-vendas-grupo-header painel-vendas-status-${t.toLowerCase()}`}>
                    {t} <span className="painel-vendas-grupo-count">{gruposPorStatus[t].length}</span>
                  </div>
                  {gruposPorStatus[t].length === 0 && <div className="painel-vendas-grupo-empty">—</div>}
                  {gruposPorStatus[t].map((n, i) => (
                    <div className="painel-vendas-grupo-item" key={i}>
                      <span>{n.ok ? '✓ ' : ''}{n.nome || '(sem nome)'}</span>
                      {fmtMoney(n.valor) && <span className="painel-vendas-grupo-valor">{fmtMoney(n.valor)}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="metrics-section">
            <h3>Fechamento da semana</h3>
            <div className="field">
              <label>1) Apalavreamentos</label>
              <textarea
                placeholder="Ex: Inka, Imi, Peretto, Rotary, Lucas + Minera — R$ 2.488.000,00 + R$ 500.000,00"
                value={form.apalavreamentos}
                onChange={(e) => setForm((f) => ({ ...f, apalavreamentos: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>2) Evoluções</label>
              <textarea
                placeholder="Ex: Minera, Sapata, Renan — R$ 1.570.000,00"
                value={form.evolucoes}
                onChange={(e) => setForm((f) => ({ ...f, evolucoes: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>3) Surgidos</label>
              <textarea
                placeholder="Ex: Tratre, Pré-lajes, Frank — R$ 560.000,00"
                value={form.surgidos}
                onChange={(e) => setForm((f) => ({ ...f, surgidos: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>4) Perdidas</label>
              <textarea
                placeholder="—"
                value={form.perdidas}
                onChange={(e) => setForm((f) => ({ ...f, perdidas: e.target.value }))}
              />
            </div>
          </div>

          <div className="painel-vendas-actions">
            <button className="btn btn-primary" onClick={salvar} disabled={saving}>
              {saving ? 'Salvando...' : selectedId === null ? 'Salvar semana' : 'Salvar alterações'}
            </button>
            {selectedId !== null && (
              <button className="btn btn-secondary" onClick={excluir} disabled={saving}>
                Excluir semana
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
