#!/usr/bin/env node
// SIMULAÇÃO SOMENTE LEITURA do vínculo entre leads existentes, empresas e contatos.
// Não grava NADA no monday.com (só faz consultas). Serve para o Tiago conferir o plano ANTES de
// qualquer vínculo ou migração em produção. O resultado são SUGESTÕES para revisão humana:
// nenhum lead é agrupado ou vinculado automaticamente por nome parecido.
//
// Uso:
//   MONDAY_API_TOKEN=... MONDAY_BOARD_ID=18404435549 \
//   [MONDAY_EMPRESAS_BOARD_ID=... MONDAY_CONTATOS_BOARD_ID=... + colunas] \
//   node --no-warnings scripts/simular-vinculos-empresas.mjs [--json]
//
// Sem o quadro de Empresas configurado, ainda mostra os grupos de leads com o MESMO nome de empresa
// (candidatos a virar UMA empresa nova) e os contatos antigos que seriam migrados.

import { fetchAllItems } from '../lib/monday.js';
import { COLUMNS, BOARD_ID, EMPRESAS_BOARD_ID, EMPRESAS_COLUMNS, CONTATOS_BOARD_ID, CONTATOS_COLUMNS } from '../lib/config.js';
import { sugerirVinculosEmpresa, sugerirGruposDeLeads, acharContatoEquivalente, achaDuplicatasContatos } from '../lib/empresas.js';

if (!process.env.MONDAY_API_TOKEN || !BOARD_ID) {
  console.error('Defina MONDAY_API_TOKEN e MONDAY_BOARD_ID no ambiente.');
  process.exit(1);
}
const JSON_OUT = process.argv.includes('--json');

function colTexto(item, id) {
  if (!id) return '';
  const cols = item.columnValues || item.column_values || item.columns;
  if (Array.isArray(cols)) return cols.find((c) => c.id === id)?.text || '';
  return cols?.[id]?.text || '';
}

const ids = [COLUMNS.empresa, COLUMNS.empresaId, COLUMNS.contatosDecisao, COLUMNS.telefone].filter(Boolean);
const itens = await fetchAllItems(BOARD_ID, ids);
const leads = itens.map((it) => {
  let contatos = [];
  try {
    const raw = colTexto(it, COLUMNS.contatosDecisao);
    const j = raw ? JSON.parse(raw) : [];
    if (Array.isArray(j)) contatos = j;
  } catch {
    contatos = [];
  }
  return { id: it.id, name: it.name, empresa: colTexto(it, COLUMNS.empresa) || null, empresaId: colTexto(it, COLUMNS.empresaId) || null, contatos };
});

let empresas = [];
if (EMPRESAS_BOARD_ID) {
  const cols = [EMPRESAS_COLUMNS.cnpj, EMPRESAS_COLUMNS.cidade].filter(Boolean);
  empresas = (await fetchAllItems(EMPRESAS_BOARD_ID, cols)).map((it) => ({ id: it.id, nome: it.name, cnpj: colTexto(it, EMPRESAS_COLUMNS.cnpj) || null }));
}
let contatosCad = [];
if (CONTATOS_BOARD_ID) {
  const cols = Object.values(CONTATOS_COLUMNS).filter(Boolean);
  contatosCad = (await fetchAllItems(CONTATOS_BOARD_ID, cols)).map((it) => ({
    id: it.id,
    nome: it.name,
    telefone: colTexto(it, CONTATOS_COLUMNS.telefone) || null,
    empresaId: colTexto(it, CONTATOS_COLUMNS.empresaId) || null,
  }));
}

const legados = [];
for (const l of leads) for (const c of l.contatos) legados.push({ leadId: l.id, leadNome: l.name, contato: c, equivalente: acharContatoEquivalente(c, contatosCad) });
const semEmpresaTexto = leads.filter((l) => !l.empresaId && !l.empresa);
const vinculos = sugerirVinculosEmpresa(leads, empresas);
const grupos = sugerirGruposDeLeads(leads);
const resultado = {
  somenteLeitura: true,
  totais: {
    leads: leads.length,
    leadsJaVinculados: leads.filter((l) => l.empresaId).length,
    leadsComEmpresaEmTexto: leads.filter((l) => !l.empresaId && l.empresa).length,
    leadsSemEmpresaIdentificada: semEmpresaTexto.length,
    empresasCadastradas: empresas.length,
    contatosCadastrados: contatosCad.length,
    contatosLegadosNosLeads: legados.length,
  },
  vinculosSugeridos: vinculos,
  gruposDeLeadsParaUmaEmpresaNova: grupos,
  contatosLegados: legados.map((x) => ({ leadId: x.leadId, leadNome: x.leadNome, nome: x.contato.name, papel: x.contato.role || null, telefone: x.contato.phone || null, jaExisteNoCadastro: x.equivalente ? { id: x.equivalente.id, nome: x.equivalente.nome } : null })),
  contatosPossivelmenteDuplicadosNoCadastro: achaDuplicatasContatos(contatosCad).map((g) => g.map((c) => ({ id: c.id, nome: c.nome }))),
};

if (JSON_OUT) {
  console.log(JSON.stringify(resultado, null, 2));
} else {
  const t = resultado.totais;
  console.log('SIMULAÇÃO (somente leitura — nada foi gravado no monday.com)\n');
  console.log(`Leads: ${t.leads} · já vinculados a uma empresa: ${t.leadsJaVinculados} · empresa só em texto: ${t.leadsComEmpresaEmTexto} · sem empresa identificada: ${t.leadsSemEmpresaIdentificada}`);
  console.log(`Empresas cadastradas: ${t.empresasCadastradas}${EMPRESAS_BOARD_ID ? '' : ' (quadro de Empresas ainda não configurado)'} · Contatos cadastrados: ${t.contatosCadastrados}${CONTATOS_BOARD_ID ? '' : ' (quadro de Contatos ainda não configurado)'}`);
  console.log(`Contatos no formato antigo dentro dos leads: ${t.contatosLegadosNosLeads}\n`);
  console.log(`Vínculos sugeridos lead → empresa existente (${vinculos.length}) — para REVISAR, nenhum será aplicado sozinho:`);
  for (const v of vinculos) console.log(`  [${v.confianca}] "${v.leadNome}" (${v.leadId}) → "${v.empresaNome}" (${v.empresaId}) — ${v.motivo}`);
  console.log(`\nGrupos de leads com o MESMO nome de empresa, candidatos a UMA empresa nova (${grupos.length}):`);
  for (const g of grupos) console.log(`  "${g.nomeSugerido}": ${g.leads.map((l) => `${l.nome} (${l.id})`).join(' · ')}`);
  console.log('\nNomes parecidos mas diferentes NÃO são agrupados: só aparecem como sugestão "média" quando já existe a empresa cadastrada.');
  console.log(`\nContatos antigos que seriam trazidos para o cadastro de Contatos (${legados.length}); já equivalentes (mesmo telefone): ${legados.filter((x) => x.equivalente).length}.`);
  console.log('Use --json para o detalhamento completo.');
}
