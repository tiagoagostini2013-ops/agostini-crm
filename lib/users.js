// Camada de acesso ao board separado "CRM Agostini - Usuários do Painel"
// (id configurado em lib/config.js) — guarda quem pode entrar no painel.
// Reaproveita as funções genéricas de lib/monday.js (o board de usuários é
// só mais um board do monday.com, igual o de leads).
import { fetchAllItems, createLead, updateItemColumns } from './monday';
import { USERS_BOARD_ID, USER_COLUMNS } from './config';

const COLUMN_IDS = Object.values(USER_COLUMNS);

function mapUser(item) {
  const c = item.columns || {};
  const senhaHash = c[USER_COLUMNS.senhaHash]?.value?.text || null;
  const admin = !!c[USER_COLUMNS.admin]?.value?.checked;
  const ativoValue = c[USER_COLUMNS.ativo]?.value;
  // Se o campo "Ativo" nunca foi definido, trata como ativo (evita travar o
  // primeiro usuário criado antes de qualquer edição manual no monday).
  const ativo = ativoValue ? !!ativoValue.checked : true;
  return { id: item.id, name: item.name, senhaHash, admin, ativo };
}

export async function fetchAppUsers() {
  const items = await fetchAllItems(USERS_BOARD_ID, COLUMN_IDS);
  return items.map(mapUser);
}

export async function findAppUserByName(name) {
  if (!name) return null;
  const norm = name.trim().toLowerCase();
  const users = await fetchAppUsers();
  return users.find((u) => u.name.trim().toLowerCase() === norm) || null;
}

export async function createAppUser(name, senhaHash, { admin = false } = {}) {
  const columnValues = {
    [USER_COLUMNS.senhaHash]: senhaHash,
    [USER_COLUMNS.admin]: { checked: admin ? 'true' : 'false' },
    [USER_COLUMNS.ativo]: { checked: 'true' },
  };
  return createLead(USERS_BOARD_ID, null, name.trim(), columnValues);
}

export async function updateAppUser(itemId, fields) {
  const columnValues = {};
  if (fields.senhaHash !== undefined) columnValues[USER_COLUMNS.senhaHash] = fields.senhaHash;
  if (fields.admin !== undefined) columnValues[USER_COLUMNS.admin] = { checked: fields.admin ? 'true' : 'false' };
  if (fields.ativo !== undefined) columnValues[USER_COLUMNS.ativo] = { checked: fields.ativo ? 'true' : 'false' };
  if (Object.keys(columnValues).length === 0) return null;
  return updateItemColumns(USERS_BOARD_ID, itemId, columnValues);
}
