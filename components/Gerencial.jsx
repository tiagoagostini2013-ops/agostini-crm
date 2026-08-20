'use client';

import { useEffect, useMemo, useState } from 'react';

function formatMoney(v) {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return 'R$ 0';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

// Dashboard Gerencial — visível só para administradores (ver Dashboard.jsx,
// que só mostra a aba e renderiza este componente quando currentUser.admin).
// Pensado para quem gerencia o time, não para quem trabalha os leads: ritmo
// de entrada (novos leads), velocidade de qualificação e fechamento, e a
// evolução disso ao longo das últimas semanas — em vez do olhar "funil hoje"
// que o Kanban/Métricas já cobrem.
//
// Paleta e specs de marca seguem o método do skill de dataviz interno: as
// 3 primeiras cores da paleta categórica padrão (azul/laranja/água) são as
// únicas validadas para comparação par-a-par em todos os modos — por isso
// usadas aqui nessa ordem fixa (Novos Leads / Qualificados / Fechados), sem
// ciclar. O app não tem modo escuro em nenhuma outra tela, então esta
// também fica só no claro, para não introduzir uma inconsistência visual.
const COLORS = {
  novos: '#2a78d6', // azul — slot categórico 1
  qualificados: '#eb6834', // laranja — slot categórico 2
  fechados: '#1baf7a', // água — slot categórico 3
};

const WEEKS = 8;
const BAR_THICK = 16; // ≤24px por spec
const GROUP_GAP = 28;
const CHART_H = 200;
const CHART_PAD_TOP = 16;

function toDateOnly(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mondayOf(d) {
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function fmtShort(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

function inRange(d, start, end) {
  return d && d >= start && d < end;
}

export default function Gerencial({ items, usersById }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  // ---------- Fase 8 — Vendas × Produção (Parte A: painel agregado) ----------
  // Lê os boards PEDIDOS/PRODUÇÃO da fábrica via /api/producao (admin-only,
  // mesma regra desta aba inteira). Não tem relação com "items" (leads do
  // CRM) — ainda não existe vínculo lead↔pedido (isso é a Parte B, não
  // implementada), então este bloco é 100% independente do resto da tela.
  const [producao, setProducao] = useState(null);
  const [producaoLoading, setProducaoLoading] = useState(true);
  const [producaoError, setProducaoError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/producao')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setProducao(data);
      })
      .catch((err) => {
        if (!cancelled) setProducaoError(err.message || 'Não foi possível carregar os dados de produção.');
      })
      .finally(() => {
        if (!cancelled) setProducaoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hoje = useMemo(() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }, []);
  const semanaInicio = useMemo(() => mondayOf(new Date()), []);
  const seteDiasAtras = useMemo(() => addDays(hoje, -6), [hoje]);

  // ---------- KPIs do dia / dos últimos 7 dias ----------
  const kpis = useMemo(() => {
    const out = {
      novosHoje: 0,
      novos7d: 0,
      qualHoje: 0,
      qual7d: 0,
      fechHoje: 0,
      fechHojeValor: 0,
      perdHoje: 0,
    };
    const amanha = addDays(hoje, 1);
    for (const it of items) {
      const criado = toDateOnly(it.createdAt);
      if (inRange(criado, hoje, amanha)) out.novosHoje += 1;
      if (inRange(criado, seteDiasAtras, amanha)) out.novos7d += 1;

      const qual = toDateOnly(it.dataQualificacao);
      if (inRange(qual, hoje, amanha)) out.qualHoje += 1;
      if (inRange(qual, seteDiasAtras, amanha)) out.qual7d += 1;

      const fech = toDateOnly(it.dataFechamento);
      if (inRange(fech, hoje, amanha)) {
        out.fechHoje += 1;
        const v = Number(it.valorEstimado);
        if (!Number.isNaN(v)) out.fechHojeValor += v;
      }

      const perd = toDateOnly(it.dataPerda);
      if (inRange(perd, hoje, amanha)) out.perdHoje += 1;
    }
    return out;
  }, [items, hoje, seteDiasAtras]);

  const taxaQualificacao7d = kpis.novos7d > 0 ? (kpis.qual7d / kpis.novos7d) * 100 : null;

  // ---------- Evolução semanal (últimas 8 semanas, seg-dom) ----------
  const semanas = useMemo(() => {
    const list = [];
    for (let i = WEEKS - 1; i >= 0; i--) {
      const start = addDays(semanaInicio, -7 * i);
      const end = addDays(start, 7);
      list.push({ start, end, novos: 0, qualificados: 0, fechados: 0 });
    }
    for (const it of items) {
      const criado = toDateOnly(it.createdAt);
      const qual = toDateOnly(it.dataQualificacao);
      const fech = toDateOnly(it.dataFechamento);
      for (const semana of list) {
        if (inRange(criado, semana.start, semana.end)) semana.novos += 1;
        if (inRange(qual, semana.start, semana.end)) semana.qualificados += 1;
        if (inRange(fech, semana.start, semana.end)) semana.fechados += 1;
      }
    }
    return list;
  }, [items, semanaInicio]);

  const maxValor = Math.max(1, ...semanas.flatMap((s) => [s.novos, s.qualificados, s.fechados]));
  // Eixo Y arredondado pra um número "redondo" acima do máximo real.
  const yMax = useMemo(() => {
    const step = maxValor <= 5 ? 1 : maxValor <= 20 ? 5 : maxValor <= 50 ? 10 : 20;
    return Math.ceil(maxValor / step) * step;
  }, [maxValor]);
  const yTicks = useMemo(() => {
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => Math.round((yMax / n) * i));
  }, [yMax]);

  const groupWidth = BAR_THICK * 3 + 6; // 3 barras + 2 gaps pequenos entre elas
  const chartW = semanas.length * (groupWidth + GROUP_GAP) + GROUP_GAP;

  function yToPx(v) {
    return CHART_PAD_TOP + (CHART_H - CHART_PAD_TOP) * (1 - v / yMax);
  }

  const hovered = hoverIdx !== null ? semanas[hoverIdx] : null;

  // ---------- Fase 7 — desempenho por vendedor ----------
  // Comparação entre pessoas: decidido com o Tiago em 20/08/2026 que isso
  // fica só aqui (admin-only), diferente das métricas pessoais/agregadas da
  // aba Métricas, que qualquer vendedor já acessa. Um lead conta pra TODOS
  // os responsáveis vinculados a ele (o CRM permite mais de um — ex: depois
  // do handoff de entrega o vendedor secundário é adicionado sem remover o
  // principal), então o total de "leads" aqui pode ser levemente maior que o
  // total real de leads distintos.
  const porVendedor = useMemo(() => {
    const map = {};
    function ensure(id) {
      if (!map[id]) map[id] = { id, total: 0, contatoDiffs: [], noPrazo: 0, comContato: 0, fechados: 0, resolvidos: 0 };
      return map[id];
    }
    for (const it of items) {
      const ids = it.responsavelIds && it.responsavelIds.length ? it.responsavelIds : ['sem-responsavel'];
      for (const id of ids) {
        const row = ensure(id);
        row.total += 1;
        const criado = toDateOnly(it.createdAt);
        const contato = toDateOnly(it.dataPrimeiroContato);
        if (criado && contato) {
          const d = (contato - criado) / (1000 * 60 * 60 * 24);
          if (d >= 0) {
            row.contatoDiffs.push(d);
            row.comContato += 1;
            if (d <= 1) row.noPrazo += 1;
          }
        }
        if (it.estagio === 'Fechado' || it.estagio === 'Perdido') {
          row.resolvidos += 1;
          if (it.estagio === 'Fechado') row.fechados += 1;
        }
      }
    }
    return Object.values(map)
      .map((r) => ({
        ...r,
        mediaContato: r.contatoDiffs.length
          ? r.contatoDiffs.reduce((a, b) => a + b, 0) / r.contatoDiffs.length
          : null,
        noPrazoPct: r.comContato ? (r.noPrazo / r.comContato) * 100 : null,
        conversaoPct: r.resolvidos ? (r.fechados / r.resolvidos) * 100 : null,
      }))
      .sort((a, b) => b.total - a.total);
  }, [items]);

  return (
    <div className="metrics-view">
      <div className="banner banner-info" style={{ borderRadius: 8, marginBottom: 16 }}>
        Painel visível só para administradores. "Novos leads" reflete a data de criação real de cada lead (sempre
        precisa). Já "Qualificados", "Fechados" e "Perdidos" passaram a ser registrados automaticamente em
        20/08/2026 — antes disso, o monday.com não guardava essa data, então reconstruímos o que deu pelo log de
        atividades (cobertura parcial, mais completa a partir de meados de abril de 2026). Semanas mais antigas
        podem aparecer artificialmente baixas nessas duas séries.
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Novos leads hoje</div>
          <div className="metric-value">{kpis.novosHoje}</div>
          <div className="metric-sub">{kpis.novos7d} nos últimos 7 dias</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Qualificados hoje</div>
          <div className="metric-value">{kpis.qualHoje}</div>
          <div className="metric-sub">{kpis.qual7d} nos últimos 7 dias</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Taxa de qualificação (7 dias)</div>
          <div className="metric-value">{taxaQualificacao7d === null ? '—' : `${taxaQualificacao7d.toFixed(0)}%`}</div>
          <div className="metric-sub">Qualificados ÷ novos leads, últimos 7 dias</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Fechados hoje</div>
          <div className="metric-value">{kpis.fechHoje}</div>
          <div className="metric-sub">
            {kpis.fechHojeValor
              ? kpis.fechHojeValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
              : 'sem valor estimado'}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Perdidos hoje</div>
          <div className="metric-value">{kpis.perdHoje}</div>
        </div>
      </div>

      <div className="metrics-section">
        <h3>Evolução semanal (últimas {WEEKS} semanas)</h3>

        <div className="gerencial-legend">
          <span><i style={{ background: COLORS.novos }} /> Novos leads</span>
          <span><i style={{ background: COLORS.qualificados }} /> Qualificados</span>
          <span><i style={{ background: COLORS.fechados }} /> Fechados</span>
        </div>

        <div style={{ position: 'relative' }}>
          <svg
            viewBox={`0 0 ${chartW} ${CHART_H + 26}`}
            width="100%"
            height={CHART_H + 26}
            role="img"
            aria-label="Evolução semanal de novos leads, qualificados e fechados"
            style={{ display: 'block', overflow: 'visible' }}
          >
            {yTicks.map((t, i) => (
              <g key={i}>
                <line
                  x1={0}
                  x2={chartW}
                  y1={yToPx(t)}
                  y2={yToPx(t)}
                  stroke="#e1e0d9"
                  strokeWidth={1}
                />
                <text x={0} y={yToPx(t) - 4} fontSize="9" fill="#898781">
                  {t}
                </text>
              </g>
            ))}
            <line x1={0} x2={chartW} y1={CHART_H} y2={CHART_H} stroke="#c3c2b7" strokeWidth={1} />

            {semanas.map((s, i) => {
              const gx = GROUP_GAP + i * (groupWidth + GROUP_GAP);
              const bars = [
                { key: 'novos', v: s.novos, color: COLORS.novos },
                { key: 'qualificados', v: s.qualificados, color: COLORS.qualificados },
                { key: 'fechados', v: s.fechados, color: COLORS.fechados },
              ];
              const isHover = hoverIdx === i;
              return (
                <g key={i}>
                  {/* hit target — cobre todo o grupo + espaçamento, maior que as barras */}
                  <rect
                    x={gx - GROUP_GAP / 2}
                    y={0}
                    width={groupWidth + GROUP_GAP}
                    height={CHART_H}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`Semana de ${fmtShort(s.start)}: ${s.novos} novos leads, ${s.qualificados} qualificados, ${s.fechados} fechados`}
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
                    onFocus={() => setHoverIdx(i)}
                    onBlur={() => setHoverIdx((cur) => (cur === i ? null : cur))}
                    style={{ cursor: 'pointer' }}
                  />
                  {isHover && (
                    <rect
                      x={gx - GROUP_GAP / 2}
                      y={0}
                      width={groupWidth + GROUP_GAP}
                      height={CHART_H}
                      fill="#2a78d6"
                      opacity={0.06}
                      pointerEvents="none"
                    />
                  )}
                  {bars.map((b, bi) => {
                    const barH = Math.max(0, (CHART_H - yToPx(b.v)) - (CHART_H - CHART_H));
                    const h = (CHART_H - CHART_PAD_TOP) * (b.v / yMax);
                    const x = gx + bi * (BAR_THICK + 3);
                    const y = CHART_H - h;
                    return (
                      <rect
                        key={b.key}
                        x={x}
                        y={h > 0 ? y : CHART_H - 1}
                        width={BAR_THICK}
                        height={h > 0 ? h : 1}
                        rx={4}
                        fill={b.color}
                        opacity={isHover || hoverIdx === null ? 1 : 0.35}
                        pointerEvents="none"
                      />
                    );
                  })}
                  <text
                    x={gx + groupWidth / 2}
                    y={CHART_H + 16}
                    fontSize="9"
                    fill="#898781"
                    textAnchor="middle"
                  >
                    {fmtShort(s.start)}
                  </text>
                </g>
              );
            })}
          </svg>

          {hovered && (
            <div
              className="gerencial-tooltip"
              style={{ left: `${((GROUP_GAP + hoverIdx * (groupWidth + GROUP_GAP) + groupWidth / 2) / chartW) * 100}%` }}
            >
              <div className="gerencial-tooltip-title">
                Semana de {fmtShort(hovered.start)} a {fmtShort(addDays(hovered.end, -1))}
              </div>
              <div><i style={{ background: COLORS.novos }} /> Novos leads: <strong>{hovered.novos}</strong></div>
              <div><i style={{ background: COLORS.qualificados }} /> Qualificados: <strong>{hovered.qualificados}</strong></div>
              <div><i style={{ background: COLORS.fechados }} /> Fechados: <strong>{hovered.fechados}</strong></div>
            </div>
          )}
        </div>

        <table className="metrics-table" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>Semana</th>
              <th>Novos leads</th>
              <th>Qualificados</th>
              <th>Fechados</th>
            </tr>
          </thead>
          <tbody>
            {semanas.map((s, i) => (
              <tr key={i}>
                <td>
                  {fmtShort(s.start)} – {fmtShort(addDays(s.end, -1))}
                </td>
                <td>{s.novos}</td>
                <td>{s.qualificados}</td>
                <td>{s.fechados}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="metrics-section">
        <h3>Desempenho por vendedor (Fase 7)</h3>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: -6, marginBottom: 12 }}>
          "Contato no prazo" considera o mesmo dia ou o dia seguinte à criação do lead — as colunas de data do CRM não
          guardam hora, então não dá pra medir as 24h do SLA com mais precisão que isso. Confiável a partir de
          20/08/2026. Um lead pode contar para mais de um vendedor (ex: depois do handoff de entrega).
        </p>
        <table className="metrics-table">
          <thead>
            <tr>
              <th>Vendedor</th>
              <th>Leads</th>
              <th>Contato no prazo</th>
              <th>Tempo médio até 1º contato</th>
              <th>Conversão (entre resolvidos)</th>
            </tr>
          </thead>
          <tbody>
            {porVendedor.map((r) => (
              <tr key={r.id}>
                <td>{r.id === 'sem-responsavel' ? 'Sem responsável' : usersById?.[r.id]?.name || `#${r.id}`}</td>
                <td>{r.total}</td>
                <td>
                  {r.noPrazoPct != null ? `${r.noPrazoPct.toFixed(0)}% (n=${r.comContato})` : '— (sem dado ainda)'}
                </td>
                <td>{r.mediaContato != null ? `${r.mediaContato.toFixed(1)} dia(s)` : '—'}</td>
                <td>{r.conversaoPct != null ? `${r.conversaoPct.toFixed(0)}% (n=${r.resolvidos})` : '—'}</td>
              </tr>
            ))}
            {porVendedor.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--ink-soft)' }}>
                  Sem dados no filtro atual.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="metrics-section">
        <h3>Vendas × Produção (Fase 8)</h3>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: -6, marginBottom: 12 }}>
          Lê direto os boards PEDIDOS e PRODUÇÃO da fábrica — sistemas próprios do PCP, mantidos fora do CRM. Ainda
          não existe vínculo entre um lead do CRM e um Pedido específico, então esta visão é agregada (números do
          negócio como um todo), não por lead individual.
        </p>

        {producaoLoading && <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>Carregando...</div>}
        {producaoError && <div className="banner banner-error" style={{ borderRadius: 8 }}>{producaoError}</div>}

        {producao && (
          <>
            <div className="metrics-grid" style={{ marginBottom: 20 }}>
              <div className="metric-card">
                <div className="metric-label">Pedidos em aberto</div>
                <div className="metric-value">{producao.pedidos.totalAberto}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Pedidos atrasados</div>
                <div className="metric-value">{producao.pedidos.atrasados}</div>
                <div className="metric-sub">
                  {producao.pedidos.totalAberto > 0
                    ? `${((producao.pedidos.atrasados / producao.pedidos.totalAberto) * 100).toFixed(0)}% dos em aberto`
                    : ''}
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Valor total em aberto</div>
                <div className="metric-value">{formatMoney(producao.pedidos.valorTotalAberto)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Valor a receber</div>
                <div className="metric-value">{formatMoney(producao.pedidos.valorAReceber)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">OPs em produção</div>
                <div className="metric-value">{producao.producao.totalAberto}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">OPs com prazo estourado</div>
                <div className="metric-value">{producao.producao.atrasadas}</div>
              </div>
            </div>

            <div className="metrics-columns">
              <div className="metrics-section">
                <h3>Pedidos em aberto por tipo</h3>
                <table className="metrics-table">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Qtd</th>
                      <th>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {producao.pedidos.porTipo.map((t) => (
                      <tr key={t.tipo}>
                        <td>{t.tipo}</td>
                        <td>{t.qtd}</td>
                        <td>{formatMoney(t.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="metrics-section">
                <h3>OPs em produção por etapa</h3>
                <div className="funnel">
                  {producao.producao.porEstagio.map((e) => {
                    const max = Math.max(1, ...producao.producao.porEstagio.map((x) => x.qtd));
                    return (
                      <div className="funnel-row" key={e.titulo}>
                        <div className="funnel-label" title={e.titulo}>
                          {e.titulo}
                        </div>
                        <div className="funnel-bar-track">
                          <div
                            className="funnel-bar"
                            style={{ width: `${(e.qtd / max) * 100}%`, background: '#2a78d6' }}
                          />
                        </div>
                        <div className="funnel-count">{e.qtd}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-soft)' }}>
                Pedidos mais atrasados
              </h3>
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Pedido</th>
                    <th>Tipo</th>
                    <th>Prazo</th>
                    <th>Dias de atraso</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {producao.pedidos.listaAtrasados.map((p) => (
                    <tr key={p.id}>
                      <td>{p.cliente}</td>
                      <td>{p.numeroPedido || '—'}</td>
                      <td>{p.tipo}</td>
                      <td>{p.prazoEntrega || '—'}</td>
                      <td>{p.diasAtraso != null ? p.diasAtraso : '—'}</td>
                      <td>{formatMoney(p.total)}</td>
                    </tr>
                  ))}
                  {producao.pedidos.listaAtrasados.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ color: 'var(--ink-soft)' }}>
                        Nenhum pedido atrasado. 🎉
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
