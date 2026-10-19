// Acesso (servidor) aos boards Empresas e Contatos e utilitários de gravação
// segura das rotas v2. Reaproveita as funções genéricas de lib/monday.js — os
// boards novos são só mais boards do monday, igual ao de usuários.
import { fetchAllItems, fetchItemUpdates, addItemNote } from './monday';
import {
  EMPRESAS_BOARD_ID,
  EMPRESAS_COLUMNS,
  CONTATOS_BOARD_ID,
  CONTATOS_COLUMNS,
} from './config';

const idsDe = (cols) => Object.values(cols).filter(Boolean);

export async function listarEmpresas() {
  if (!EMPRESAS_BOARD_ID) return [];
  const items = await fetchAllItems(EMPRESAS_BOARD_ID, idsDe(EMPRESAS_COLUMNS));
  return items.map((i) => ({
    id: String(i.id),
    nome: i.name,
    cnpj: (EMPRESAS_COLUMNS.cnpj && i.columns[EMPRESAS_COLUMNS.cnpj]?.text) || null,
    cidade: (EMPRESAS_COLUMNS.cidade && i.columns[EMPRESAS_COLUMNS.cidade]?.text) || null,
    createdAt: i.createdAt,
  }));
}

export async function listarContatos() {
  if (!CONTATOS_BOARD_ID) return [];
  const items = await fetchAllItems(CONTATOS_BOARD_ID, idsDe(CONTATOS_COLUMNS));
  const t = (i, k) => (CONTATOS_COLUMNS[k] && i.columns[CONTATOS_COLUMNS[k]]?.text) || null;
  return items.map((i) => ({
    id: String(i.id),
    nome: i.name,
    telefone: t(i, 'telefone'),
    email: t(i, 'email'),
    papel: t(i, 'papel'),
    empresaId: t(i, 'empresaId'),
    createdAt: i.createdAt,
  }));
}

export function novaRef() {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function refValida(ref) {
  return typeof ref === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(ref);
}

// Idempotência entre instâncias: o próprio histórico do monday guarda a
// "Ref: <id>" de cada registro. Se já existe um update recente com ela, o pedido
// é uma repetição (duplo clique, retry) e NÃO deve gravar de novo.
export async function refJaRegistrada(itemId, ref) {
  if (!refValida(ref)) return false;
  const { updates } = await fetchItemUpdates(itemId, { maxPaginas: 1, porPagina: 40 });
  return updates.some((u) => String(u.text || '').includes(`Ref: ${ref}`));
}

// Trava em memória contra requisições simultâneas idênticas dentro da mesma
// instância (a checagem acima cobre as sequenciais entre instâncias).
const emAndamento = new Set();
export function travar(chave) {
  if (emAndamento.has(chave)) return false;
  emAndamento.add(chave);
  return true;
}
export function soltar(chave) {
  emAndamento.delete(chave);
}

// Nota de histórico "best effort": o dado principal já foi gravado; se só a
// nota falhar a rota AVISA (notaRegistrada:false) em vez de fingir que deu certo.
export async function registrarNota(itemId, linhas, ref) {
  const texto = [...linhas, ...(ref ? [`Ref: ${ref}`] : [])].join('\n');
  try {
    await addItemNote(itemId, texto);
    return { ok: true, texto };
  } catch (err) {
    return { ok: false, texto, erro: err.message };
  }
}

// Controle de edição simultânea por campo: o cliente manda os valores que
// carregou (`base`); se algum campo que ele quer mudar já é outro no monday,
// devolve conflito em vez de sobrescrever em silêncio.
export function conflitoDeCampos(atual, base, campos) {
  if (!base) return null;
  const norm = (v) => (v === undefined || v === null ? '' : String(v));
  const divergentes = campos.filter((c) => c in base && norm(atual[c]) !== norm(base[c]));
  return divergentes.length ? divergentes : null;
}
