// Regras puras da Agenda e da "próxima ação" — sem React e sem nenhuma
// dependência (nem do monday, nem de outros módulos do projeto), de propósito:
// o mesmo arquivo roda no navegador (Agenda, Kanban, drawer), no servidor
// (rotas de próxima ação/atividade) e nos testes unitários (node --test).
// Datas aqui são sempre strings "YYYY-MM-DD" — nada de new Date() em datas
// "puras", pra não escorregar de dia por causa de fuso horário (o monday
// guarda datas de coluna sem hora).
//
// MODELO (v1 "Prioridades e próxima ação", out/2026)
// Todo lead pertence a UMA trilha de acompanhamento, derivada do estágio de
// vendas — nunca escolhida à mão:
//   - vendas      → Lead, Qualificado, Proposta Enviada, Em Negociação (e
//                   leads sem estágio reconhecido, pra nunca "sumirem")
//   - reativacao  → Perdido
//   - posVenda    → Fechado
// Cada trilha tem sua PRÓPRIA data de próximo contato (coluna nativa do
// monday) e sua própria ação concreta + responsável (JSON em planoAcao):
//   vendas     → proximoFollowUp        (coluna que já existia)
//   reativacao → dataReativacao         (coluna nova)
//   posVenda   → proximoContatoPosVenda (coluna nova)
// Por isso um negócio perdido deixa de gerar "follow-up comercial vencido"
// sem apagar o agendamento antigo (ele continua guardado em proximoFollowUp,
// só deixa de alertar — ver `legado` em computeAgendaPorTrilha).

export const TRILHAS = {
  VENDAS: 'vendas',
  REATIVACAO: 'reativacao',
  POS_VENDA: 'posVenda',
};

export const TRILHA_LABEL = {
  vendas: 'Vendas ativas',
  reativacao: 'Reativação',
  posVenda: 'Pós-venda',
};

// Campo (do item achatado, ver lib/transform.js) que guarda a data de cada trilha.
export const TRILHA_CAMPO_DATA = {
  vendas: 'proximoFollowUp',
  reativacao: 'dataReativacao',
  posVenda: 'proximoContatoPosVenda',
};

export const ACAO_MAX = 140; // texto da próxima ação
export const RESULTADO_PLANO_MAX = 200; // resumo do último resultado guardado no JSON
export const RESULTADO_NOTA_MAX = 1500; // texto completo do resultado (vai pro histórico do monday)

// Canais em que uma atividade pode ter acontecido. "Interno" nunca conta como
// contato efetivo com o cliente (ver registrarAtividade nas rotas).
export const CANAIS_ATIVIDADE = [
  'Ligação',
  'WhatsApp',
  'E-mail',
  'Visita',
  'Reunião',
  'Proposta enviada',
  'Interno (sem contato com o cliente)',
];
export const CANAL_INTERNO = 'Interno (sem contato com o cliente)';

// ---------------------------------------------------------------- datas

