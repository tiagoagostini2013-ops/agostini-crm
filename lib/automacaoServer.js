// Acesso ao monday e permissões da automação (v3). A lógica de negócio está em
// lib/automacao.js (pura e testada); aqui ficam só leitura/gravação e escopo.
import { fetchAllItems, fetchItemFlat, fetchItemColumnText, updateItemColumns } from './monday';
import {
  BOARD_ID,
  SETTINGS_BOARD_ID,
  SETTINGS_COLUMNS,
  AUTOMACAO_SETTINGS_ITEM_ID,
  AUTOMACAO_DESATIVADA_AMBIENTE,
  columnIdsConfigurados,
} from './config';
import { flattenItem } from './transform';
import { normalizarConfig } from './automacao.js';
import { fetchAppUsers } from './users';

const TTL_CONFIG_MS = 15000;
let cacheConfig = null;

// Config efetiva. Nunca lança: se o monday falhar, usa os padrões e AVISA
// (`erro`), em vez de derrubar a tela. A chave de emergência do ambiente vence tudo.
export async function carregarConfig({ forcar = false } = {}) {
  const agora = Date.now();
  if (!forcar && cacheConfig && agora - cacheConfig.em < TTL_CONFIG_MS) return cacheConfig.valor;
  let bruto = null;
  let erro = null;
  if (AUTOMACAO_SETTINGS_ITEM_ID) {
    try {
      const texto = await fetchItemColumnText(AUTOMACAO_SETTINGS_ITEM_ID, SETTINGS_COLUMNS.valorJson);
      if (texto) bruto = JSON.parse(texto);
    } catch (e) {
      erro = `Não foi possível ler as configurações da automação (${e.message}). Usando os padrões.`;
    }
  }
  const config = normalizarConfig(bruto);
  const valor = {
    config: AUTOMACAO_DESATIVADA_AMBIENTE ? { ...config, ativo: false } : config,
    fonte: bruto ? 'monday' : 'padrao',
    gravavel: !!AUTOMACAO_SETTINGS_ITEM_ID,
    desativadaPeloAmbiente: AUTOMACAO_DESATIVADA_AMBIENTE,
    erro,
  };
  if (!erro) cacheConfig = { em: agora, valor };
  return valor;
}

export async function salvarConfig(parcial) {
  if (!AUTOMACAO_SETTINGS_ITEM_ID) {
    throw Object.assign(new Error('Falta informar MONDAY_AUTOMACAO_SETTINGS_ITEM_ID (item do quadro Configurações). Veja o README, seção "Automação do acompanhamento".'), { status: 409 });
  }
  const atual = (await carregarConfig({ forcar: true })).config;
  const nova = normalizarConfig({ ...atual, ...parcial, regras: { ...atual.regras, ...(parcial.regras || {}) } });
  // `ativo` salvo é o do administrador (não o efeito da chave do ambiente).
  await updateItemColumns(SETTINGS_BOARD_ID, AUTOMACAO_SETTINGS_ITEM_ID, { [SETTINGS_COLUMNS.valorJson]: JSON.stringify(nova) });
  cacheConfig = null;
  return nova;
}

export async function carregarLeads() {
  const items = await fetchAllItems(BOARD_ID, columnIdsConfigurados());
  return items.map(flattenItem);
}

export async function carregarLead(itemId) {
  const it = await fetchItemFlat(Number(itemId), columnIdsConfigurados());
  return it ? flattenItem(it) : null;
}

// Quem está logado → escopo. Admin vê tudo; os demais, só as oportunidades em
// que são responsáveis. Usuário sem vínculo com o monday não vê nem decide nada
// (evita expor a carteira dos outros).
export async function escopoDaSessao(sessao) {
  if (!sessao) return { erro: 'Não autenticado.', status: 401 };
  if (sessao.admin) return { admin: true, mondayUserId: null, nome: sessao.name };
  let mondayUserId = null;
  try {
    const users = await fetchAppUsers();
    const eu = users.find((u) => String(u.id) === String(sessao.uid));
    mondayUserId = eu?.mondayUserId ? String(eu.mondayUserId) : null;
  } catch {
    // sem vínculo conhecido → sem acesso (fail closed)
  }
  if (!mondayUserId) return { admin: false, mondayUserId: null, nome: sessao.name, semVinculo: true };
  return { admin: false, mondayUserId, nome: sessao.name };
}
