// Automação do acompanhamento comercial (v3) — MODO SUGESTÃO.
//
// Módulo PURO (sem I/O, sem framework): recebe leads já achatados
// (lib/transform.js → flattenItem) e devolve sugestões e visões. As rotas
// (app/api/automacao/*) só leem/gravam no monday em volta disto.
//
// Princípios (ver README, seção "Automação do acompanhamento"):
//  - Só atividades INTERNAS do CRM. Nada aqui envia mensagem, e-mail ou
//    WhatsApp ao cliente.
//  - Sugestões são DERIVADAS dos dados que já existem (plano de ação, registro
//    de propostas, último contato). Nenhuma tarefa persistente nasce antes de
//    alguém aceitar. O que se grava é só a decisão (aceita/dispensada), numa
//    lista compacta dentro do JSON do plano ("sg").
//  - Mesma entrada → mesmas sugestões, com a mesma `chave`: reprocessar, repetir
//    o evento ou abrir a tela várias vezes nunca duplica nada.
//  - Compromisso combinado com o cliente tem prioridade: nunca é trocado em
//    silêncio.
//  - "Sem registro" ≠ "sem atendimento": o texto das telas diz que não há
//    REGISTRO no CRM, nunca que o atendimento não aconteceu.

import {
  TRILHAS,
  CANAL_INTERNO,
  trilhaDoItem,
  getAcao,
  dataDaTrilha,
  responsavelEfetivo,
  dateOnly,
  diffDays,
  diasDesde,
  addDaysStr,
  fmtDataBR,
  horaValida,
  serializarPlanoAcao,
  aplicarAcaoNoPlano,
  SG_MAX,
  PLANO_LIMITE_JSON,
  ACAO_MAX,
} from './agenda.js';
import { ehDiaUtil, proximoDiaUtilOuIgual, somaDiasUteis } from './tempo.js';
import { resumoDoc } from './propostas.js';

// ------------------------------------------------------------------ regras

export const REGRAS = {
  A: { id: 'A', tipo: 'acao', nome: 'Follow-up de proposta enviada', trilha: TRILHAS.VENDAS },
  B: { id: 'B', tipo: 'acao', nome: 'Nova tentativa após tentativa sem resposta', trilha: TRILHAS.VENDAS },
  D: { id: 'D', tipo: 'destaque', nome: 'Oportunidade parada', trilha: TRILHAS.VENDAS },
  E: { id: 'E', tipo: 'destaque', nome: 'Prazo de compra nos próximos 30 dias', trilha: TRILHAS.VENDAS },
  F: { id: 'F', tipo: 'acao', nome: 'Passagem para pós-venda', trilha: TRILHAS.POS_VENDA },
};
// A regra C (compromisso combinado) não gera sugestão: é a garantia que vale
// para todas as outras (ver `validarAceite`) e gera só AVISOS (`avisos`).
export const REGRA_C = { id: 'C', nome: 'Compromisso combinado com o cliente tem prioridade' };

export const CONFIG_PADRAO = Object.freeze({
  ativo: true,
  regras: { A: true, B: true, D: true, E: true, F: true },
  diasParada: 7, // D: sem contato efetivo há N dias
  janelaRecenteDias: 30, // evento mais antigo que isto vai para a "análise prévia"
  diasPropostaSemAvanco: 7, // visão do gestor
  horaFollowUp: '09:00', // regra A
  feriadosExtras: [], // 'AAAA-MM-DD' (estaduais/municipais/pontes)
});

function inteiroEntre(v, min, max, padrao) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : padrao;
}

// Config vinda do monday (JSON do administrador) → config válida. Valor
// inválido cai no padrão — nunca derruba a tela.
export function normalizarConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const regras = { ...CONFIG_PADRAO.regras };
  if (r.regras && typeof r.regras === 'object') {
    for (const k of Object.keys(regras)) if (typeof r.regras[k] === 'boolean') regras[k] = r.regras[k];
  }
  const feriados = Array.isArray(r.feriadosExtras)
    ? [...new Set(r.feriadosExtras.map((d) => dateOnly(d)).filter(Boolean))].sort().slice(0, 40)
    : [];
  return {
    ativo: typeof r.ativo === 'boolean' ? r.ativo : CONFIG_PADRAO.ativo,
    regras,
    diasParada: inteiroEntre(r.diasParada, 1, 90, CONFIG_PADRAO.diasParada),
    janelaRecenteDias: inteiroEntre(r.janelaRecenteDias, 1, 365, CONFIG_PADRAO.janelaRecenteDias),
    diasPropostaSemAvanco: inteiroEntre(r.diasPropostaSemAvanco, 1, 90, CONFIG_PADRAO.diasPropostaSemAvanco),
    horaFollowUp: horaValida(r.horaFollowUp) || CONFIG_PADRAO.horaFollowUp,
    feriadosExtras: feriados,
    atualizadoPor: typeof r.atualizadoPor === 'string' ? r.atualizadoPor.slice(0, 40) : null,
    atualizadoEm: typeof r.atualizadoEm === 'string' ? r.atualizadoEm.slice(0, 30) : null,
  };
}

