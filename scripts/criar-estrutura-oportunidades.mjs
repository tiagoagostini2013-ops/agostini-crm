#!/usr/bin/env node
// Cria a ESTRUTURA do monday.com usada pela etapa "Atendimento e gestão de oportunidades":
//
//   1) no quadro do CRM (oportunidades): 3 colunas
//        Empresa ID (texto) · Oportunidade (JSON) (texto longo) · Propostas — Registro (JSON) (texto longo)
//   2) um quadro "Empresas (CRM Agostini)"  — item = empresa; colunas CNPJ e Cidade/UF (ambas opcionais)
//   3) um quadro "Contatos (CRM Agostini)"  — item = contato; colunas Telefone, E-mail, Papel na decisão, Empresa ID
//
// SEGURO POR PADRÃO: sem flags só CONSULTA e mostra o que seria criado (dry-run).
// Só cria de verdade com --criar. É idempotente: reaproveita o que já existe (mesmo título e tipo)
// e imprime os ids. Nunca altera nem apaga colunas, quadros ou itens existentes e NÃO migra nem
// vincula nenhum dado de leads — isso é feito depois, item a item, pela tela (ou por plano aprovado).
//
// Uso:
//   MONDAY_API_TOKEN=... MONDAY_BOARD_ID=18404435549 node --no-warnings scripts/criar-estrutura-oportunidades.mjs
//   MONDAY_API_TOKEN=... MONDAY_BOARD_ID=18404435549 node --no-warnings scripts/criar-estrutura-oportunidades.mjs --criar
//
// Para reaproveitar quadros que você já criou à mão, informe MONDAY_EMPRESAS_BOARD_ID e/ou
// MONDAY_CONTATOS_BOARD_ID: o script só confere/cria as colunas que faltam neles.
//
// No final imprime as linhas de variáveis de ambiente (Vercel → Settings → Environment Variables)
// e o lembrete de fazer redeploy. Sem elas o CRM segue em "modo compatível" (avisa na tela).

import { COLUNAS_V2, EMPRESAS_COLUNAS_DEF, CONTATOS_COLUNAS_DEF } from '../lib/config.js';

const TOKEN = process.env.MONDAY_API_TOKEN;
const BOARD_ID = process.env.MONDAY_BOARD_ID;
const API_URL = process.env.MONDAY_API_URL || 'https://api.monday.com/v2';
const CRIAR = process.argv.includes('--criar');
const NOME_EMPRESAS = process.env.MONDAY_EMPRESAS_BOARD_NAME || 'Empresas (CRM Agostini)';
const NOME_CONTATOS = process.env.MONDAY_CONTATOS_BOARD_NAME || 'Contatos (CRM Agostini)';

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
const linhas = [];
const pendencias = [];

async function colunasDe(boardId) {
  const d = await gql('query ($ids: [ID!]) { boards(ids: $ids) { columns { id title type } } }', { ids: [boardId] });
  return d.boards?.[0]?.columns || [];
}

// Garante as colunas de `defs` no quadro; devolve true se tudo existe (ou existiria, no dry-run).
async function garantirColunas(boardId, rotulo, defs, existentes) {
  for (const c of defs) {
    const ja = existentes.find((e) => norm(e.title) === norm(c.title) && e.type === c.type);
    if (ja) {
      console.log(`  = já existe  "${c.title}" (${c.type}) → ${ja.id}`);
      linhas.push(`${c.envVar}=${ja.id}`);
      continue;
    }
    const outroTipo = existentes.find((e) => norm(e.title) === norm(c.title));
    if (outroTipo) {
      console.log(`  ! conflito   "${c.title}" já existe com tipo "${outroTipo.type}" (esperado ${c.type}) — NÃO criada; resolva manualmente.`);
      pendencias.push(`${rotulo} › ${c.title}`);
      continue;
    }
    if (!CRIAR || !boardId) {
      console.log(`  + criaria    "${c.title}" (${c.type})`);
      pendencias.push(`${rotulo} › ${c.title}`);
      continue;
    }
    const r = await gql(
      'mutation ($boardId: ID!, $title: String!, $columnType: ColumnType!) { create_column(board_id: $boardId, title: $title, column_type: $columnType) { id title type } }',
      { boardId, title: c.title, columnType: c.type }
    );
    console.log(`  + criada     "${c.title}" (${c.type}) → ${r.create_column.id}`);
    linhas.push(`${c.envVar}=${r.create_column.id}`);
  }
}

