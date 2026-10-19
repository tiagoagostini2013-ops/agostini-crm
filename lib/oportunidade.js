// Dados ESTRUTURADOS da oportunidade que não têm coluna própria no board:
// nome da oportunidade e quais contatos (pessoas) participam dela. Fica numa
// coluna long_text "Oportunidade (JSON)" do próprio item — o mesmo padrão de
// "Plano de Ação (JSON)". Puro e testado em tests/oportunidade.test.mjs.
//
// Fonte de verdade de cada informação (sem cópias):
//   empresa (organização)  → item no board Empresas  (vínculo: coluna "Empresa ID")
//   contato (pessoa)       → item no board Contatos  (telefone, e-mail, papel)
//   oportunidade           → o item do CRM Agostini (estágio, valor, prazo,
//                            impedimento, próxima ação, responsáveis…)
//   vínculo opp ↔ contatos → ESTE JSON (lista de ids de contato)
//   propostas              → coluna "Propostas — Registro (JSON)" (lib/propostas.js)
// Limite do monday: 2.000 caracteres por coluna long_text.

export const LIMITE_OPP_JSON = 1900;
export const MAX_CONTATOS_POR_OPP = 20;
export const NOME_OPP_MAX = 80;

export function oportunidadeVazia() {
  return { v: 1, rev: 0, nome: null, contatoIds: [], atualizadoEm: null, atualizadoPor: null, corrompido: false };
}

export function serializarOportunidade(o) {
  const out = { v: 1, r: o.rev || 0 };
  if (o.nome) out.n = o.nome;
  if (o.contatoIds?.length) out.c = o.contatoIds.map(String);
  if (o.atualizadoEm) out.u = o.atualizadoEm;
  if (o.atualizadoPor) out.b = String(o.atualizadoPor).slice(0, 30);
  return JSON.stringify(out);
}

// Tolerante: vazio/corrompido nunca derruba a tela; `corrompido` impede regravar
// por cima sem aviso.
export function parseOportunidade(texto) {
  if (!texto) return oportunidadeVazia();
  try {
    const o = JSON.parse(texto);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ...oportunidadeVazia(), corrompido: true };
    return {
      v: 1,
      rev: Number(o.r) || 0,
      nome: typeof o.n === 'string' && o.n.trim() ? o.n.trim().slice(0, NOME_OPP_MAX) : null,
      contatoIds: Array.isArray(o.c) ? [...new Set(o.c.map(String))] : [],
      atualizadoEm: o.u || null,
      atualizadoPor: o.b || null,
      corrompido: false,
    };
  } catch {
    return { ...oportunidadeVazia(), corrompido: true };
  }
}

// patch: { nome?, adicionarContatoId?, removerContatoId?, contatoIds? }.
// Controle de conflito por revisão (mesmo princípio do plano de ação).
// Devolve { conflito, atual } | { erro } | { oportunidade, texto, mudou }.
export function aplicarOportunidade(atual, patch, { expectedRev, autor, agora } = {}) {
  const base = atual || oportunidadeVazia();
  if (base.corrompido) {
    return { erro: 'O registro da oportunidade está ilegível no monday. Corrija a coluna "Oportunidade (JSON)" antes de editar por aqui.' };
  }
  if (expectedRev !== undefined && expectedRev !== null && Number(expectedRev) !== (base.rev || 0)) {
    return { conflito: true, atual: base };
  }
  const prox = { ...base, contatoIds: [...base.contatoIds] };
  if (patch.nome !== undefined) {
    const n = String(patch.nome || '').replace(/\s+/g, ' ').trim();
    if (n.length > NOME_OPP_MAX) return { erro: `O nome da oportunidade pode ter no máximo ${NOME_OPP_MAX} caracteres.` };
    prox.nome = n || null;
  }
  if (Array.isArray(patch.contatoIds)) prox.contatoIds = [...new Set(patch.contatoIds.map(String))];
  if (patch.adicionarContatoId) {
    const id = String(patch.adicionarContatoId);
    if (!prox.contatoIds.includes(id)) prox.contatoIds.push(id);
  }
  if (patch.removerContatoId) {
    prox.contatoIds = prox.contatoIds.filter((x) => x !== String(patch.removerContatoId));
  }
  if (prox.contatoIds.length > MAX_CONTATOS_POR_OPP) {
    return { erro: `Uma oportunidade pode ter no máximo ${MAX_CONTATOS_POR_OPP} contatos vinculados.` };
  }
  const mudou = prox.nome !== base.nome || prox.contatoIds.join(',') !== base.contatoIds.join(',');
  if (!mudou) return { oportunidade: base, texto: serializarOportunidade(base), mudou: false };
  prox.rev = (base.rev || 0) + 1;
  prox.atualizadoEm = agora || new Date().toISOString();
  prox.atualizadoPor = autor || null;
  const texto = serializarOportunidade(prox);
  if (texto.length > LIMITE_OPP_JSON) {
    return { erro: 'O registro da oportunidade ficou grande demais para a coluna do monday (limite de 2.000 caracteres). Remova algum vínculo.' };
  }
  return { oportunidade: prox, texto, mudou: true };
}