export const ORIGENS = {
  manual: 'Planejada manualmente',
  cliente: 'Combinada com o cliente',
  regra: 'Sugerida por regra',
  sugestao: 'Criada a partir de sugestão aceita',
};

// Origem de uma ação JÁ gravada no plano (não de uma sugestão).
export function origemDaAcao(acao) {
  if (!acao || !acao.acao) return null;
  if (acao.compromissoCliente) return { chave: 'cliente', rotulo: ORIGENS.cliente };
  if (acao.origem === 'sugestao') return { chave: 'sugestao', rotulo: ORIGENS.sugestao, regra: acao.regra || null };
  return { chave: 'manual', rotulo: ORIGENS.manual };
}

// ------------------------------------------------------------------ utilidades

function hash4(texto) {
  let h = 5381;
  for (const ch of String(texto)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36).slice(-4);
}

function dataCriacao(item) {
  return dateOnly(item?.createdAt);
}

export function decisaoDaChave(plano, chave) {
  const e = (plano?.sg || []).find((x) => x[0] === chave);
  return e ? e[1] : null; // 'a' aceita | 'd' dispensada | null
}

function textoAcao(t) {
  return String(t).replace(/\s+/g, ' ').trim().slice(0, ACAO_MAX);
}

function nomeDoLead(item) {
  return item?.empresa || item?.name || `Lead ${item?.id}`;
}

// Situação da ação planejada na trilha de vendas.
function situacaoDaAcao(item, trilha, hoje) {
  const acao = getAcao(item, trilha);
  const data = dataDaTrilha(item, trilha);
  const temTexto = !!acao.acao;
  return {
    acao,
    data,
    semAcao: !temTexto || !data,
    agendadaFutura: temTexto && !!data && data >= hoje,
    vencida: temTexto && !!data && data < hoje,
    compromissoFuturo: acao.compromissoCliente && !!data && data >= hoje,
    compromissoVencido: acao.compromissoCliente && !!data && data < hoje,
  };
}

function resumoSubstitui(sit) {
  if (!sit.acao.acao && !sit.data) return null;
  return {
    acao: sit.acao.acao || null,
    data: sit.data || null,
    compromissoCliente: sit.acao.compromissoCliente,
    origem: origemDaAcao(sit.acao)?.rotulo || null,
  };
}

// "Impressão digital" do espaço de ação da trilha no momento em que a sugestão
// foi gerada. Se mudar até o aceite, outra pessoa mexeu → aceite recusado.
export function impressaoDaTrilha(item, trilha) {
  const a = getAcao(item, trilha);
  return `${a.rev}|${dataDaTrilha(item, trilha) || ''}|${a.acao.length}|${a.compromissoCliente ? 1 : 0}`;
}

function base(item, regra, chave, extra) {
  const r = REGRAS[regra];
  return {
    chave,
    regra,
    regraNome: r.nome,
    tipo: r.tipo,
    itemId: String(item.id),
    itemNome: nomeDoLead(item),
    estagio: item.estagio || null,
    trilha: r.trilha,
    responsavelIds: (item.responsavelIds || []).map(String),
    origem: 'regra',
    origemRotulo: ORIGENS.regra,
    fp: impressaoDaTrilha(item, r.trilha),
    ...extra,
  };
}

// ------------------------------------------------------------------ regras A/B (ação sugerida)

function sugestaoA(item, cfg, hoje, sit) {
  const docs = item.propostasRegistro?.docs || [];
  const enviadas = docs.filter((d) => d.situacao === 'enviada' && d.envioEm);
  if (!enviadas.length) return { motivo: 'Nenhuma proposta com envio registrado explicitamente.' };
  enviadas.sort((a, b) => b.envioEm.localeCompare(a.envioEm) || (b.id === item.propostasRegistro.vigenteId ? 1 : -1));
  const doc = enviadas[0];
  const envio = doc.envioEm;
  const chave = `A.${doc.id}.${envio}`;
  // Contato efetivo DEPOIS do envio torna o follow-up de "proposta sem retorno" sem sentido.
  const ur = item.planoAcao?.ultimoResultado;
  const contatoDepois = (dateOnly(item.ultimoContato) && dateOnly(item.ultimoContato) > envio) || (ur?.contatoRealizado && ur.data && ur.data > envio);
  if (contatoDepois) return { chave, motivo: 'Já houve contato efetivo registrado depois do envio da proposta.' };
  return { chave, doc, envio, dataEvento: envio };
}

