// Registro de propostas: revisão × alternativa, vigente, duplicatas. FICTÍCIO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registroVazio, aplicarOperacao, serializarRegistro, parseRegistro, visaoPropostas, sugerirAgrupamentos, chaveBase, formatoDe, LIMITE_JSON } from '../lib/propostas.js';

let n = 0;
const ctx = (extra = {}) => ({ gerarId: () => `p${++n}`, autor: 'Ana Teste', agora: '2026-10-19T12:00:00Z', hoje: '2026-10-19', ...extra });

test('DOCX e PDF da mesma proposta = um único documento (mesma chave)', () => {
  assert.equal(chaveBase('Proposta 2026-045 rev B.docx'), chaveBase('Proposta 2026-045 rev B.pdf'));
  assert.notEqual(chaveBase('Proposta 2026-045 rev B.pdf'), chaveBase('Proposta 2026-045 rev C.pdf'));
  const g = sugerirAgrupamentos([{ assetId: '1', name: 'Proposta 2026-045 rev B.docx' }, { assetId: '2', name: 'Proposta 2026-045 rev B.pdf' }]);
  assert.equal(g.length, 1);
  assert.equal(g[0].arquivos.length, 2);
  assert.equal(g[0].possivelDuplicata, false);
  assert.equal(formatoDe('x.docx'), 'DOCX');
});

test('sinaliza possível duplicata sem excluir nada', () => {
  const g = sugerirAgrupamentos([{ assetId: '1', name: 'Proposta A.pdf' }, { assetId: '2', name: 'Proposta A (1).pdf' }]);
  assert.equal(g[0].possivelDuplicata, true);
  assert.equal(g[0].arquivos.length, 2);
});

test('registrar exige situação explícita; arquivo não pode ir para dois documentos', () => {
  assert.ok(aplicarOperacao(registroVazio(), { acao: 'registrar', numero: '1', arquivos: ['1'] }, ctx()).erro);
  const a = aplicarOperacao(registroVazio(), { acao: 'registrar', numero: '2026-045', revisao: 'A', situacao: 'enviada', valor: 100000, arquivos: ['1', '2'] }, ctx());
  assert.ok(a.registro);
  const b = aplicarOperacao(a.registro, { acao: 'registrar', numero: '2026-046', situacao: 'rascunho', arquivos: ['2'] }, ctx());
  assert.match(b.erro, /já está registrado/);
});

test('nova revisão: rascunho, valor NÃO herdado nem somado; vigente troca a anterior para substituída', () => {
  let r = aplicarOperacao(registroVazio(), { acao: 'registrar', numero: '2026-045', revisao: 'A', situacao: 'enviada', valor: 100000, arquivos: ['1'] }, ctx()).registro;
  const idA = r.docs[0].id;
  r = aplicarOperacao(r, { acao: 'vigente', id: idA }, ctx()).registro;
  const rev = aplicarOperacao(r, { acao: 'nova_revisao', baseId: idA, revisao: 'B', arquivos: ['3'] }, ctx());
  assert.equal(rev.registro.docs[1].situacao, 'rascunho');
  assert.equal(rev.registro.docs[1].valor, null);
  const idB = rev.registro.docs[1].id;
  const v = aplicarOperacao(rev.registro, { acao: 'vigente', id: idB }, ctx());
  assert.equal(v.registro.docs[0].situacao, 'substituida');
  assert.equal(v.registro.vigenteId, idB);
  assert.ok(v.efeitos.length === 1);
  // revisão duplicada é recusada
  assert.match(aplicarOperacao(v.registro, { acao: 'nova_revisao', baseId: idA, revisao: 'B' }, ctx()).erro, /Já existe/);
});

test('alternativa técnica é outro tipo, sem soma de valores e sem substituir a principal', () => {
  let r = aplicarOperacao(registroVazio(), { acao: 'registrar', numero: '2026-045', situacao: 'enviada', valor: 100, arquivos: ['1'] }, ctx()).registro;
  const alt = aplicarOperacao(r, { acao: 'registrar', tipo: 'alternativa', rotulo: 'com esteira', numero: '2026-045', situacao: 'enviada', valor: 150, arquivos: ['2'] }, ctx());
  assert.equal(alt.registro.docs[1].tipo, 'alternativa');
  const vis = visaoPropostas(alt.registro, [{ assetId: '1', name: 'a.pdf' }, { assetId: '2', name: 'b.pdf' }], []);
  assert.equal(vis.docs.length, 2);
  assert.equal(vis.vigente, null);
  assert.equal(vis.semVigente, true);
  assert.equal(vis.total, undefined); // nenhum total somado
  assert.ok(aplicarOperacao(r, { acao: 'registrar', tipo: 'alternativa', situacao: 'enviada' }, ctx()).erro); // exige rótulo
});

test('aceite só por confirmação manual; visualização é estimativa; aviso de rastreio × rascunho', () => {
  let r = aplicarOperacao(registroVazio(), { acao: 'registrar', numero: '9', situacao: 'rascunho', arquivos: ['5'] }, ctx()).registro;
  const vis = visaoPropostas(r, [{ assetId: '5', name: 'p.pdf' }], [{ sendId: 's', assetId: '5', sentAt: '2026-10-10T10:00:00Z', viewCount: 4 }]);
  assert.equal(vis.docs[0].situacao, 'rascunho');
  assert.ok(vis.docs[0].avisoRastreio);
  assert.equal(vis.aceitas, 0); // 4 visualizações não viram aceite
  const ac = aplicarOperacao(r, { acao: 'aceitar', id: r.docs[0].id }, ctx());
  assert.equal(ac.registro.docs[0].situacao, 'aceita');
});

test('serialização compacta ida e volta, corrompido e limite de tamanho', () => {
  let r = registroVazio();
  for (let i = 0; i < 12; i++) {
    const o = aplicarOperacao(r, { acao: 'registrar', numero: `2026-0${i}`, revisao: 'A', situacao: 'enviada', valor: 12345.67, arquivos: [`10000000${i}`, `20000000${i}`], obs: 'observação curta' }, ctx());
    if (o.erro) { assert.match(o.erro, /grande demais|Limite/); break; }
    assert.ok(o.texto.length <= LIMITE_JSON);
    r = o.registro;
  }
  const volta = parseRegistro(serializarRegistro(r));
  assert.equal(volta.docs.length, r.docs.length);
  assert.equal(parseRegistro('{quebrado').corrompido, true);
  assert.ok(aplicarOperacao(parseRegistro('{quebrado'), { acao: 'vigente', id: 'x' }, ctx()).erro);
});

test('conflito de edição: revisão desatualizada não sobrescreve', () => {
  const a = aplicarOperacao(registroVazio(), { acao: 'registrar', numero: '1', situacao: 'rascunho' }, ctx()).registro;
  const c = aplicarOperacao(a, { acao: 'registrar', numero: '2', situacao: 'rascunho' }, ctx({ expectedRev: 0 }));
  assert.equal(c.conflito, true);
});

test('remover só tira o registro, nunca os arquivos (assets) — e some o vigente', () => {
  let r = aplicarOperacao(registroVazio(), { acao: 'registrar', numero: '1', situacao: 'enviada', arquivos: ['1'] }, ctx()).registro;
  r = aplicarOperacao(r, { acao: 'vigente', id: r.docs[0].id }, ctx()).registro;
  const rm = aplicarOperacao(r, { acao: 'remover', id: r.docs[0].id }, ctx());
  assert.equal(rm.registro.docs.length, 0);
  assert.equal(rm.registro.vigenteId, null);
  assert.match(rm.nota, /arquivos anexados não foram apagados/);
});
