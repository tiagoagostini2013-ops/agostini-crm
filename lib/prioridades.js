// "Minhas prioridades de hoje" — pontuação TRANSPARENTE das oportunidades de
// vendas ativas. Puro (sem React/monday) pra rodar no navegador e nos testes.
//
// Princípios (pedido do Tiago, out/2026):
//   1. Um compromisso assumido com o cliente pesa MAIS que o valor do negócio.
//   2. Valor, estágio, prazo de compra e interação recente com a proposta
//      também contam, mas cada um tem teto — nenhum fator sozinho domina.
//   3. Campo ausente é informação DESCONHECIDA: contribui com 0 ponto (nem
//      bônus, nem penalidade inventados) e aparece listado como "não
//      informado" pra o vendedor saber o que falta.
//   4. Todo ponto vem com um motivo legível — a lista mostra o porquê.
//
// Só entram leads da trilha de vendas ativas (Lead → Em Negociação). Perdidos
// (reativação) e fechados (pós-venda) têm agenda própria em lib/agenda.js.

import {
  TRILHAS,
  trilhaDoItem,
  dataDaTrilha,
  getAcao,
  pendenciasProximaAcao,
  diffDays,
  diasDesde,
  dateOnly,
  toLocalDateStr,
} from './agenda.js';

// Pesos em um só lugar (e exportados) pra ficar fácil de auditar e ajustar.
export const PESOS = {
  compromissoHoje: 35,
  compromissoVencidoBase: 40,
  compromissoVencidoPorDia: 1.5, // soma por dia de atraso...
  compromissoVencidoMaxExtra: 15, // ...até este teto (10 dias)
  combinadoComCliente: 15, // "ficou combinado com o cliente"
  estagio: { 'Em Negociação': 20, 'Proposta Enviada': 16, Qualificado: 8, Lead: 4 },
  // Faixas de valor estimado (R$) — maior faixa que o valor alcança.
  valor: [
    { min: 1000000, pontos: 15 },
    { min: 500000, pontos: 13 },
    { min: 200000, pontos: 10 },
    { min: 100000, pontos: 8 },
    { min: 50000, pontos: 6 },
    { min: 20000, pontos: 4 },
    { min: 1, pontos: 2 },
  ],
  prazoVencido: 8, // prazo previsto de compra já passou (revisar a data)
  prazo30: 12,
  prazo60: 8,
  prazo90: 4,
  propostaAbertaRecente: 10, // cliente abriu/baixou a proposta há até 3 dias
  propostaSemAbertura: 6, // enviada há 3+ dias e nunca aberta
  nuncaContatadoLead: 8, // lead novo (dentro do SLA de 24h) ainda sem contato
  nuncaContatadoLeadSlaVencido: 28, // lead criado há 1+ dia, ainda sem NENHUM contato: SLA vencido
  nuncaContatadoOutros: 4,
  semContato14: 5,
  semContato8: 3,
};

// Limiar pra aparecer na lista quando NÃO há compromisso vencido/de hoje.
export const SCORE_MINIMO = 30;

function fmtBRL(n) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function plural(n, s, p) {
  return `${n} ${n === 1 ? s : p}`;
}