function sugestaoB(item, cfg, hoje) {
  const ur = item.planoAcao?.ultimoResultado;
  if (!ur || ur.contatoRealizado !== false || !ur.data) return { motivo: 'Último registro não é uma tentativa sem resposta.' };
  if (ur.canal === CANAL_INTERNO) return { motivo: 'Registro interno não é tentativa de contato.' };
  if (ur.trilha && ur.trilha !== TRILHAS.VENDAS) return { motivo: 'Tentativa registrada em outra trilha.' };
  const chave = `B.${ur.data}.${hash4(`${ur.canal}|${ur.resumo}`)}`;
  const uc = dateOnly(item.ultimoContato);
  if (uc && uc > ur.data) return { chave, motivo: 'Houve contato efetivo registrado depois da tentativa.' };
  return { chave, ur, dataEvento: ur.data };
}

function montarSugestoesAB(item, cfg, hoje, ctxItem) {
  const { sit, extras, saida } = ctxItem;
  const candidatas = [];
  if (cfg.regras.A) {
    const a = sugestaoA(item, cfg, hoje, sit);
    if (a.doc) candidatas.push({ regra: 'A', ...a });
    else saida.suprimidas.push({ regra: 'A', itemId: String(item.id), chave: a.chave || null, motivo: a.motivo });
  }
  if (cfg.regras.B) {
    const b = sugestaoB(item, cfg, hoje);
    if (b.ur) candidatas.push({ regra: 'B', ...b });
    else saida.suprimidas.push({ regra: 'B', itemId: String(item.id), chave: b.chave || null, motivo: b.motivo });
  }
  if (!candidatas.length) return [];

  // Só uma ação por espaço de ação: vale a do evento mais recente (empate: A).
  candidatas.sort((x, y) => y.dataEvento.localeCompare(x.dataEvento) || (x.regra === 'A' ? -1 : 1));
  const [vencedora, ...perdedoras] = candidatas;
  for (const p of perdedoras) {
    saida.suprimidas.push({ regra: p.regra, itemId: String(item.id), chave: p.chave, motivo: 'Há evento mais recente que gera a ação sugerida para esta oportunidade.' });
  }

  // Já tem ação adequada agendada (data de hoje em diante)? Não cria outra.
  if (sit.agendadaFutura) {
    saida.suprimidas.push({
      regra: vencedora.regra,
      itemId: String(item.id),
      chave: vencedora.chave,
      motivo: sit.compromissoFuturo
        ? 'Já existe ação combinada com o cliente agendada — preservada.'
        : 'Já existe ação agendada para esta oportunidade — não foi criada outra.',
    });
    return [];
  }
  // Compromisso combinado já vencido: o vendedor precisa registrar o atendimento, não receber outra data.
  if (sit.compromissoVencido) {
    saida.suprimidas.push({ regra: vencedora.regra, itemId: String(item.id), chave: vencedora.chave, motivo: 'Há compromisso combinado com o cliente vencido — registre o atendimento antes de agendar outro passo.' });
    return [];
  }
  if (decisaoDaChave(item.planoAcao, vencedora.chave)) {
    saida.suprimidas.push({ regra: vencedora.regra, itemId: String(item.id), chave: vencedora.chave, motivo: decisaoDaChave(item.planoAcao, vencedora.chave) === 'a' ? 'Já aceita.' : 'Dispensada — só reaparece com novo evento.' });
    return [];
  }

  let dataBruta;
  let hora = null;
  let texto;
  let justificativa;
  let evento;
  if (vencedora.regra === 'A') {
    dataBruta = somaDiasUteis(vencedora.envio, 1, extras);
    hora = cfg.horaFollowUp;
    const titulo = vencedora.doc.numero || vencedora.doc.rotulo ? resumoDoc(vencedora.doc) : null;
    texto = textoAcao(titulo ? `Follow-up da proposta ${titulo}` : 'Follow-up da proposta enviada');
    justificativa = `Proposta${titulo ? ` ${titulo}` : ''} com envio registrado em ${fmtDataBR(vencedora.envio)}, sem contato efetivo registrado depois e sem ação agendada. Sugestão: retorno no próximo dia útil às ${hora}.`;
    evento = { tipo: 'envio_proposta', data: vencedora.envio, rotulo: `Envio da proposta${titulo ? ` ${titulo}` : ''}`, registroEm: item.propostasRegistro?.atualizadoEm || null };
  } else {
    const bruta = addDaysStr(vencedora.ur.data, 7);
    dataBruta = bruta;
    texto = textoAcao(`Nova tentativa de contato${vencedora.ur.canal ? ` (${vencedora.ur.canal})` : ''}`);
    justificativa = `Tentativa sem resposta em ${fmtDataBR(vencedora.ur.data)}${vencedora.ur.canal ? ` (${vencedora.ur.canal})` : ''} — não conta como contato efetivo. Sugestão: nova tentativa 7 dias corridos depois (${fmtDataBR(bruta)}), passando para o próximo dia útil se cair em fim de semana ou feriado.`;
    evento = { tipo: 'tentativa_sem_resposta', data: vencedora.ur.data, rotulo: `Tentativa sem resposta${vencedora.ur.canal ? ` (${vencedora.ur.canal})` : ''}`, registroEm: null };
  }
  let dataProg = proximoDiaUtilOuIgual(dataBruta, extras);
  const ajustes = [];
  if (dataProg !== dataBruta) ajustes.push(`${fmtDataBR(dataBruta)} não é dia útil; movida para ${fmtDataBR(dataProg)}.`);
  if (dataProg < hoje) {
    const hojeUtil = proximoDiaUtilOuIgual(hoje, extras);
    ajustes.push(`A data natural (${fmtDataBR(dataProg)}) já passou; sugerida a partir de ${fmtDataBR(hojeUtil)}.`);
    dataProg = hojeUtil;
  }
  const antiga = diffDays(vencedora.dataEvento, hoje) > cfg.janelaRecenteDias;
  return [
    base(item, vencedora.regra, vencedora.chave, {
      titulo: texto,
      acaoProposta: { acao: texto, data: dataProg, hora, responsavelId: responsavelEfetivo(item, TRILHAS.VENDAS), compromissoCliente: false },
      justificativa: [justificativa, ...ajustes].join(' '),
      evento,
      dataProgramada: dataProg,
      antiga,
      substitui: resumoSubstitui(sit),
      exigeConfirmacaoSubstituir: !!(sit.acao.acao || sit.data),
    }),
  ];
}

