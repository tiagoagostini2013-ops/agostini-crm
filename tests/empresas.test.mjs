// Empresa × contato × oportunidade: normalização, sugestões e registro JSON. FICTÍCIO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarNomeEmpresa, normalizarTelefone, sugerirVinculosEmpresa, sugerirGruposDeLeads, acharContatoEquivalente, achaDuplicatasContatos } from '../lib/empresas.js';
import { parseOportunidade, aplicarOportunidade, serializarOportunidade, LIMITE_OPP_JSON } from '../lib/oportunidade.js';

test('normalização de nomes e telefones', () => {
  assert.equal(normalizarNomeEmpresa('Pré-Moldados Silva LTDA.'), 'pre moldados silva');
  assert.equal(normalizarNomeEmpresa('  PRE MOLDADOS SILVA  '), 'pre moldados silva');
  assert.equal(normalizarTelefone('+55 (47) 99912-3456'), '47999123456');
  assert.equal(normalizarTelefone('3456-7890'), ''); // curto demais para comparar
});

test('sugestões nunca aplicam nada e respeitam leads já vinculados', () => {
  const empresas = [{ id: 'E1', nome: 'Pré-Moldados Silva Ltda' }, { id: 'E2', nome: 'Concreto Norte' }];
  const leads = [
    { id: '1', name: 'João', empresa: 'PRE MOLDADOS SILVA' },
    { id: '2', name: 'Maria', empresa: 'Silva Pré Moldados Industriais' },
    { id: '3', name: 'Zé', empresa: 'Outra Coisa' },
    { id: '4', name: 'Já ligado', empresa: 'Pré-Moldados Silva', empresaId: 'E1' },
  ];
  const s = sugerirVinculosEmpresa(leads, empresas);
  assert.equal(s.find((x) => x.leadId === '1').confianca, 'alta');
  assert.equal(s.find((x) => x.leadId === '2').confianca, 'media');
  assert.equal(s.find((x) => x.leadId === '3'), undefined);
  assert.equal(s.find((x) => x.leadId === '4'), undefined);
  assert.ok(leads.every((l) => l.empresaId === undefined || l.id === '4')); // entrada intacta
});

test('grupos de leads sem empresa: só nomes normalizados IGUAIS', () => {
  const g = sugerirGruposDeLeads([
    { id: '1', name: 'A', empresa: 'Forma Certa Ltda' },
    { id: '2', name: 'B', empresa: 'FORMA CERTA' },
    { id: '3', name: 'C', empresa: 'Forma Certa Pré' }, // parecido, mas NÃO agrupa
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].leads.map((l) => l.id), ['1', '2']);
});

test('contatos: equivalência por telefone e duplicatas', () => {
  const contatos = [{ id: 'C1', nome: 'Carlos', telefone: '(47) 99912-3456' }, { id: 'C2', nome: 'Carlos S.', telefone: '+5547999123456' }];
  assert.equal(acharContatoEquivalente({ name: 'Carlos', phone: '47 99912 3456' }, contatos).id, 'C1');
  assert.equal(achaDuplicatasContatos(contatos).length, 1);
  assert.equal(acharContatoEquivalente({ name: 'X', phone: '' }, contatos), null);
});

test('registro da oportunidade: vínculo de contatos, revisão e conflito', () => {
  let o = parseOportunidade('');
  assert.equal(o.rev, 0);
  let r = aplicarOportunidade(o, { nome: 'Máquina de blocos MX', adicionarContatoId: 'C1' }, { autor: 'Ana Teste', agora: '2026-10-19T12:00:00Z' });
  assert.equal(r.oportunidade.rev, 1);
  o = parseOportunidade(r.texto);
  assert.deepEqual(o.contatoIds, ['C1']);
  assert.equal(o.nome, 'Máquina de blocos MX');
  // conflito: outra pessoa já salvou (rev 1), quem editou viu rev 0
  const c = aplicarOportunidade(o, { adicionarContatoId: 'C2' }, { expectedRev: 0 });
  assert.equal(c.conflito, true);
  // sem mudança → não incrementa
  const s = aplicarOportunidade(o, { adicionarContatoId: 'C1' }, { expectedRev: 1 });
  assert.equal(s.mudou, false);
  assert.equal(s.oportunidade.rev, 1);
  // corrompido não é regravado
  assert.ok(aplicarOportunidade(parseOportunidade('{quebrado'), { nome: 'x' }).erro);
});

test('registro da oportunidade respeita o limite do monday', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `1234567890${i}`);
  const r = aplicarOportunidade(parseOportunidade(''), { contatoIds: ids, nome: 'x'.repeat(80) }, { autor: 'a'.repeat(30) });
  assert.ok(r.erro || serializarOportunidade(r.oportunidade).length <= LIMITE_OPP_JSON);
});
