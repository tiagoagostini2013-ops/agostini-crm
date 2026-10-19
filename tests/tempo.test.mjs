// Datas comerciais em America/Sao_Paulo e dias úteis. Dados FICTÍCIOS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hojeSP, dataSP, localSPParaISO, fmtDataHoraSP, ehDiaUtil, somaDiasUteis, proximoDiaUtilOuIgual, feriadosNacionais } from '../lib/tempo.js';

test('hojeSP usa o dia de Brasília, não o de UTC', () => {
  // 01:30 UTC de 20/10 ainda é 22:30 de 19/10 em Brasília
  assert.equal(hojeSP(new Date('2026-10-20T01:30:00Z')), '2026-10-19');
  assert.equal(hojeSP(new Date('2026-10-20T03:00:00Z')), '2026-10-20');
});

test('localSPParaISO e fmtDataHoraSP são inversos', () => {
  const iso = localSPParaISO('2026-10-19T14:30');
  assert.equal(iso, '2026-10-19T17:30:00.000Z');
  assert.equal(fmtDataHoraSP(iso), '19/10/2026 14:30');
  assert.equal(dataSP(iso), '2026-10-19');
  assert.equal(localSPParaISO('2026-02-31T10:00'), null);
  assert.equal(localSPParaISO('lixo'), null);
});

test('dias úteis pulam fim de semana e feriados nacionais', () => {
  // 2026-10-12 (segunda) é feriado (N. Sra. Aparecida)
  assert.equal(ehDiaUtil('2026-10-12'), false);
  assert.equal(ehDiaUtil('2026-10-17'), false); // sábado
  assert.equal(ehDiaUtil('2026-10-19'), true);
  assert.equal(somaDiasUteis('2026-10-16', 1), '2026-10-19'); // sexta → segunda
  assert.equal(somaDiasUteis('2026-10-09', 1), '2026-10-13'); // sexta → terça (segunda é feriado)
  assert.equal(proximoDiaUtilOuIgual('2026-10-17'), '2026-10-19');
  assert.equal(proximoDiaUtilOuIgual('2026-10-19'), '2026-10-19');
});

test('feriados móveis de 2026 (Páscoa 05/04)', () => {
  const f = feriadosNacionais(2026);
  assert.ok(f.has('2026-02-16')); // Carnaval segunda
  assert.ok(f.has('2026-02-17')); // Carnaval terça
  assert.ok(f.has('2026-04-03')); // Sexta-feira Santa
  assert.ok(f.has('2026-06-04')); // Corpus Christi
});
