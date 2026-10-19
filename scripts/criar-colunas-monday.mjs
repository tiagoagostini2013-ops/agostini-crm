#!/usr/bin/env node
// Cria no quadro do monday.com as 5 colunas novas usadas pela agenda/prioridades v1:
//   Prazo Previsto de Compra (data) · Data de Reativação (data) ·
//   Próximo Contato Pós-venda (data) · Principal Impedimento (texto) ·
//   Plano de Ação (JSON) (texto longo)
//
// SEGURO POR PADRÃO: sem flags só faz a CONSULTA e mostra o que seria criado
// (dry-run). Só cria de fato com --criar. É idempotente: se já existir uma coluna
// com o mesmo título e tipo, reaproveita (não duplica) e apenas imprime o id.
// Nunca altera nem apaga colunas existentes, nem dados de leads.
//
// Uso:
//   MONDAY_API_TOKEN=... MONDAY_BOARD_ID=18404435549 node --no-warnings scripts/criar-colunas-monday.mjs
//   MONDAY_API_TOKEN=... MONDAY_BOARD_ID=18404435549 node --no-warnings scripts/criar-colunas-monday.mjs --criar
//
// No final imprime as linhas MONDAY_COL_* para colar nas variáveis de ambiente
// da Vercel (e redeploy). Enquanto elas não existirem o CRM roda em "modo compatível".

import { NOVAS_COLUNAS } from '../lib/config.js';

const TOKEN = process.env.MONDAY_API_TOKEN;
const BOARD_ID = process.env.MONDAY_BOARD_ID;
const API_URL = process.env.MONDAY_API_URL || 'https://api.monday.com/v2';
const CRIAR = process.argv.includes('--criar');

if (!TOKEN || !BOARD_ID) {
  console.error('Defina MONDAY_API_TOKEN e MONDAY_BOARD_ID no ambiente.');
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

const norm = (s) => String(s || '').trim().toLowerCase();

const dados = await gql(
  'query ($ids: [ID!]) { boards(ids: $ids) { columns { id title type } } }',
  { ids: [BOARD_ID] }
);
const existentes = dados.boards?.[0]?.columns || [];
console.log(`Quadro ${BOARD_ID}: ${existentes.length} colunas existentes.`);
console.log(CRIAR ? 'Modo: CRIAR (colunas ausentes serão criadas).\n' : 'Modo: dry-run (nada será criado; use --criar).\n');

const linhas = [];
for (const c of NOVAS_COLUNAS) {
  const jaExiste = existentes.find((e) => norm(e.title) === norm(c.title) && e.type === c.type);
  if (jaExiste) {
    console.log(`= já existe  "${c.title}" (${c.type}) → ${jaExiste.id}`);
    linhas.push(`${c.envVar}=${jaExiste.id}`);
    continue;
  }
  const mesmoTituloOutroTipo = existentes.find((e) => norm(e.title) === norm(c.title));
  if (mesmoTituloOutroTipo) {
    console.log(`! conflito   "${c.title}" já existe com tipo "${mesmoTituloOutroTipo.type}" (esperado ${c.type}) — NÃO foi criada; resolva manualmente.`);
    continue;
  }
  if (!CRIAR) {
    console.log(`+ criaria    "${c.title}" (${c.type})`);
    continue;
  }
  const r = await gql(
    'mutation ($boardId: ID!, $title: String!, $columnType: ColumnType!) { create_column(board_id: $boardId, title: $title, column_type: $columnType) { id title type } }',
    { boardId: BOARD_ID, title: c.title, columnType: c.type }
  );
  console.log(`+ criada     "${c.title}" (${c.type}) → ${r.create_column.id}`);
  linhas.push(`${c.envVar}=${r.create_column.id}`);
}

if (linhas.length) {
  console.log('\nVariáveis de ambiente (Vercel → Settings → Environment Variables):');
  for (const l of linhas) console.log(l);
}
if (!CRIAR) console.log('\n(dry-run: rode de novo com --criar para criar as colunas que faltam.)');
