// Histórico unificado, classificação de contato e leitura tolerante. FICTÍCIO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretarUpdate, montarHistorico, ultimoContatoEfetivo, ultimaAtividade, atendimentoSemProximoPasso } from '../lib/historico.js';
import { parseTrackingListTolerante } from '../lib/proposalTracking.js';

const USUARIOS = ['Ana Teste', 'Bruno Teste'];

test('atendimento v1 antigo: autor do texto, canal, efetivo; sem "quando aconteceu"', () => {
  const r = interpretarUpdate('✅ Atividade registrada por Ana Teste — Vendas ativas\nCanal: WhatsApp · Contato efetivo com o cliente: sim\nResultado: pediu desconto', { usuarios: USUARIOS });
  assert.equal(r.tipo, 'atendimento');
  assert.equal(r.categoria, 'efetivo');
  assert.equal(r.autor, 'Ana Teste');
  assert.equal(r.canal, 'WhatsApp');
  assert.equal(r.ocorreuEm, null); // não inventa data de ocorrência
});

test('atendimento v2: tentativa sem resposta, "Quando" e Ref', () => {
  const t = '✅ Atendimento registrado por Bruno Teste — Vendas ativas\nQuando: 19/10/2026 10:15\nCanal: Ligação · Contato efetivo com o cliente: não\nResultado: caixa postal\nPróximo passo: nenhum agendado.\nRef: abc123';
  const r = interpretarUpdate(t, { usuarios: USUARIOS });
  assert.equal(r.categoria, 'tentativa');
  assert.equal(r.ref, 'abc123');
  assert.equal(r.ocorreuEm, '2026-10-19T13:15:00.000Z');
});

test('atividade interna nunca é contato efetivo', () => {
  const r = interpretarUpdate('✅ Atendimento registrado por Ana Teste — Pós-venda\nCanal: Interno (sem contato com o cliente) · Contato efetivo com o cliente: sim\nResultado: alinhei com a produção', { usuarios: USUARIOS });
  assert.equal(r.categoria, 'interno');
});

test('anotações livres: autor só é aceito se for usuário conhecido', () => {
  const a = interpretarUpdate('Ana Teste: cliente quer visitar a fábrica', { usuarios: USUARIOS });
  assert.equal(a.autor, 'Ana Teste');
  assert.equal(a.categoria, 'nao_informado'); // antiga: não sabemos se foi contato
  const b = interpretarUpdate('Obs: ligar depois das 14h', { usuarios: USUARIOS });
  assert.equal(b.autor, null); // "Obs" não vira autor
  const c = interpretarUpdate('Bruno Teste (anotação interna): conferir estoque', { usuarios: USUARIOS });
  assert.equal(c.categoria, 'interno');
  assert.equal(c.autor, 'Bruno Teste');
});

test('texto original é preservado (anotações antigas em formato original)', () => {
  const r = interpretarUpdate('Texto solto sem padrão nenhum', { usuarios: USUARIOS });
  assert.equal(r.conteudo, 'Texto solto sem padrão nenhum');
  assert.equal(r.autor, null);
});

const ITEM = { createdAt: '2026-09-01T12:00:00Z', dataQualificacao: '2026-09-05', dataPropostaEnviada: '2026-10-10' };

test('histórico: ordena, mistura fontes e não duplica envio de PDF (nota + rastreio)', () => {
  const updates = [
    { id: '1', text: 'Ana Teste: primeiro contato', createdAt: '2026-09-02T12:00:00Z' },
    { id: '2', text: '📄 PDF gerado e link de rastreio criado por Ana Teste — avisa quando o cliente abrir.', createdAt: '2026-10-10T15:00:30Z' },
  ];
  const rastreio = [{ sendId: 's1', fileName: 'Proposta 2026-045.pdf', assetId: '9', sentAt: '2026-10-10T15:00:00Z', sentBy: 'Ana Teste', firstViewedAt: '2026-10-11T09:00:00Z', lastViewedAt: '2026-10-12T09:00:00Z', viewCount: 3 }];
  const h = montarHistorico({ updates, rastreio, item: ITEM, usuarios: USUARIOS });
  const envios = h.filter((e) => e.tipo === 'proposta_envio');
  assert.equal(envios.length, 1, 'o mesmo envio não pode aparecer duas vezes');
  assert.ok(h.some((e) => e.tipo === 'proposta_visualizacao' && /estimada/.test(e.conteudo)));
  const datas = h.map((e) => e.ocorreuEm || e.registradoEm);
  const ordenado = [...datas].sort((a, b) => String(new Date(b)) < String(new Date(a)) ? -1 : 1);
  assert.equal(h[0].tipo, 'proposta_visualizacao'); // 11/10 é o mais recente
  assert.equal(h.at(-1).tipo, 'criacao');
  assert.ok(ordenado.length === datas.length);
});

