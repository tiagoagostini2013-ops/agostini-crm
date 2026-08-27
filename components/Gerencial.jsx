'use client';

import { useEffect, useMemo, useState } from 'react';
import LeadListModal from './LeadListModal';
import { STAGES } from '../lib/config';

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

export default function Gerencial({ items, usersById, onSelect, hasActiveFilter, onClearFilters }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  // ---------- Drill-down: clicar num número mostra os leads por trás dele ----------
  // Mesmo mecanismo da aba Métricas (ver LeadListModal) — pedido do Tiago em
  // 20/08/2026, citando especificamente o card "Perdidos hoje" que não levava
  // a lugar nenhum ao clicar. Os blocos de Vendas × Produção (Fase 8) ficam
  // de fora de propósito: PEDIDOS/OPs não são leads do CRM, não existe um
  // "card completo" pra abrir pra eles (isso é a Fase 8 Parte B, não feita).
  const [drillDown, setDrillDown] = useState(null);
  function openDrill(title, leads, subtitle) {
    setDrillDown({ title, subtitle, sections: [{ leads }] });
  }
  function openDrillSections(title, sections, subtitle) {
    setDrillDown({ title, subtitle, sections });
  }
  function handleSelectLead(id) {
    setDrillDown(null);
    onSelect?.(id);
  }

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
  // Guarda tanto a contagem quanto a lista de leads por trás de cada uma —
  // é o que os cards clicáveis abaixo mostram no drill-down.
  const kpis = useMemo(() => {
    const out = {
      novosHojeLeads: [],
      novos7dLeads: [],
      qualHojeLeads: [],
      qual7dLeads: [],
      fechHojeLeads: [],
      fechHojeValor: 0,
      perdHojeLeads: [],
    };
    const amanha = addDays(hoje, 1);
    for (const it of items) {
      const criado = toDateOnly(it.createdAt);
      if (inRange(criado, hoje, amanha)) out.novosHojeLeads.push(it);
      if (inRange(criado, seteDiasAtras, amanha)) out.novos7dLeads.push(it);

      const qual = toDateOnly(it.dataQualificacao);
      if (inRange(qual, hoje, amanha)) out.qualHojeLeads.push(it);
      if (inRange(qual, seteDiasAtras, amanha)) out.qual7dLeads.push(it);

      const fech = toDateOnly(it.dataFechamento);
      if (inRange(fech, hoje, amanha)) {
        out.fechHojeLeads.push(it);
        const v = Number(it.valorEstimado);
        if (!Number.isNaN(v)) out.fechHojeValor += v;
      }

      const perd = toDateOnly(it.dataPerda);
      if (inRange(perd, hoje, amanha)) out.perdHojeLeads.push(it);
    }
    return out;
  }, [items, hoje, seteDiasAtras]);

  const taxaQualificacao7d = kpis.novos7dLeads.length > 0 ? (kpis.qual7dLeads.length / kpis.novos7dLeads.length) * 100 : null;

  // ---------- Funil agora (contagem ao vivo por estágio) ----------
  // Pedido do Tiago em 27/08/2026: os KPIs/evolução semanal acima só contam
  // uma transição de estágio quando ela carimba dataQualificacao/
  // dataFechamento/dataPerda (ver STAGE_DATE_COLUMNS) — e isso só acontece
  // quando a mudança é feita pelo Kanban/drawer do próprio CRM (ver PATCH em
  // app/api/items/[id]/route.js). Mudanças feitas direto no quadro do
  // monday.com (confirmado como o fluxo mais comum do time) nunca carimbam
  // essa data, então ficam invisíveis pros números acima mesmo aparecendo
  // certinho no monday. Esta contagem aqui usa só o campo "estagio" atual de
  // cada lead — o mesmo valor que está no quadro do monday agora — então bate
  // com o monday sempre, independente de como o estágio foi mudado.
  const stageCounts = useMemo(() => {
    const map = {};
    STAGES.forEach((s) => (map[s.value] = []));
    for (const it of items) {
      if (it.estagio && map[it.estagio]) map[it.estagio].push(it);
    }
    return map;
  }, [items]);

  // ---------- Evolução semanal (últimas 8 semanas, seg-dom) ----------
  const semanas = useMemo(() => {
    const list = [];
    for (let i = WEEKS - 1; i >= 0; i--) {
      const start = addDays(semanaInicio, -7 * i);
      const end = addDays(start, 7);
      list.push({ start, end, novosLeads: [], qualificadosLeads: [], fechadosLeads: [] });
    }
    for (const it of items) {
      const criado = toDateOnly(it.createdAt);
      const qual = toDateOnly(it.dataQualificacao);
      const fech = toDateOnly(it.dataFechamento);
      for (const semana of list) {
        if (inRange(criado, semana.start, semana.end)) semana.novosLeads.push(it);
        if (inRange(qual, semana.start, semana.end)) semana.qualificadosLeads.push(it);
        if (inRange(fech, semana.start, semana.end)) semana.fechadosLeads.push(it);
      }
    }
    return list.map((s) => ({
      ...s,
      novos: s.novosLeads.length,
      qualificados: s.qualificadosLeads.length,
      fechados: s.fechadosLeads.length,
    }));
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

  // ---------- Fase 9 — carga de pós-venda por vendedor ----------
  // O roadmap original pedia "carga do vendedor SECUNDÁRIO" especificamente,
  // mas o CRM não guarda essa distinção de forma estruturada: o handoff de
  // entrega (ver HandoffModal/LeadDrawer) só ADICIONA o secundário à mesma
  // coluna de responsáveis do principal — quem é "principal" e quem é
  // "secundário" fica só registrado em texto livre numa anotação, não dá pra
  // consultar de forma confiável. Por isso, a métrica que dá pra construir
  // com o dado que existe é mais ampla: quanto da carteira de CADA
  // responsável (principal ou secundário, sem diferenciar) é composta por
  // clientes já fechados (pós-venda/manutenção) vs. leads ainda em
  // prospecção (funil ativo). Isso já responde à pergunta de fundo — "o
  // pós-venda está consumindo a agenda de alguém mais que deveria?" — mesmo
  // sem isolar o secundário sozinho.
  const cargaPosVenda = useMemo(() => {
    const map = {};
    function ensure(id) {
      if (!map[id]) map[id] = { id, posVenda: 0, ativo: 0, perdido: 0 };
      return map[id];
    }
    for (const it of items) {
      const ids = it.responsavelIds && it.responsavelIds.length ? it.responsavelIds : ['sem-responsavel'];
      for (const id of ids) {
        const row = ensure(id);
        if (it.estagio === 'Fechado') row.posVenda += 1;
        else if (it.estagio === 'Perdido') row.perdido += 1;
        else row.ativo += 1;
      }
    }
    return Object.values(map)
      .map((r) => {
        const carteira = r.posVenda + r.ativo; // perdidos ficam fora — não consomem agenda
        return { ...r, carteira, pctPosVenda: carteira ? (r.posVenda / carteira) * 100 : null };
      })
      .filter((r) => r.carteira > 0)
      .sort((a, b) => (b.pctPosVenda ?? -1) - (a.pctPosVenda ?? -1));
  }, [items]);

  return (
    <div className="metrics-view">
      {hasActiveFilter && (
        <div className="banner banner-warning banner-dismissible" style={{ borderRadius: 8, marginBottom: 16 }}>
          <span>
            ⚠ Filtro ativo no topo da tela (responsável/segmento/canal/busca): todos os números desta página —
            inclusive Qualificados, Fechados e Perdidos — estão contando só os leads que passam nesse filtro, não o
            funil inteiro.
          </span>
          {onClearFilters && (
            <button className="btn-link" onClick={onClearFilters} style={{ flexShrink: 0 }}>
              Limpar filtros
            </button>
          )}
        </div>
      )}

      <div className="banner banner-info" style={{ borderRadius: 8, marginBottom: 16 }}>
        Painel visível só para administradores. "Novos leads" reflete a data de criação real de cada lead (sempre
        precisa). Já "Qualificados", "Fechados" e "Perdidos" (nos KPIs e na evolução semanal abaixo) só contam
        transições feitas pelo Kanban/drawer do próprio CRM — mudanças de estágio feitas direto no quadro do
        monday.com não carimbam essa data e por isso não entram nesses números. Essas colunas de data também só
        existem a partir de 20/08/2026, com reconstrução parcial via log de atividades do monday.com (mais completa
        a partir de meados de abril de 2026) — semanas mais antigas podem aparecer artificialmente baixas. Pra um
        número que bate com o monday.com sempre, use o "Funil agora" logo abaixo.
      </div>

      <div className="metrics-section">
        <h3>Funil agora (contagem ao vivo por estágio)</h3>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: -6, marginBottom: 12 }}>
          Conta o estágio atual de cada lead — o mesmo campo que aparece no quadro do monday.com —, então bate com o
          monday mesmo quando o estágio foi mudado direto lá, sem passar pelo CRM.
        </p>
        <div className="metrics-grid">
          {STAGES.map((s) => {
            const leads = stageCounts[s.value] || [];
            return (
              <div
                key={s.value}
                className={`metric-card${leads.length ? ' card-clickable' : ''}`}
                onClick={leads.length ? () => openDrill(`${s.value} agora`, leads) : undefined}
                title={leads.length ? 'Ver os leads' : undefined}
              >
                <div className="metric-label">{s.value}</div>
                <div className="metric-value">{leads.length}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="metrics-grid">
        <div
          className={`metric-card${kpis.novosHojeLeads.length ? ' card-clickable' : ''}`}
          onClick={kpis.novosHojeLeads.length ? () => openDrill('Novos leads hoje', kpis.novosHojeLeads) : undefined}
          title={kpis.novosHojeLeads.length ? 'Ver os leads' : undefined}
        >
          <div className="metric-label">Novos leads hoje</div>
          <div className="metric-value">{kpis.novosHojeLeads.length}</div>
          <div
            className={kpis.novos7dLeads.length ? 'metric-sub card-clickable' : 'metric-sub'}
            style={{ display: 'inline-block' }}
            onClick={
              kpis.novos7dLeads.length
                ? (e) => {
                    e.stopPropagation();
                    openDrill('Novos leads nos últimos 7 dias', kpis.novos7dLeads);
                  }
                : undefined
            }
          >
            {kpis.novos7dLeads.length} nos últimos 7 dias
          </div>
        </div>
        <div
          className={`metric-card${kpis.qualHojeLeads.length ? ' card-clickable' : ''}`}
          onClick={kpis.qualHojeLeads.length ? () => openDrill('Qualificados hoje', kpis.qualHojeLeads) : undefined}
          title={kpis.qualHojeLeads.length ? 'Ver os leads' : undefined}
        >
          <div className="metric-label">Qualificados hoje</div>
          <div className="metric-value">{kpis.qualHojeLeads.length}</div>
          <div
            className={kpis.qual7dLeads.length ? 'metric-sub card-clickable' : 'metric-sub'}
            style={{ display: 'inline-block' }}
            onClick={
              kpis.qual7dLeads.length
                ? (e) => {
                    e.stopPropagation();
                    openDrill('Qualificados nos últimos 7 dias', kpis.qual7dLeads);
                  }
                : undefined
            }
          >
            {kpis.qual7dLeads.length} nos últimos 7 dias
          </div>
        </div>
        <div
          className={`metric-card${kpis.qual7dLeads.length ? ' card-clickable' : ''}`}
          onClick={
            kpis.qual7dLeads.length
              ? () =>
                  openDrillSections(
                    'Taxa de qualificação (7 dias)',
                    [
                      { label: 'Novos leads (denominador)', leads: kpis.novos7dLeads },
                      { label: 'Qualificados (numerador)', leads: kpis.qual7dLeads },
                    ],
                    'Qualificados ÷ novos leads, últimos 7 dias.'
                  )
              : undefined
          }
          title={kpis.qual7dLeads.length ? 'Ver os leads' : undefined}
        >
          <div className="metric-label">Taxa de qualificação (7 dias)</div>
          <div className="metric-value">{taxaQualificacao7d === null ? '—' : `${taxaQualificacao7d.toFixed(0)}%`}</div>
          <div className="metric-sub">Qualificados ÷ novos leads, últimos 7 dias</div>
        </div>
        <div
          className={`metric-card${kpis.fechHojeLeads.length ? ' card-clickable' : ''}`}
          onClick={kpis.fechHojeLeads.length ? () => openDrill('Fechados hoje', kpis.fechHojeLeads) : undefined}
          title={kpis.fechHojeLeads.length ? 'Ver os leads' : undefined}
        >
          <div className="metric-label">Fechados hoje</div>
          <div className="metric-value">{kpis.fechHojeLeads.length}</div>
          <div className="metric-sub">
            {kpis.fechHojeValor
              ? kpis.fechHojeValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
              : 'sem valor estimado'}
          </div>
        </div>
        <div
          className={`metric-card${kpis.perdHojeLeads.length ? ' card-clickable' : ''}`}
          onClick={kpis.perdHojeLeads.length ? () => openDrill('Perdidos hoje', kpis.perdHojeLeads) : undefined}
          title={kpis.perdHojeLeads.length ? 'Ver os leads' : undefined}
        >
          <div className="metric-label">Perdidos hoje</div>
          <div className="metric-value">{kpis.perdHojeLeads.length}</div>
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
                    aria-label={`Semana de ${fmtShort(s.start)}: ${s.novos} novos leads, ${s.qualificados} qualificados, ${s.fechados} fechados. Clique para ver os leads.`}
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
                    onFocus={() => setHoverIdx(i)}
                    onBlur={() => setHoverIdx((cur) => (cur === i ? null : cur))}
                    onClick={() =>
                      openDrillSections(
                        `Semana de ${fmtShort(s.start)} a ${fmtShort(addDays(s.end, -1))}`,
                        [
                          { label: 'Novos leads', leads: s.novosLeads },
                          { label: 'Qualificados', leads: s.qualificadosLeads },
                          { label: 'Fechados', leads: s.fechadosLeads },
                        ]
                      )
                    }
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
              <tr
                key={i}
                className="row-clickable"
                onClick={() =>
                  openDrillSections(`Semana de ${fmtShort(s.start)} a ${fmtShort(addDays(s.end, -1))}`, [
                    { label: 'Novos leads', leads: s.novosLeads },
                    { label: 'Qualificados', leads: s.qualificadosLeads },
                    { label: 'Fechados', leads: s.fechadosLeads },
                  ])
                }
                title="Ver os leads"
              >
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
            {porVendedor.map((r) => {
              const nome = r.id === 'sem-responsavel' ? 'Sem responsável' : usersById?.[r.id]?.name || `#${r.id}`;
              return (
                <tr
                  key={r.id}
                  className="row-clickable"
                  onClick={() =>
                    openDrill(
                      `Leads de ${nome}`,
                      items.filter((it) =>
                        r.id === 'sem-responsavel' ? it.responsavelIds.length === 0 : it.responsavelIds.includes(r.id)
                      )
                    )
                  }
                  title="Ver os leads"
                >
                  <td>{nome}</td>
                  <td>{r.total}</td>
                  <td>
                    {r.noPrazoPct != null ? `${r.noPrazoPct.toFixed(0)}% (n=${r.comContato})` : '— (sem dado ainda)'}
                  </td>
                  <td>{r.mediaContato != null ? `${r.mediaContato.toFixed(1)} dia(s)` : '—'}</td>
                  <td>{r.conversaoPct != null ? `${r.conversaoPct.toFixed(0)}% (n=${r.resolvidos})` : '—'}</td>
                </tr>
              );
            })}
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

      <div className="metrics-section">
        <h3>Carga de pós-venda por vendedor (Fase 9)</h3>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: -6, marginBottom: 12 }}>
          O CRM não distingue estruturalmente "vendedor principal" de "vendedor secundário" depois do handoff de
          entrega — os dois ficam como responsáveis do mesmo lead. Por isso esta tabela mostra a carteira de cada
          responsável (some quem participou, sem separar quem vendeu originalmente de quem recebeu a entrega): que
          fração dela já é cliente fechado (manutenção/pós-venda) vs. ainda em prospecção (funil ativo). Leads
          perdidos ficam fora da conta — não consomem agenda de manutenção nem de prospecção.
        </p>
        <table className="metrics-table">
          <thead>
            <tr>
              <th>Vendedor</th>
              <th>Carteira ativa</th>
              <th>Em prospecção</th>
              <th>Pós-venda (fechados)</th>
              <th>% da carteira em pós-venda</th>
            </tr>
          </thead>
          <tbody>
            {cargaPosVenda.map((r) => {
              const nome = r.id === 'sem-responsavel' ? 'Sem responsável' : usersById?.[r.id]?.name || `#${r.id}`;
              return (
                <tr
                  key={r.id}
                  className="row-clickable"
                  onClick={() =>
                    openDrill(
                      `Carteira de ${nome}`,
                      items.filter((it) => {
                        const meu = r.id === 'sem-responsavel' ? it.responsavelIds.length === 0 : it.responsavelIds.includes(r.id);
                        return meu && it.estagio !== 'Perdido';
                      }),
                      'Fechados (pós-venda) + leads em prospecção — perdidos ficam fora, como no cálculo da tabela.'
                    )
                  }
                  title="Ver a carteira"
                >
                  <td>{nome}</td>
                  <td>{r.carteira}</td>
                  <td>{r.ativo}</td>
                  <td>{r.posVenda}</td>
                  <td>{r.pctPosVenda != null ? `${r.pctPosVenda.toFixed(0)}%` : '—'}</td>
                </tr>
              );
            })}
            {cargaPosVenda.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--ink-soft)' }}>
                  Sem dados no filtro atual.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {drillDown && (
        <LeadListModal
          title={drillDown.title}
          subtitle={drillDown.subtitle}
          sections={drillDown.sections}
          usersById={usersById}
          onSelectLead={handleSelectLead}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  );
}