// ------------------------------------------------------------------ regra D / E (destaques)

function sugestaoD(item, cfg, hoje, sit, saida, temAB) {
  if (temAB) {
    saida.suprimidas.push({ regra: 'D', itemId: String(item.id), chave: null, motivo: 'Já coberta pela sugestão de ação desta oportunidade.' });
    return null;
  }
  if (sit.compromissoFuturo) {
    saida.suprimidas.push({ regra: 'D', itemId: String(item.id), chave: null, motivo: 'Retorno futuro combinado com o cliente — não é atraso.' });
    return null;
  }
  if (sit.vencida) {
    saida.suprimidas.push({ regra: 'D', itemId: String(item.id), chave: null, motivo: 'Ação vencida — já aparece como atrasada na agenda.' });
    return null;
  }
  const uc = dateOnly(item.ultimoContato);
  const criado = dataCriacao(item);
  const ref = uc || criado || hoje;
  const diasSemContato = diffDays(ref, hoje);
  let motivo = null;
  if (sit.semAcao) {
    motivo = 'sem_proxima_acao';
  } else if (diasSemContato >= cfg.diasParada) {
    motivo = 'sem_contato';
  }
  if (!motivo) return null;
  if (motivo === 'sem_contato' && criado && diffDays(criado, hoje) < cfg.diasParada) return null; // lead recém-criado
  const chave = `D.${ref}`;
  if (decisaoDaChave(item.planoAcao, chave)) {
    saida.suprimidas.push({ regra: 'D', itemId: String(item.id), chave, motivo: 'Dispensada — só reaparece depois de novo contato efetivo registrado.' });
    return null;
  }
  const partes = [];
  if (motivo === 'sem_proxima_acao') {
    partes.push(`Oportunidade ativa sem próxima ação${sit.acao.acao && !sit.data ? ' com data' : ''} registrada.`);
  } else {
    partes.push(`Sem registro de contato efetivo há ${diasSemContato} dias (limite configurado: ${cfg.diasParada}). Próxima ação planejada: ${sit.acao.acao} em ${fmtDataBR(sit.data)}.`);
  }
  if (uc) partes.push(`Último contato efetivo registrado: ${fmtDataBR(uc)}.`);
  else partes.push('Nenhum contato efetivo registrado no CRM.');
  return base(item, 'D', chave, {
    titulo: motivo === 'sem_proxima_acao' ? 'Definir a próxima ação' : 'Retomar o contato',
    acaoProposta: null,
    motivoD: motivo,
    justificativa: partes.join(' '),
    evento: { tipo: uc ? 'ultimo_contato_efetivo' : 'criacao_do_lead', data: ref, rotulo: uc ? 'Último contato efetivo' : 'Criação do lead', registroEm: null },
    dataProgramada: null,
    antiga: diffDays(ref, hoje) > cfg.janelaRecenteDias,
    substitui: null,
    exigeConfirmacaoSubstituir: false,
    detalhes: { diasSemContato, ultimoContatoEfetivo: uc || null, proximaAcao: sit.acao.acao ? { acao: sit.acao.acao, data: sit.data } : null },
  });
}