// Acha (por id informado ou por nome) ou cria o quadro; devolve o id (ou null no dry-run).
async function garantirQuadro({ nome, envVar, idInformado, workspaceId, kind }) {
  if (idInformado) {
    console.log(`  = usando o quadro informado em ${envVar}: ${idInformado}`);
    linhas.push(`${envVar}=${idInformado}`);
    return String(idInformado);
  }
  const lista = await gql('query { boards(limit: 200) { id name } }');
  const achado = (lista.boards || []).find((b) => norm(b.name) === norm(nome));
  if (achado) {
    console.log(`  = já existe o quadro "${nome}" → ${achado.id}`);
    linhas.push(`${envVar}=${achado.id}`);
    return String(achado.id);
  }
  if (!CRIAR) {
    console.log(`  + criaria o quadro "${nome}"`);
    pendencias.push(`quadro ${nome}`);
    return null;
  }
  const r = await gql(
    'mutation ($name: String!, $kind: BoardKind!, $ws: ID) { create_board(board_name: $name, board_kind: $kind, workspace_id: $ws) { id } }',
    { name: nome, kind: kind || 'private', ws: workspaceId || null }
  );
  console.log(`  + criado o quadro "${nome}" → ${r.create_board.id}`);
  linhas.push(`${envVar}=${r.create_board.id}`);
  return String(r.create_board.id);
}

console.log(CRIAR ? 'Modo: CRIAR (o que faltar será criado).\n' : 'Modo: dry-run (nada será criado; use --criar).\n');

// 1) quadro do CRM
let workspaceId = null;
let kind = 'private';
try {
  const info = await gql('query ($ids: [ID!]) { boards(ids: $ids) { board_kind workspace { id } } }', { ids: [BOARD_ID] });
  workspaceId = info.boards?.[0]?.workspace?.id || null;
  kind = info.boards?.[0]?.board_kind || 'private';
} catch {
  // sem workspace/kind: o monday cria no padrão da conta
}
const existentesCrm = await colunasDe(BOARD_ID);
console.log(`Quadro do CRM ${BOARD_ID}: ${existentesCrm.length} colunas existentes.`);
await garantirColunas(BOARD_ID, 'CRM', COLUNAS_V2, existentesCrm);

// 2) quadro Empresas
console.log(`\nQuadro "${NOME_EMPRESAS}":`);
const empresasId = await garantirQuadro({ nome: NOME_EMPRESAS, envVar: 'MONDAY_EMPRESAS_BOARD_ID', idInformado: process.env.MONDAY_EMPRESAS_BOARD_ID, workspaceId, kind });
await garantirColunas(empresasId, 'Empresas', EMPRESAS_COLUNAS_DEF, empresasId ? await colunasDe(empresasId) : []);

// 3) quadro Contatos
console.log(`\nQuadro "${NOME_CONTATOS}":`);
const contatosId = await garantirQuadro({ nome: NOME_CONTATOS, envVar: 'MONDAY_CONTATOS_BOARD_ID', idInformado: process.env.MONDAY_CONTATOS_BOARD_ID, workspaceId, kind });
await garantirColunas(contatosId, 'Contatos', CONTATOS_COLUNAS_DEF, contatosId ? await colunasDe(contatosId) : []);

if (linhas.length) {
  console.log('\nVariáveis de ambiente (Vercel → Settings → Environment Variables, depois redeploy):');
  for (const l of linhas) console.log(l);
}
if (pendencias.length) {
  console.log(`\nAinda faltam (${pendencias.length}): ${pendencias.join(' · ')}`);
  if (!CRIAR) console.log('(dry-run: rode de novo com --criar para criar o que falta.)');
} else {
  console.log('\nEstrutura completa. Nenhum dado de lead foi alterado, migrado ou vinculado.');
}