export function dateOnly(value) {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// "Hoje" no fuso de quem está usando (navegador) — mesmo critério do código
// antigo (todayStr em Agenda.jsx/Dashboard.jsx).
export function toLocalDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function utcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDaysStr(dateStr, n) {
  const d = new Date(utcMs(dateStr) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// Dias inteiros de `fromStr` até `toStr` (positivo se toStr é depois).
export function diffDays(fromStr, toStr) {
  return Math.round((utcMs(toStr) - utcMs(fromStr)) / 86400000);
}

// Dias desde uma data até hoje (null se a data não existe/for inválida).
export function diasDesde(value, hojeStr) {
  const d = dateOnly(value);
  if (!d) return null;
  return diffDays(d, hojeStr);
}

export function fmtDataCurta(dateStr) {
  const d = dateOnly(dateStr);
  if (!d) return '';
  const [, m, day] = d.split('-');
  return `${day}/${m}`;
}

export function fmtDataBR(dateStr) {
  const d = dateOnly(dateStr);
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

// ---------------------------------------------------------------- trilha

export function trilhaDoItem(item) {
  if (item?.estagio === 'Perdido') return TRILHAS.REATIVACAO;
  if (item?.estagio === 'Fechado') return TRILHAS.POS_VENDA;
  return TRILHAS.VENDAS;
}

export function dataDaTrilha(item, trilha) {
  return dateOnly(item?.[TRILHA_CAMPO_DATA[trilha]]);
}

// ------------------------------------------------------- plano de ação (JSON)

function textoCurto(v, max) {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizarAcaoTrilha(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const acao = textoCurto(raw.acao, ACAO_MAX);
  const responsavelId = raw.responsavelId ? String(raw.responsavelId) : null;
  const compromissoCliente = !!raw.compromissoCliente;
  if (!acao && !responsavelId && !compromissoCliente) return null;
  return {
    acao,
    responsavelId,
    compromissoCliente,
    rev: Number.isInteger(raw.rev) && raw.rev > 0 ? raw.rev : 0,
    atualizadoEm: raw.atualizadoEm || null,
    atualizadoPor: raw.atualizadoPor || null,
  };
}

// Lê o texto da coluna planoAcao. Tolerante: texto vazio, JSON quebrado ou
// formato inesperado viram um plano vazio — nunca derrubam a tela.
export function parsePlanoAcao(text) {
  const vazio = { v: 1, vendas: null, reativacao: null, posVenda: null, ultimoResultado: null };
  if (!text) return vazio;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return vazio;
    const ur = parsed.ultimoResultado;
    return {
      v: 1,
      vendas: normalizarAcaoTrilha(parsed.vendas),
      reativacao: normalizarAcaoTrilha(parsed.reativacao),
      posVenda: normalizarAcaoTrilha(parsed.posVenda),
      ultimoResultado:
        ur && typeof ur === 'object'
          ? {
              data: dateOnly(ur.data),
              trilha: ur.trilha || null,
              contatoRealizado: !!ur.contatoRealizado,
              canal: ur.canal || null,
              resumo: textoCurto(ur.resumo, RESULTADO_PLANO_MAX),
              autor: ur.autor || null,
            }
          : null,
    };
  } catch {
    return vazio;
  }
}

export function getAcao(item, trilha) {
  const t = item?.planoAcao?.[trilha] || null;
  return {
    acao: t?.acao || '',
    responsavelId: t?.responsavelId || null,
    compromissoCliente: !!t?.compromissoCliente,
    rev: t?.rev || 0,
    atualizadoPor: t?.atualizadoPor || null,
    atualizadoEm: t?.atualizadoEm || null,
  };
}

// Responsável "padrão" quando ninguém foi indicado de forma explícita:
//   pós-venda → o vendedor de pós-venda do handoff (ou, na falta dele, o
//               primeiro responsável do lead — fechados antigos);
//   demais    → o primeiro responsável que NÃO seja o vendedor de pós-venda.
export function responsavelPadrao(item, trilha) {
  const ids = (item?.responsavelIds || []).map(String);
  if (trilha === TRILHAS.POS_VENDA) return item?.vendedorPosVenda ? String(item.vendedorPosVenda) : ids[0] || null;
  const semPos = item?.vendedorPosVenda ? ids.filter((id) => id !== String(item.vendedorPosVenda)) : ids;
  return semPos[0] || null;
}

export function responsavelEfetivo(item, trilha) {
  return getAcao(item, trilha).responsavelId || responsavelPadrao(item, trilha);
}

// Aplica uma nova ação a uma trilha do plano (função pura — a rota só faz o
// I/O em volta). Controle de conflito por revisão: quem está editando manda
// de volta a `rev` que viu; se alguém salvou a mesma trilha nesse meio tempo
// a `rev` guardada já é maior e devolvemos `conflito` em vez de sobrescrever.
// `acaoNova === null` limpa a trilha (ex: atividade concluída sem próximo passo).
export function aplicarAcaoNoPlano(plano, trilha, acaoNova, { expectedRev, autor, agora } = {}) {
  const base = plano || parsePlanoAcao(null);
  const atual = base[trilha];
  const revAtual = atual?.rev || 0;
  if (expectedRev !== undefined && expectedRev !== null && Number(expectedRev) !== revAtual) {
    return { conflito: true, atual: atual || null };
  }
  const proximo = { ...base };
  if (acaoNova === null) {
    proximo[trilha] = null;
  } else {
    proximo[trilha] = normalizarAcaoTrilha({
      ...acaoNova,
      rev: revAtual + 1,
      atualizadoEm: agora || new Date().toISOString(),
      atualizadoPor: autor || null,
    });
    // Ação totalmente vazia vira "sem registro" (rev some junto, sem problema:
    // o próximo salvamento parte de rev 0 de novo, igual a uma trilha nova).
  }
  return { conflito: false, plano: proximo };
}

// Reduz o plano ao que vai de fato pra coluna (JSON compacto).
export function serializarPlanoAcao(plano) {
  const out = { v: 1 };
  for (const t of ['vendas', 'reativacao', 'posVenda']) {
    if (plano?.[t]) out[t] = plano[t];
  }
  if (plano?.ultimoResultado) out.ultimoResultado = plano.ultimoResultado;
  return JSON.stringify(out);
}

// ---------------------------------------------------------------- pendências

// "Oportunidade ativa deve ter ação concreta, responsável e data." Devolve o
// que falta (lista vazia = completo). Só vale pra trilha de vendas: perdidos
// e fechados NÃO são cobrados (reativação/pós-venda são opcionais). Registro
// incompleto nunca bloqueia nada — é só sinalização.
export function pendenciasProximaAcao(item) {
  if (trilhaDoItem(item) !== TRILHAS.VENDAS) return [];
  const faltando = [];
  if (!getAcao(item, TRILHAS.VENDAS).acao) faltando.push('ação concreta');
  if (!dataDaTrilha(item, TRILHAS.VENDAS)) faltando.push('data');
  if (!responsavelEfetivo(item, TRILHAS.VENDAS)) faltando.push('responsável');
  return faltando;
}

// ---------------------------------------------------------------- agenda

function porData(campo) {
  return (a, b) => {
    const da = dateOnly(a[campo]);
    const db = dateOnly(b[campo]);
    return da.localeCompare(db) || nomeOrdem(a).localeCompare(nomeOrdem(b));
  };
}

function nomeOrdem(it) {
  return String(it.empresa || it.name || '');
}

// Calcula as três agendas a partir dos MESMOS leads já filtrados na tela —
// quem chama é responsável por passar a lista filtrada (assim contadores,
// alertas e listas nunca divergem).
export function computeAgendaPorTrilha(items, hojeStr = toLocalDateStr()) {
  const em7 = addDaysStr(hojeStr, 7);
  const em30 = addDaysStr(hojeStr, 30);

  const vendas = { atrasados: [], hoje: [], proximos7: [], semData: [], incompletos: [] };
  const reativacao = { vencidas: [], hoje: [], proximos30: [], legado: [] };
  const posVenda = { atrasados: [], hoje: [], proximos7: [] };

  for (const it of items) {
    const trilha = trilhaDoItem(it);
    if (trilha === TRILHAS.VENDAS) {
      const fu = dataDaTrilha(it, trilha);
      if (fu) {
        if (fu < hojeStr) vendas.atrasados.push(it);
        else if (fu === hojeStr) vendas.hoje.push(it);
        else if (fu <= em7) vendas.proximos7.push(it);
      } else {
        const dias = diasDesde(it.ultimoContato, hojeStr);
        if (dias === null || dias > 5) vendas.semData.push(it);
      }
      if (pendenciasProximaAcao(it).length > 0) vendas.incompletos.push(it);
    } else if (trilha === TRILHAS.REATIVACAO) {
      const d = dataDaTrilha(it, trilha);
      if (d) {
        if (d < hojeStr) reativacao.vencidas.push(it);
        else if (d === hojeStr) reativacao.hoje.push(it);
        else if (d <= em30) reativacao.proximos30.push(it);
      } else if (dateOnly(it.proximoFollowUp)) {
        // Agendamento comercial antigo de um negócio já perdido: preservado,
        // mas fora dos alertas. O vendedor decide se converte em reativação.
        reativacao.legado.push(it);
      }
    } else {
      const d = dataDaTrilha(it, trilha);
      if (d) {
        if (d < hojeStr) posVenda.atrasados.push(it);
        else if (d === hojeStr) posVenda.hoje.push(it);
        else if (d <= em7) posVenda.proximos7.push(it);
      }
    }
  }

  vendas.atrasados.sort(porData('proximoFollowUp'));
  vendas.hoje.sort((a, b) => nomeOrdem(a).localeCompare(nomeOrdem(b)));
  vendas.proximos7.sort(porData('proximoFollowUp'));
  vendas.semData.sort((a, b) => (diasDesde(b.ultimoContato, hojeStr) ?? 999) - (diasDesde(a.ultimoContato, hojeStr) ?? 999));
  vendas.incompletos.sort((a, b) => nomeOrdem(a).localeCompare(nomeOrdem(b)));
  reativacao.vencidas.sort(porData('dataReativacao'));
  reativacao.hoje.sort((a, b) => nomeOrdem(a).localeCompare(nomeOrdem(b)));
  reativacao.proximos30.sort(porData('dataReativacao'));
  reativacao.legado.sort(porData('proximoFollowUp'));
  posVenda.atrasados.sort(porData('proximoContatoPosVenda'));
  posVenda.hoje.sort((a, b) => nomeOrdem(a).localeCompare(nomeOrdem(b)));
  posVenda.proximos7.sort(porData('proximoContatoPosVenda'));

  return { vendas, reativacao, posVenda, hojeStr };
}

// Contador do selo da aba Agenda e do banner: só o que realmente é URGENTE —
// vendas atrasadas + vendas paradas sem data + pós-venda atrasado. Reativação
// vencida NÃO entra (é oportunidade, não cobrança), e perdidos nunca geram
// alerta comercial.
export function contarAlertas(agendas) {
  return {
    vendasAtrasados: agendas.vendas.atrasados.length,
    vendasSemData: agendas.vendas.semData.length,
    posVendaAtrasados: agendas.posVenda.atrasados.length,
    total: agendas.vendas.atrasados.length + agendas.vendas.semData.length + agendas.posVenda.atrasados.length,
  };
}

// Texto/estilo do selo de follow-up no rodapé do card do Kanban — agora
// consciente da trilha. Para vendas reproduz exatamente o comportamento
// antigo; perdidos e fechados deixam de ser tratados como "follow-up de
// vendas atrasado".
export function alertaDoCard(item, hojeStr = toLocalDateStr()) {
  const trilha = trilhaDoItem(item);
  if (trilha === TRILHAS.VENDAS) {
    const fu = dataDaTrilha(item, trilha);
    if (fu) {
      if (fu < hojeStr) return { text: `⚠ follow-up atrasado ${diffDays(fu, hojeStr)}d`, className: 'stale' };
      if (fu === hojeStr) return { text: '📅 follow-up hoje', className: 'due-today' };
      return { text: `📅 follow-up em ${fmtDataCurta(fu)}`, className: 'due-future' };
    }
    const dias = diasDesde(item.ultimoContato, hojeStr);
    if (dias === null) return { text: '⚠ sem contato e sem follow-up marcado', className: 'stale' };
    if (dias > 5) return { text: `⚠ ${dias} dias sem contato, sem follow-up marcado`, className: 'stale' };
    return { text: '🔔 marcar follow-up', className: 'no-followup' };
  }
  const d = dataDaTrilha(item, trilha);
  if (trilha === TRILHAS.REATIVACAO) {
    if (!d) return null;
    if (d < hojeStr) return { text: `🔁 reativação prevista há ${diffDays(d, hojeStr)}d`, className: 'due-reativacao' };
    if (d === hojeStr) return { text: '🔁 reativar hoje', className: 'due-reativacao' };
    return { text: `🔁 reativar em ${fmtDataCurta(d)}`, className: 'due-future' };
  }
  if (!d) return null;
  if (d < hojeStr) return { text: `📞 pós-venda atrasado ${diffDays(d, hojeStr)}d`, className: 'stale' };
  if (d === hojeStr) return { text: '📞 pós-venda hoje', className: 'due-today' };
  return { text: `📞 pós-venda em ${fmtDataCurta(d)}`, className: 'due-future' };
}

// Ordem dos cards dentro de uma coluna do Kanban. Vendas: igual à regra
// antiga (follow-up mais antigo primeiro; sem data, quem está há mais tempo
// sem contato). Perdidos: reativações agendadas primeiro, depois as perdas
// mais recentes. Fechados: próximos contatos de pós-venda primeiro, depois os
// fechamentos mais recentes.
export function compararNoKanban(a, b, hojeStr = toLocalDateStr()) {
  const ta = trilhaDoItem(a);
  if (ta !== trilhaDoItem(b)) return 0;
  const da = dataDaTrilha(a, ta);
  const db = dataDaTrilha(b, ta);
  if (ta === TRILHAS.VENDAS) {
    if (da && db) return da.localeCompare(db);
    if (da && !db) return -1;
    if (!da && db) return 1;
    const diasA = diasDesde(a.ultimoContato, hojeStr);
    const diasB = diasDesde(b.ultimoContato, hojeStr);
    return (diasB === null ? Infinity : diasB) - (diasA === null ? Infinity : diasA);
  }
  if (da && db) return da.localeCompare(db);
  if (da && !db) return -1;
  if (!da && db) return 1;
  const campoRecente = ta === TRILHAS.REATIVACAO ? 'dataPerda' : 'dataFechamento';
  return String(dateOnly(b[campoRecente]) || '').localeCompare(String(dateOnly(a[campoRecente]) || ''));
}

// ---------------------------------------------------------------- escopo

// Texto único de escopo, usado no selo da aba, no banner e no cabeçalho das
// listas — todos leem do MESMO filtro (responsável) e dos MESMOS leads.
export function descreverEscopo({ responsavelId, usersById = {}, outrosFiltros = [] }) {
  const equipe = !responsavelId;
  const nome = responsavelId ? usersById[responsavelId]?.name || `#${responsavelId}` : null;
  let texto = equipe ? 'Escopo: equipe inteira' : `Escopo: ${nome}`;
  if (outrosFiltros.length > 0) texto += ` · filtros ativos: ${outrosFiltros.join(', ')}`;
  return { equipe, nome, texto };
}