function sugestaoE(item, cfg, hoje, sit, saida) {
  const prazo = dateOnly(item.prazoCompra);
  if (!prazo) return null;
  const dias = diffDays(hoje, prazo);
  if (dias < 0 || dias > 30) return null;
  const chave = `E.${prazo}`;
  if (decisaoDaChave(item.planoAcao, chave)) {
    saida.suprimidas.push({ regra: 'E', itemId: String(item.id), chave, motivo: 'Dispensada — só reaparece se o prazo de compra mudar.' });
    return null;
  }
  const impedimento = String(item.principalImpedimento || '').trim() || null;
  const proxima = sit.acao.acao ? { acao: sit.acao.acao, data: sit.data, compromissoCliente: sit.acao.compromissoCliente } : null;
  const partes = [`Prazo previsto de compra em ${fmtDataBR(prazo)} (${dias === 0 ? 'hoje' : `em ${dias} dia${dias > 1 ? 's' : ''}`}).`];
  partes.push(impedimento ? `Principal impedimento informado: ${impedimento}.` : 'Principal impedimento não informado.');
  partes.push(proxima ? `Próxima ação existente: ${proxima.acao}${proxima.data ? ` em ${fmtDataBR(proxima.data)}` : ''}.` : 'Sem próximo passo definido — o responsável precisa defini-lo (o prazo de compra não substitui a data de follow-up).');
  return base(item, 'E', chave, {
    titulo: proxima ? 'Compra prevista nos próximos 30 dias' : 'Compra prevista — defina o próximo passo',
    acaoProposta: null,
    justificativa: partes.join(' '),
    evento: { tipo: 'prazo_compra', data: prazo, rotulo: 'Prazo previsto de compra', registroEm: null },
    dataProgramada: null,
    antiga: false,
    substitui: null,
    exigeConfirmacaoSubstituir: false,
    semProximoPasso: !proxima || !sit.data,
    detalhes: { prazoCompra: prazo, diasAtePrazo: dias, impedimento, proximaAcao: proxima },
  });
}

// ------------------------------------------------------------------ regra F (venda fechada)

function sugestaoF(item, cfg, hoje, extras, saida) {
  const sit = situacaoDaAcao(item, TRILHAS.POS_VENDA, hoje);
  const chave = `F.${dateOnly(item.dataFechamento) || '0'}`;
  if (sit.acao.acao) {
    saida.suprimidas.push({ regra: 'F', itemId: String(item.id), chave, motivo: 'Já existe ação de pós-venda registrada — fluxo atual preservado.' });
    return null;
  }
  if (decisaoDaChave(item.planoAcao, chave)) {
    saida.suprimidas.push({ regra: 'F', itemId: String(item.id), chave, motivo: decisaoDaChave(item.planoAcao, chave) === 'a' ? 'Já aceita.' : 'Dispensada.' });
    return null;
  }
  const fechamento = dateOnly(item.dataFechamento);
  const dataProg = sit.data && sit.data >= hoje ? sit.data : proximoDiaUtilOuIgual(hoje, extras);
  const temResp = !!item.vendedorPosVenda;
  const texto = textoAcao(temResp ? 'Passagem para pós-venda: registrar compromissos comerciais' : 'Passagem para pós-venda: definir responsável e registrar compromissos comerciais');
  return base(item, 'F', chave, {
    titulo: texto,
    acaoProposta: { acao: texto, data: dataProg, hora: null, responsavelId: item.vendedorPosVenda ? String(item.vendedorPosVenda) : null, compromissoCliente: false },
    justificativa: `Venda fechada${fechamento ? ` em ${fmtDataBR(fechamento)}` : ''} sem ação de pós-venda registrada. ${temResp ? 'Há responsável de pós-venda; falta registrar os compromissos comerciais assumidos (prazos, condições, entrega combinada).' : 'Falta indicar o responsável de pós-venda e registrar os compromissos comerciais assumidos.'} "Fechada" não significa "entregue": a entrega segue o fluxo de pós-venda existente.`,
    evento: { tipo: 'venda_fechada', data: fechamento, rotulo: 'Venda fechada', registroEm: null },
    dataProgramada: dataProg,
    antiga: fechamento ? diffDays(fechamento, hoje) > cfg.janelaRecenteDias : true,
    substitui: null,
    exigeConfirmacaoSubstituir: false,
    semResponsavelPosVenda: !temResp,
  });
}

// ------------------------------------------------------------------ avisos (regra C)