test('histórico: mesmo update repetido (id) ou mesma Ref (duplo clique) aparece uma vez', () => {
  const t = '✅ Atendimento registrado por Ana Teste — Vendas ativas\nCanal: Ligação · Contato efetivo com o cliente: sim\nResultado: ok\nRef: r1';
  const h = montarHistorico({
    updates: [
      { id: '10', text: t, createdAt: '2026-10-19T12:00:00Z' },
      { id: '11', text: t, createdAt: '2026-10-19T12:00:02Z' },
      { id: '10', text: t, createdAt: '2026-10-19T12:00:00Z' },
    ],
    item: {},
    usuarios: USUARIOS,
  });
  assert.equal(h.filter((e) => e.tipo === 'atendimento').length, 1);
});

test('último contato efetivo ignora tentativa, interno, nota antiga e visualização', () => {
  const mk = (id, txt, quando) => ({ id, text: txt, createdAt: quando });
  const updates = [
    mk('1', '✅ Atendimento registrado por Ana Teste — Vendas ativas\nCanal: Ligação · Contato efetivo com o cliente: sim\nResultado: conversamos', '2026-10-10T12:00:00Z'),
    mk('2', '✅ Atendimento registrado por Ana Teste — Vendas ativas\nCanal: WhatsApp · Contato efetivo com o cliente: não\nResultado: sem resposta', '2026-10-18T12:00:00Z'),
    mk('3', 'Ana Teste (anotação interna): lembrar de ligar', '2026-10-19T12:00:00Z'),
  ];
  const rastreio = [{ sendId: 's', sentAt: '2026-10-17T10:00:00Z', firstViewedAt: '2026-10-19T10:00:00Z', viewCount: 1 }];
  const h = montarHistorico({ updates, rastreio, item: {}, usuarios: USUARIOS });
  const u = ultimoContatoEfetivo(h, null);
  assert.equal(u.data, '2026-10-10');
  assert.equal(ultimoContatoEfetivo(h, '2026-10-05').data, '2026-10-10'); // coluna mais antiga não vence
  assert.equal(ultimoContatoEfetivo(h, '2026-10-12').fonte, 'coluna');
  assert.equal(ultimaAtividade(h).categoria, 'interno'); // última atividade ≠ último contato efetivo
});

test('pendência: atendimento sem próximo passo é sinalizado', () => {
  const h = montarHistorico({
    updates: [{ id: '1', text: '✅ Atendimento registrado por Ana Teste — Vendas ativas\nCanal: E-mail · Contato efetivo com o cliente: sim\nResultado: enviei\nPróximo passo: nenhum agendado.', createdAt: '2026-10-19T12:00:00Z' }],
    item: {},
    usuarios: USUARIOS,
  });
  assert.equal(atendimentoSemProximoPasso(h), true);
});

test('rastreio truncado em 2000 caracteres: recupera registros inteiros e avisa', () => {
  const um = (n) => ({ sendId: `s${n}`, fileName: `Proposta ${n}.pdf`, assetId: String(n), sentAt: '2026-10-01T10:00:00Z', viewCount: 0 });
  const completo = JSON.stringify([um(1), um(2), um(3)]);
  const cortado = completo.slice(0, completo.length - 40);
  const r = parseTrackingListTolerante(cortado);
  assert.equal(r.truncado, true);
  assert.equal(r.lista.length, 2);
  assert.deepEqual(parseTrackingListTolerante(completo), { lista: [um(1), um(2), um(3)], truncado: false });
  assert.deepEqual(parseTrackingListTolerante(''), { lista: [], truncado: false });
});
