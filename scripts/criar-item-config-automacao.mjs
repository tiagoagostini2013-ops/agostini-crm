#!/usr/bin/env node
// Cria (uma vez) o ITEM de configuração da automação do acompanhamento no quadro
// "CRM Agostini - Configurações" (o mesmo quadro do forecast). Não cria quadro nem coluna:
// só um item cuja coluna "Valor (JSON)" guarda as configurações do administrador.
//
// SEGURO POR PADRÃO: sem flags só CONSULTA (dry-run). --criar cria o item se ainda não existir
// (mesmo nome). Idempotente: se já existe, só imprime o id. Nunca altera outros itens.
//
// Uso:
//   MONDAY_API_TOKEN=... node --no-warnings scripts/criar-item-config-automacao.mjs
//   MONDAY_API_TOKEN=... node --no-warnings scripts/criar-item-config-automacao.mjs --criar
//
// No final imprime a variável para a Vercel:  MONDAY_AUTOMACAO_SETTINGS_ITEM_ID=<id>
// (e lembra do redeploy). Sem ela o CRM usa os padrões e a tela de configuração fica somente leitura.

import { SETTINGS_BOARD_ID, SETTINGS_COLUMNS } from '../lib/config.js';
import { CONFIG_PADRAO } from '../lib/automacao.js';

const TOKEN = process.env.MONDAY_API_TOKEN;
const API_URL = process.env.MONDAY_API_URL || 'https://api.monday.com/v2';
const CRIAR = process.argv.includes('--criar');
const NOME = 'Automação do acompanhamento (configurações)';

if (!TOKEN) {
  console.error('Defina MONDAY_API_TOKEN no ambiente.');
  process.exit(1);
}
process.on('uncaughtException', (e) => {
  console.error(`\nErro: ${e.message}`);
  process.exit(1);
});

async function gql(query, variables) {
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: TOKEN }, body: JSON.stringify({ query, variables }) });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

const d = await gql(
  `query ($id: ID!) { boards(ids: [$id]) { items_page(limit: 200) { items { id name } } } }`,
  { id: SETTINGS_BOARD_ID }
);
const itens = d.boards?.[0]?.items_page?.items || [];
const existente = itens.find((i) => i.name.trim().toLowerCase() === NOME.toLowerCase());

let id = existente?.id || null;
if (existente) {
  console.log(`Item já existe no quadro Configurações (id ${existente.id}). Nada a criar.`);
} else if (!CRIAR) {
  console.log(`[dry-run] Seria criado o item "${NOME}" no quadro ${SETTINGS_BOARD_ID} com a configuração padrão. Rode com --criar para criar.`);
} else {
  const r = await gql(
    `mutation CreateItem($boardId: ID!, $itemName: String!, $columnValues: JSON) { create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) { id } }`,
    { boardId: SETTINGS_BOARD_ID, itemName: NOME, columnValues: JSON.stringify({ [SETTINGS_COLUMNS.valorJson]: JSON.stringify(CONFIG_PADRAO) }) }
  );
  id = r.create_item.id;
  console.log(`Item criado (id ${id}).`);
}

if (id) {
  console.log('\nCadastre na Vercel (Settings → Environment Variables) e faça redeploy:');
  console.log(`  MONDAY_AUTOMACAO_SETTINGS_ITEM_ID=${id}`);
}