function avisosCompromisso(item, hoje, extras) {
  const out = [];
  for (const trilha of Object.values(TRILHAS)) {
    const a = getAcao(item, trilha);
    const d = dataDaTrilha(item, trilha);
    if (a.acao && a.compromissoCliente && d && d >= hoje && !ehDiaUtil(d, extras)) {
      out.push({
        regra: 'C',
        tipo: 'compromisso_dia_nao_util',
        itemId: String(item.id),
        itemNome: nomeDoLead(item),
        trilha,
        data: d,
        mensagem: `Compromisso combinado com o cliente para ${fmtDataBR(d)}, que não é dia útil (fim de semana ou feriado configurado). A data foi preservada — confirme com o cliente.`,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ avaliação

// Avalia UM lead. Devolve { sugestoes, suprimidas, avisos }.
export function avaliarItem(item, cfgEntrada, { hoje, saida } = {}) {
  const cfg = normalizarConfig(cfgEntrada);
  const out = saida || { sugestoes: [], suprimidas: [], avisos: [] };
  if (!cfg.ativo) return out;
  const extras = cfg.feriadosExtras;
  out.avisos.push(...avisosCompromisso(item, hoje, extras));
  const trilha = trilhaDoItem(item);

  if (trilha === TRILHAS.POS_VENDA) {
    if (item.estagio === 'Fechado' && cfg.regras.F) {
      const f = sugestaoF(item, cfg, hoje, extras, out);
      if (f) out.sugestoes.push(f);
    }
    return out;
  }
  if (trilha === TRILHAS.REATIVACAO) {
    // Negócio perdido: encerra qualquer sugestão de prospecção (sem apagar nada).
    if (item.estagio === 'Perdido') out.suprimidas.push({ regra: '*', itemId: String(item.id), chave: null, motivo: 'Oportunidade perdida — sem sugestões de prospecção.' });
    return out;
  }

  const sit = situacaoDaAcao(item, TRILHAS.VENDAS, hoje);
  const ab = montarSugestoesAB(item, cfg, hoje, { sit, extras, saida: out });
  out.sugestoes.push(...ab);
  if (cfg.regras.D) {
    const d = sugestaoD(item, cfg, hoje, sit, out, ab.length > 0);
    if (d) out.sugestoes.push(d);
  }
  if (cfg.regras.E) {
    const e = sugestaoE(item, cfg, hoje, sit, out);
    if (e) out.sugestoes.push(e);
  }
  return out;
}

// Avalia vários leads. `responsavelId` filtra pelos leads em que a pessoa é
// responsável (ou responsável da ação).
export function listarSugestoes(items, cfg, { hoje, responsavelId = null } = {}) {
  const saida = { sugestoes: [], suprimidas: [], avisos: [] };
  for (const it of items || []) {
    if (responsavelId && !ehResponsavel(it, responsavelId)) continue;
    avaliarItem(it, cfg, { hoje, saida });
  }
  const recentes = saida.sugestoes.filter((s) => !s.antiga);
  const antigas = saida.sugestoes.filter((s) => s.antiga);
  const ordem = (a, b) => (a.dataProgramada || '9999').localeCompare(b.dataProgramada || '9999') || a.itemNome.localeCompare(b.itemNome);
  recentes.sort(ordem);
  antigas.sort(ordem);
  return { recentes, antigas, suprimidas: saida.suprimidas, avisos: saida.avisos };
}

export function ehResponsavel(item, usuarioId) {
  const id = String(usuarioId);
  if ((item.responsavelIds || []).map(String).includes(id)) return true;
  if (item.vendedorPosVenda && String(item.vendedorPosVenda) === id) return true;
  return Object.values(TRILHAS).some((t) => getAcao(item, t).responsavelId === id);
}

// ------------------------------------------------------------------ aceitar / ajustar / dispensar

// Valida e monta a ação que o aceite vai gravar. Puro: a rota passa o lead
// RECÉM-LIDO do monday e a sugestão reavaliada nesse estado. Códigos de erro:
//   obsoleta, estagnada (outra ação criada/alterada), compromisso_cliente,
//   substituir, dia_nao_util, dado_invalido.
export function validarAceite({ item, sugestao, impressaoVista, ajuste = {}, confirma = {}, cfg, hoje }) {
  const extras = normalizarConfig(cfg).feriadosExtras;
  if (!sugestao) return { codigo: 'obsoleta', erro: 'Esta sugestão não se aplica mais (a situação da oportunidade mudou). Atualize a lista.' };
  if (sugestao.tipo !== 'acao' || !sugestao.acaoProposta) return { codigo: 'dado_invalido', erro: 'Esta sugestão é um destaque: defina a próxima ação pela tela da oportunidade.' };
  if (impressaoVista !== undefined && impressaoVista !== null && String(impressaoVista) !== sugestao.fp) {
    return { codigo: 'estagnada', erro: 'Outra ação foi criada ou alterada nesta oportunidade depois que a sugestão foi gerada. Atualize a lista e confira antes de aceitar.' };
  }
  const trilha = sugestao.trilha;
  const sit = situacaoDaAcao(item, trilha, hoje);
  const p = sugestao.acaoProposta;
  const acao = textoAcao(ajuste.acao ?? p.acao);
  if (!acao) return { codigo: 'dado_invalido', erro: 'Informe o texto da ação.' };
  const data = ajuste.data === undefined ? p.data : dateOnly(ajuste.data);
  if (!data) return { codigo: 'dado_invalido', erro: 'Data inválida (use AAAA-MM-DD).' };
  if (data < hoje) return { codigo: 'dado_invalido', erro: 'A data da ação não pode estar no passado.' };
  let hora = p.hora;
  if (ajuste.hora !== undefined) {
    hora = ajuste.hora ? horaValida(ajuste.hora) : null;
    if (ajuste.hora && !hora) return { codigo: 'dado_invalido', erro: 'Horário inválido (use HH:MM).' };
  }
  const responsavelId = ajuste.responsavelId === undefined ? p.responsavelId : ajuste.responsavelId ? String(ajuste.responsavelId).replace(/\D/g, '') || null : null;
  const compromissoCliente = ajuste.compromissoCliente === undefined ? false : !!ajuste.compromissoCliente;

  // Regra C: compromisso combinado ainda no futuro nunca é trocado em silêncio.
  if (sit.compromissoFuturo && confirma.substituirCompromisso !== true) {
    return { codigo: 'compromisso_cliente', erro: `Existe uma ação combinada com o cliente para ${fmtDataBR(sit.data)}. Aceitar esta sugestão a substituiria — confirme que o combinado mudou.`, substitui: resumoSubstitui(sit) };
  }
  if (!sit.compromissoFuturo && (sit.acao.acao || sit.data) && confirma.substituir !== true) {
    return { codigo: 'substituir', erro: 'Já existe uma ação registrada nesta trilha. Confirme para substituí-la por esta.', substitui: resumoSubstitui(sit) };
  }
  if (!ehDiaUtil(data, extras) && !compromissoCliente && confirma.diaNaoUtil !== true) {
    return { codigo: 'dia_nao_util', sugestaoData: proximoDiaUtilOuIgual(data, extras), erro: `${fmtDataBR(data)} não é dia útil (fim de semana ou feriado). Escolha ${fmtDataBR(proximoDiaUtilOuIgual(data, extras))} ou confirme esta data.` };
  }
  return {
    ok: true,
    nova: { acao, responsavelId, compromissoCliente, hora, origem: compromissoCliente ? undefined : 'sugestao', regra: sugestao.regra },
    data,
    substituiu: resumoSubstitui(sit),
    ajustada: acao !== p.acao || data !== p.data || (hora || null) !== (p.hora || null) || (responsavelId || null) !== (p.responsavelId || null) || compromissoCliente,
  };
}

// Registra a decisão numa cópia do plano. Mantém só as SG_MAX mais recentes e
// recusa gravar se o JSON passar do limite da coluna do monday.
export function registrarDecisao(plano, chave, estado, hoje) {
  const sg = (plano.sg || []).filter((e) => e[0] !== chave);
  sg.push([chave, estado === 'a' ? 'a' : 'd', hoje]);
  let novo = { ...plano, sg: sg.slice(-SG_MAX) };
  while (serializarPlanoAcao(novo).length > PLANO_LIMITE_JSON && novo.sg.length > 1) {
    novo = { ...novo, sg: novo.sg.slice(1) };
  }
  const texto = serializarPlanoAcao(novo);
  if (texto.length > PLANO_LIMITE_JSON) {
    return { erro: `O plano de ação deste lead ficou grande demais para o monday (${texto.length} de ${PLANO_LIMITE_JSON} caracteres). Encurte as ações antes de decidir sugestões.` };
  }
  return { plano: novo, texto };
}

// Aceite completo sobre o plano: grava a ação (com origem) e a decisão. Respeita
// a revisão da trilha (controle de conflito já existente).
export function aplicarAceite(plano, sugestao, validado, { autor, agora, expectedRev, hoje }) {
  const r = aplicarAcaoNoPlano(plano, sugestao.trilha, validado.nova, { expectedRev, autor, agora });
  if (r.conflito) return { conflito: true, atual: r.atual };
  return registrarDecisao(r.plano, sugestao.chave, 'a', hoje);
}

// ------------------------------------------------------------------ visão semanal do gestor

// Critérios (mostrados na tela, ver CRITERIOS_GESTOR):
//  - semProximaAcao: ativa (Lead/Qualificado/Proposta Enviada/Em Negociação) sem
//    ação com data na trilha de vendas;
//  - compromissosVencidos: ação combinada com o cliente com data anterior a hoje;
//  - propostasSemAvanco: proposta enviada (envio registrado, ou data da etapa
//    "Proposta Enviada" na falta dele) há ≥ N dias, sem REGISTRO de contato efetivo
//    depois do envio e sem ação agendada;
//  - compras30/compras60: prazo previsto de compra em 0–30 e 31–60 dias;
//  - passagemPosVenda: Fechada sem ação de pós-venda ou sem vendedor de pós-venda.
export const CRITERIOS_GESTOR = {
  semProximaAcao: 'Oportunidade ativa (Lead, Qualificado, Proposta Enviada ou Em Negociação) sem próxima ação com data.',
  compromissosVencidos: 'Ação combinada com o cliente cuja data já passou.',
  propostasSemAvanco: 'Proposta enviada há N dias ou mais (data do envio registrado; sem ela, a data da etapa "Proposta Enviada"), sem registro de contato efetivo depois do envio e sem ação futura agendada. "Sem registro" não prova que não houve atendimento.',
  compras30: 'Prazo previsto de compra de hoje até 30 dias.',
  compras60: 'Prazo previsto de compra de 31 a 60 dias.',
  passagemPosVenda: 'Venda fechada sem ação de pós-venda registrada ou sem vendedor de pós-venda indicado (não indica entrega).',
};

export function visaoSemanal(items, cfgEntrada, { hoje, responsavelId = null } = {}) {
  const cfg = normalizarConfig(cfgEntrada);
  const out = { semProximaAcao: [], compromissosVencidos: [], propostasSemAvanco: [], compras30: [], compras60: [], passagemPosVenda: [] };
  const linha = (it, extra = {}) => ({
    itemId: String(it.id),
    nome: nomeDoLead(it),
    estagio: it.estagio || null,
    responsavelIds: (it.responsavelIds || []).map(String),
    ...extra,
  });
  for (const it of items || []) {
    if (responsavelId && !ehResponsavel(it, responsavelId)) continue;
    const trilha = trilhaDoItem(it);
    if (trilha === TRILHAS.POS_VENDA) {
      if (it.estagio === 'Fechado') {
        const a = getAcao(it, TRILHAS.POS_VENDA);
        if (!a.acao || !it.vendedorPosVenda) {
          out.passagemPosVenda.push(linha(it, { semAcao: !a.acao, semVendedor: !it.vendedorPosVenda, fechadoEm: dateOnly(it.dataFechamento) }));
        }
      }
      continue;
    }
    if (trilha !== TRILHAS.VENDAS) continue;
    const sit = situacaoDaAcao(it, TRILHAS.VENDAS, hoje);
    if (sit.semAcao) out.semProximaAcao.push(linha(it, { ultimoContato: dateOnly(it.ultimoContato) }));
    if (sit.compromissoVencido) out.compromissosVencidos.push(linha(it, { acao: sit.acao.acao, data: sit.data, diasAtraso: diffDays(sit.data, hoje) }));
    const docs = it.propostasRegistro?.docs || [];
    const enviadas = docs.filter((d) => d.situacao === 'enviada' && d.envioEm).sort((a, b) => b.envioEm.localeCompare(a.envioEm));
    const envio = enviadas[0]?.envioEm || (it.estagio === 'Proposta Enviada' ? dateOnly(it.dataPropostaEnviada) : null);
    if (envio) {
      const uc = dateOnly(it.ultimoContato);
      const dias = diffDays(envio, hoje);
      if (dias >= cfg.diasPropostaSemAvanco && !(uc && uc > envio) && !sit.agendadaFutura) {
        out.propostasSemAvanco.push(linha(it, { enviadoEm: envio, dias, fonteEnvio: enviadas[0] ? 'registro explícito' : 'data da etapa' }));
      }
    }
    const prazo = dateOnly(it.prazoCompra);
    if (prazo) {
      const d = diffDays(hoje, prazo);
      const extra = { prazo, dias: d, impedimento: String(it.principalImpedimento || '').trim() || null, proximaAcao: sit.acao.acao ? { acao: sit.acao.acao, data: sit.data } : null };
      if (d >= 0 && d <= 30) out.compras30.push(linha(it, extra));
      else if (d > 30 && d <= 60) out.compras60.push(linha(it, extra));
    }
  }
  const porPrazo = (a, b) => (a.prazo || '').localeCompare(b.prazo || '');
  out.compras30.sort(porPrazo);
  out.compras60.sort(porPrazo);
  out.compromissosVencidos.sort((a, b) => b.diasAtraso - a.diasAtraso);
  out.propostasSemAvanco.sort((a, b) => b.dias - a.dias);
  return { ...out, hoje, criterios: CRITERIOS_GESTOR, diasPropostaSemAvanco: cfg.diasPropostaSemAvanco };
}
