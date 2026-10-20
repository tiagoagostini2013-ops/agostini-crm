#!/usr/bin/env node
// VALIDAÇÃO SOMENTE LEITURA da estrutura da v2: confere se cada variável de ambiente aponta para
// uma coluna/quadro que existe no monday, com o TIPO esperado, e avisa de duplicatas e de
// variáveis ausentes. Não grava nada.
//
// Uso (mesmas variáveis que estão na Vercel; o token só no seu terminal):
//   MONDAY_API_TOKEN=... MONDAY_BOARD_ID=18404435549 \
//   MONDAY_COL_EMPRESA_ID=... MONDAY_COL_OPORTUNIDADE=... MONDAY_COL_PROPOSTAS_REGISTRO=... \
//   MONDAY_EMPRESAS_BOARD_ID=... MONDAY_EMPRESAS_COL_CNPJ=... MONDAY_EMPRESAS_COL_CIDADE=... \
//   MONDAY_CONTATOS_BOARD_ID=... MONDAY_CONTATOS_COL_TELEFONE=... MONDAY_CONTATOS_COL_EMAIL=... \
//   MONDAY_CONTATOS_COL_PAPEL=... MONDAY_CONTATOS_COL_EMPRESA_ID=... \
//   node --no-warnings scripts/validar-estrutura-oportunidades.mjs
// Código de saída 0 = tudo certo; 1 = algo faltando/errado.

import {
  BOARD_ID, COLUMNS, COLUNAS_V2,
  EMPRESAS_BOARD_ID, EMPRESAS_COLUMNS, EMPRESAS_COLUNAS_DEF,
  CONTATOS_BOARD_ID, CONTATOS_COLUMNS, CONTATOS_COLUNAS_DEF,
} from '../lib/config.js';

const TOKEN = process.env.MONDAY_API_TOKEN;
const API_URL = process.env.MONDAY_API_URL || 'https://api.monday.com/v2';
if (!TOKEN) {
  console.error('Defina MONDAY_API_TOKEN no ambiente (apenas no seu terminal).');
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

let falhas = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const ruim = (m) => { falhas += 1; console.log(`  ✘ ${m}`); };
const aviso = (m) => console.log(`  ! ${m}`);

async function conferir(rotulo, boardId, defs, mapa) {
  console.log(`\n${rotulo}`);
  if (!boardId) { ruim('variável do quadro ausente'); }
  let cols = [];
  if (boardId) {
    const d = await gql('query ($ids: [ID!]) { boards(ids: $ids) { name state columns { id title type } } }', { ids: [boardId] });
    const b = d.boards?.[0];
    if (!b) ruim(`quadro ${boardId} não encontrado (ou sem permissão para este token)`);
    else { ok(`quadro ${boardId} "${b.name}" (${b.state})`); cols = b.columns || []; }
  }
  for (const def of defs) {
    const id = mapa[def.key];
    if (!id) { ruim(`${def.envVar} não definida (${def.title})`); continue; }
    const col = cols.find((c) => c.id === id);
    if (!col) { ruim(`${def.envVar}=${id}: coluna não existe neste quadro`); continue; }
    if (col.type !== def.type) { ruim(`${def.envVar}=${id}: tipo "${col.type}", esperado "${def.type}"`); continue; }
    ok(`${def.envVar}=${id} → "${col.title}" (${col.type})`);
    const iguais = cols.filter((c) => c.title.trim().toLowerCase() === def.title.trim().toLowerCase() && c.type === def.type);
    if (iguais.length > 1) aviso(`há ${iguais.length} colunas "${def.title}" (${iguais.map((c) => c.id).join(', ')}) — confira se a variável aponta para a certa`);
  }
}

await conferir(`Quadro do CRM ${BOARD_ID}`, BOARD_ID, COLUNAS_V2, COLUMNS);
await conferir('Quadro de Empresas', EMPRESAS_BOARD_ID, EMPRESAS_COLUNAS_DEF, EMPRESAS_COLUMNS);
await conferir('Quadro de Contatos', CONTATOS_BOARD_ID, CONTATOS_COLUNAS_DEF, CONTATOS_COLUMNS);
if (EMPRESAS_BOARD_ID && CONTATOS_BOARD_ID && EMPRESAS_BOARD_ID === CONTATOS_BOARD_ID) ruim('Empresas e Contatos apontam para o MESMO quadro');
if (EMPRESAS_BOARD_ID === BOARD_ID || CONTATOS_BOARD_ID === BOARD_ID) ruim('Empresas/Contatos não podem ser o quadro do CRM');

console.log(falhas ? `\n${falhas} problema(s). Corrija as variáveis (ou rode criar-estrutura-oportunidades.mjs) e valide de novo.` : '\nEstrutura válida: todas as variáveis apontam para colunas existentes do tipo certo.');
process.exit(falhas ? 1 : 0);
