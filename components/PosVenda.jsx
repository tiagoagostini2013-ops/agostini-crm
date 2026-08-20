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

// Faixas de urgência para a lista priorizada de reativação (Fase 9, item 1).
// "Nunca contatado" fica à frente de tudo — nem o primeiro contato pós-venda
// foi registrado, então é o caso mais frio da base.
const REACTIVATION_TIERS = [
  { key: 'nunca', label: 'Nunca contatado', rank: 0, test: (d) => d === null },
  { key: '180', label: 'Mais de 180 dias sem contato', rank: 1, test: (d) => d !== null && d > 180 },
  { key: '120', label: '120–180 dias sem contato', rank: 2, test: (d) => d !== null && d > 120 && d <= 180 },
  { key: '60', label: '60–120 dias sem contato', rank: 3, test: (d) => d !== null && d > 60 && d <= 120 },
];

const MAX_OPORTUNIDADES = 20;

function normalizeEmpresa(nome) {
  return (nome || '').trim().toLowerCase();
}

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

  // ---------- Fase 9, item 1 — oportunidades de reativação ----------
  // Lista priorizada (não só a contagem que já existia acima): quem está
  // mais tempo sem contato E tem mais valor em jogo aparece primeiro, pra dar
  // um roteiro de ligação pronto em vez de só um alerta genérico.
  const oportunidadesReativacao = useMemo(() => {
    const comTier = baseInstalada
      .map((it) => {
        const dias = daysSince(it.ultimoContato);
        const tier = REACTIVATION_TIERS.find((t) => t.test(dias));
        return tier ? { it, dias, tier } : null;
      })
      .filter(Boolean);
    comTier.sort((a, b) => {
      if (a.tier.rank !== b.tier.rank) return a.tier.rank - b.tier.rank;
      return (Number(b.it.valorEstimado) || 0) - (Number(a.it.valorEstimado) || 0);
    });
    return { lista: comTier.slice(0, MAX_OPORTUNIDADES), total: comTier.length };
  }, [baseInstalada]);

  // ---------- Fase 9, item 2 — recompra por segmento ----------
  // "Recompra" aqui = a mesma empresa (comparando o texto do campo Empresa,
  // sem normalização além de trim/minúsculas — variações de digitação entre
  // cadastros diferentes não são reconhecidas como o mesmo cliente) aparece
  // em mais de um lead fechado. Pra cada fechamento, olhamos se aquela
  // empresa já tinha um fechamento anterior (por data) — se sim, esse
  // fechamento conta como recompra, atribuída ao segmento dele. Leads
  // fechados sem campo Empresa preenchido ficam de fora do cálculo (contados
  // à parte, avisado na tela).
  const recompraPorSegmento = useMemo(() => {
    const fechadosComEmpresa = items.filter((it) => it.estagio === 'Fechado' && normalizeEmpresa(it.empresa));
    const semEmpresa = items.filter((it) => it.estagio === 'Fechado' && !normalizeEmpresa(it.empresa)).length;

    const porEmpresa = {};
    fechadosComEmpresa.forEach((it) => {
      const key = normalizeEmpresa(it.empresa);
      (porEmpresa[key] = porEmpresa[key] || []).push(it);
    });
    Object.values(porEmpresa).forEach((lista) => {
      lista.sort((a, b) => new Date(a.dataFechamento || a.createdAt) - new Date(b.dataFechamento || b.createdAt));
    });

    const porSegmentoMap = {};
    fechadosComEmpresa.forEach((it) => {
      const seg = it.segmento || 'Sem segmento';
      const lista = porEmpresa[normalizeEmpresa(it.empresa)];
      const isRecompra = lista.findIndex((x) => x.id === it.id) > 0;
      if (!porSegmentoMap[seg]) porSegmentoMap[seg] = { total: 0, recompra: 0 };
      porSegmentoMap[seg].total += 1;
      if (isRecompra) porSegmentoMap[seg].recompra += 1;
    });

    const linhas = Object.entries(porSegmentoMap)
      .map(([segmento, v]) => ({ segmento, ...v, taxa: v.total ? (v.recompra / v.total) * 100 : 0 }))
      .sort((a, b) => b.taxa - a.taxa);

    return { linhas, semEmpresa };
  }, [items]);

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
          <div className="metrics-section">
            <h3>Oportunidades de reativação (Fase 9)</h3>
            <p style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: -6, marginBottom: 12 }}>
              Roteiro priorizado: clientes há mais tempo sem contato aparecem primeiro, e dentro do mesmo tempo sem
              contato o de maior valor vem na frente. Mostrando até {MAX_OPORTUNIDADES} de {oportunidadesReativacao.total}{' '}
              cliente(s) na base que se encaixam em algum critério de reativação.
            </p>
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Segmento</th>
                  <th>Responsável(is)</th>
                  <th>Situação</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {oportunidadesReativacao.lista.map(({ it, dias, tier }) => (
                  <tr key={it.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(it.id)} title="Abrir lead">
                    <td>
                      <strong>{it.name}</strong>
                      {it.empresa && <div style={{ color: 'var(--ink-soft)', fontSize: '0.78rem' }}>{it.empresa}</div>}
                    </td>
                    <td>{it.segmento || '—'}</td>
                    <td>
                      {it.responsavelIds.map((id) => usersById[id]?.name).filter(Boolean).join(', ') ||
                        'Sem responsável'}
                    </td>
                    <td style={{ color: 'var(--danger)' }}>
                      {tier.key === 'nunca' ? tier.label : `${dias}d sem contato`}
                    </td>
                    <td>{formatMoney(it.valorEstimado) || '—'}</td>
                  </tr>
                ))}
                {oportunidadesReativacao.lista.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--ink-soft)' }}>
                      Nenhum cliente da base passou de 60 dias sem contato. 🎉
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="metrics-section">
            <h3>Recompra por segmento (Fase 9)</h3>
            <p style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: -6, marginBottom: 12 }}>
              "Recompra" = a mesma empresa (pelo campo Empresa cadastrado no lead) fechou negócio mais de uma vez.
              Comparação de texto simples — variação de digitação entre cadastros não é reconhecida como o mesmo
              cliente, então a taxa real tende a ser um pouco maior que a mostrada aqui.
              {recompraPorSegmento.semEmpresa > 0 &&
                ` ${recompraPorSegmento.semEmpresa} lead(s) fechado(s) sem Empresa cadastrada ficaram fora da conta.`}
            </p>
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Segmento</th>
                  <th>Fechados</th>
                  <th>Dos quais recompra</th>
                  <th>Taxa de recompra</th>
                </tr>
              </thead>
              <tbody>
                {recompraPorSegmento.linhas.map((r) => (
                  <tr key={r.segmento}>
                    <td>{r.segmento}</td>
                    <td>{r.total}</td>
                    <td>{r.recompra}</td>
                    <td>{r.taxa.toFixed(0)}%</td>
                  </tr>
                ))}
                {recompraPorSegmento.linhas.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--ink-soft)' }}>
                      Sem dados suficientes ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

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