export function valorConhecido(item) {
  const n = Number(item?.valorEstimado);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Último sinal de interação do cliente com a proposta enviada (abrir/baixar).
function sinalProposta(item, hojeStr) {
  const envios = Array.isArray(item?.rastreioPropostas) ? item.rastreioPropostas : [];
  if (envios.length === 0) return null;
  let melhor = null; // interação mais recente de qualquer envio
  let enviadoMaisRecente = null;
  for (const e of envios) {
    const visto = dateOnly(e.lastViewedAt || e.firstViewedAt);
    const baixado = dateOnly(e.lastDownloadedAt);
    const quando = [visto, baixado].filter(Boolean).sort().pop() || null;
    if (quando && (!melhor || quando > melhor.quando)) melhor = { quando, baixou: !!e.downloadCount };
    const enviado = dateOnly(e.sentAt);
    if (enviado && (!enviadoMaisRecente || enviado > enviadoMaisRecente.enviado)) {
      enviadoMaisRecente = { enviado, aberta: !!e.firstViewedAt };
    }
  }
  if (melhor) {
    const dias = diffDays(melhor.quando, hojeStr);
    if (dias <= 3) return { tipo: 'aberta', dias, baixou: melhor.baixou };
  }
  if (enviadoMaisRecente && !enviadoMaisRecente.aberta) {
    const dias = diffDays(enviadoMaisRecente.enviado, hojeStr);
    if (dias >= 3) return { tipo: 'semAbertura', dias };
  }
  return null;
}

// Pontua UM lead de vendas. Devolve null se o lead não é de vendas ativas.
export function pontuarLead(item, hojeStr = toLocalDateStr()) {
  if (trilhaDoItem(item) !== TRILHAS.VENDAS) return null;

  const motivos = []; // { tipo, texto, peso } — só fatores que somaram pontos
  const desconhecidos = []; // fatores sem informação (0 ponto)
  let score = 0;
  const add = (tipo, texto, peso) => {
    score += peso;
    motivos.push({ tipo, texto, peso: Math.round(peso * 10) / 10 });
  };

  // 1) Compromisso (data da próxima ação) + "combinado com o cliente"
  const fu = dataDaTrilha(item, TRILHAS.VENDAS);
  const acao = getAcao(item, TRILHAS.VENDAS);
  let compromisso = null; // { tipo: 'vencido' | 'hoje', dias }
  if (fu) {
    if (fu < hojeStr) {
      const dias = diffDays(fu, hojeStr);
      const extra = Math.min(PESOS.compromissoVencidoMaxExtra, dias * PESOS.compromissoVencidoPorDia);
      compromisso = { tipo: 'vencido', dias };
      add(
        'compromisso',
        `Próxima ação vencida há ${plural(dias, 'dia', 'dias')}${acao.acao ? ` — ${acao.acao}` : ''}`,
        PESOS.compromissoVencidoBase + extra
      );
    } else if (fu === hojeStr) {
      compromisso = { tipo: 'hoje', dias: 0 };
      add('compromisso', `Próxima ação é hoje${acao.acao ? ` — ${acao.acao}` : ''}`, PESOS.compromissoHoje);
    }
    if (compromisso && acao.compromissoCliente) {
      add('compromisso', 'Combinado com o cliente (ele está esperando esse retorno)', PESOS.combinadoComCliente);
    }
  }

  // 2) Estágio comercial
  const pEstagio = PESOS.estagio[item.estagio];
  if (pEstagio) add('estagio', `Estágio: ${item.estagio}`, pEstagio);

  // 3) Valor estimado (nunca inventado: ausente/zero = desconhecido)
  const valor = valorConhecido(item);
  if (valor === null) {
    desconhecidos.push('Valor estimado não informado');
  } else {
    const faixa = PESOS.valor.find((f) => valor >= f.min);
    if (faixa) add('valor', `Valor estimado ${fmtBRL(valor)}`, faixa.pontos);
  }

  // 4) Prazo previsto de compra
  const prazo = dateOnly(item.prazoCompra);
  if (!prazo) {
    desconhecidos.push('Prazo de compra não informado');
  } else {
    const dias = diffDays(hojeStr, prazo);
    if (dias < 0) {
      add('prazo', `Prazo de compra previsto já passou (${plural(-dias, 'dia', 'dias')}) — revisar`, PESOS.prazoVencido);
    } else if (dias <= 30) {
      add('prazo', `Compra prevista em ${plural(dias, 'dia', 'dias')}`, PESOS.prazo30);
    } else if (dias <= 60) {
      add('prazo', `Compra prevista em ${plural(dias, 'dia', 'dias')}`, PESOS.prazo60);
    } else if (dias <= 90) {
      add('prazo', `Compra prevista em ${plural(dias, 'dia', 'dias')}`, PESOS.prazo90);
    }
  }

  // 5) Interação recente com a proposta
  const sp = sinalProposta(item, hojeStr);
  if (sp?.tipo === 'aberta') {
    const quando = sp.dias === 0 ? 'hoje' : `há ${plural(sp.dias, 'dia', 'dias')}`;
    add(
      'proposta',
      `Cliente abriu a proposta ${quando}${sp.baixou ? ' e baixou o PDF' : ''}`,
      PESOS.propostaAbertaRecente
    );
  } else if (sp?.tipo === 'semAbertura') {
    add('proposta', `Proposta enviada há ${plural(sp.dias, 'dia', 'dias')} e ainda não aberta`, PESOS.propostaSemAbertura);
  }

  // 6) Contato efetivo
  const diasContato = diasDesde(item.ultimoContato, hojeStr);
  if (diasContato === null) {
    if (item.estagio === 'Lead') {
      // Pré-vendas: o SLA do processo é responder em 24h. Passou disso sem
      // nenhum contato registrado, o lead entra na lista por si só.
      const idade = diasDesde(item.createdAt, hojeStr);
      if (idade !== null && idade >= 1) {
        add('contato', `Lead sem nenhum contato há ${plural(idade, 'dia', 'dias')} — SLA de 24h vencido`, PESOS.nuncaContatadoLeadSlaVencido);
      } else {
        add('contato', 'Lead novo ainda sem contato (SLA de 24h)', PESOS.nuncaContatadoLead);
      }
    } else {
      add('contato', 'Nenhum contato registrado neste lead', PESOS.nuncaContatadoOutros);
    }
  } else if (diasContato > 14) {
    add('contato', `Sem contato efetivo há ${plural(diasContato, 'dia', 'dias')}`, PESOS.semContato14);
  } else if (diasContato >= 8) {
    add('contato', `Sem contato efetivo há ${plural(diasContato, 'dia', 'dias')}`, PESOS.semContato8);
  }

  return {
    item,
    score: Math.round(score * 10) / 10,
    motivos: motivos.sort((a, b) => b.peso - a.peso),
    desconhecidos,
    pendencias: pendenciasProximaAcao(item),
    compromisso,
  };
}

// Lista ordenada de prioridades. Entra quem tem compromisso vencido/de hoje
// OU score >= SCORE_MINIMO. Desempate: compromisso mais antigo, maior valor
// conhecido, nome (ordem estável e previsível).
export function calcularPrioridades(items, hojeStr = toLocalDateStr()) {
  const pontuados = [];
  let totalAtivos = 0;
  for (const it of items) {
    const p = pontuarLead(it, hojeStr);
    if (!p) continue;
    totalAtivos += 1;
    if (p.compromisso || p.score >= SCORE_MINIMO) pontuados.push(p);
  }
  pontuados.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const fa = dataDaTrilha(a.item, TRILHAS.VENDAS) || '9999-12-31';
    const fb = dataDaTrilha(b.item, TRILHAS.VENDAS) || '9999-12-31';
    if (fa !== fb) return fa.localeCompare(fb);
    const va = valorConhecido(a.item) || 0;
    const vb = valorConhecido(b.item) || 0;
    if (vb !== va) return vb - va;
    return String(a.item.name).localeCompare(String(b.item.name));
  });
  return {
    itens: pontuados,
    totalAtivos,
    totalComCompromisso: pontuados.filter((p) => p.compromisso).length,
  };
}
