// Testes das regras puras da Agenda (lib/agenda.js). Só dados FICTÍCIOS.
// Rodar: npm test   (usa o test runner nativo do Node, sem dependências novas)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  trilhaDoItem,
  computeAgendaPorTrilha,
  contarAlertas,
  alertaDoCard,
  compararNoKanban,
  pendenciasProximaAcao,
  parsePlanoAcao,
  aplicarAcaoNoPlano,
  serializarPlanoAcao,
  responsavelEfetivo,
  descreverEscopo,
  addDaysStr,
  diffDays,
  getAcao,
} from '../lib/agenda.js';

const HOJE = '2026-10-19';

function lead(over = {}) {
  return {
    id: String(Math.random()),
    name: 'Lead Fictício',
    empresa: 'Empresa Teste',
    estagio: 'Qualificado',
    responsavelIds: ['1'],
    vendedorPosVenda: null,
    proximoFollowUp: null,
    ultimoContato: null,
    dataReativacao: null,
    proximoContatoPosVenda: null,
    planoAcao: parsePlanoAcao(null),
    ...over,
  };
}

test('datas: aritmética por string não escorrega de dia', () => {
  assert.equal(addDaysStr('2026-10-31', 1), '2026-11-01');
  assert.equal(addDaysStr('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-10-01', '2026-10-19'), 18);
  assert.equal(diffDays('2026-10-19', '2026-10-01'), -18);
});

test('trilha deriva do estágio', () => {
  assert.equal(trilhaDoItem(lead({ estagio: 'Lead' })), 'vendas');
  assert.equal(trilhaDoItem(lead({ estagio: 'Em Negociação' })), 'vendas');
  assert.equal(trilhaDoItem(lead({ estagio: null })), 'vendas');
  assert.equal(trilhaDoItem(lead({ estagio: 'Perdido' })), 'reativacao');
  assert.equal(trilhaDoItem(lead({ estagio: 'Fechado' })), 'posVenda');
});

test('perdido com follow-up comercial vencido NÃO gera alerta e o agendamento antigo é preservado', () => {
  const perdido = lead({ estagio: 'Perdido', proximoFollowUp: '2026-09-01' });
  const copia = JSON.stringify(perdido);
  const ag = computeAgendaPorTrilha([perdido], HOJE);
  assert.equal(ag.vendas.atrasados.length, 0);
  assert.equal(ag.reativacao.vencidas.length, 0);
  assert.deepEqual(ag.reativacao.legado.map((i) => i.id), [perdido.id]);
  assert.equal(contarAlertas(ag).total, 0);
  assert.equal(JSON.stringify(perdido), copia, 'não pode mutar/apagar dados');
  assert.equal(alertaDoCard(perdido, HOJE), null);
});

test('reativação tem agenda própria e não entra no contador de alertas', () => {
  const venc = lead({ estagio: 'Perdido', dataReativacao: '2026-10-10' });
  const hoje = lead({ estagio: 'Perdido', dataReativacao: HOJE });
  const prox = lead({ estagio: 'Perdido', dataReativacao: '2026-11-10' });
  const longe = lead({ estagio: 'Perdido', dataReativacao: '2027-03-01' });
  const ag = computeAgendaPorTrilha([venc, hoje, prox, longe], HOJE);
  assert.equal(ag.reativacao.vencidas.length, 1);
  assert.equal(ag.reativacao.hoje.length, 1);
  assert.equal(ag.reativacao.proximos30.length, 1);
  assert.equal(contarAlertas(ag).total, 0);
  assert.match(alertaDoCard(venc, HOJE).text, /reativação prevista há 9d/);
  assert.equal(alertaDoCard(hoje, HOJE).text, '🔁 reativar hoje');
});

test('fechado direciona para pós-venda (e só ele alerta)', () => {
  const atrasado = lead({ estagio: 'Fechado', proximoContatoPosVenda: '2026-10-15', vendedorPosVenda: '2' });
  const comFuAntigo = lead({ estagio: 'Fechado', proximoFollowUp: '2026-08-01' });
  const ag = computeAgendaPorTrilha([atrasado, comFuAntigo], HOJE);
  assert.equal(ag.posVenda.atrasados.length, 1);
  assert.equal(ag.vendas.atrasados.length, 0, 'follow-up de vendas de um fechado não vira atraso comercial');
  assert.equal(contarAlertas(ag).posVendaAtrasados, 1);
  assert.equal(alertaDoCard(atrasado, HOJE).text, '📞 pós-venda atrasado 4d');
  assert.equal(alertaDoCard(comFuAntigo, HOJE), null);
});

test('vendas: mantém as regras antigas (atrasado/hoje/7 dias/sem data parado >5d)', () => {
  const a = lead({ proximoFollowUp: '2026-10-17' });
  const h = lead({ proximoFollowUp: HOJE });
  const p = lead({ proximoFollowUp: '2026-10-24' });
  const longe = lead({ proximoFollowUp: '2026-12-01' });
  const parado = lead({ ultimoContato: '2026-10-01' });
  const nuncaContatado = lead();
  const recente = lead({ ultimoContato: '2026-10-18' });
  const ag = computeAgendaPorTrilha([a, h, p, longe, parado, nuncaContatado, recente], HOJE);
  assert.equal(ag.vendas.atrasados.length, 1);
  assert.equal(ag.vendas.hoje.length, 1);
  assert.equal(ag.vendas.proximos7.length, 1);
  assert.equal(ag.vendas.semData.length, 2);
  assert.equal(alertaDoCard(a, HOJE).text, '⚠ follow-up atrasado 2d');
  assert.equal(alertaDoCard(recente, HOJE).text, '🔔 marcar follow-up');
});

test('pendências da próxima ação (só vendas ativas; nunca bloqueia)', () => {
  assert.deepEqual(pendenciasProximaAcao(lead({ responsavelIds: [] })), ['ação concreta', 'data', 'responsável']);
  const completo = lead({
    proximoFollowUp: HOJE,
    planoAcao: parsePlanoAcao(JSON.stringify({ vendas: { acao: 'Confirmar dimensões das placas', responsavelId: '7' } })),
  });
  assert.deepEqual(pendenciasProximaAcao(completo), []);
  assert.deepEqual(pendenciasProximaAcao(lead({ estagio: 'Perdido', responsavelIds: [] })), []);
  assert.deepEqual(pendenciasProximaAcao(lead({ estagio: 'Fechado', responsavelIds: [] })), []);
});

test('responsável efetivo: explícito > padrão (pós-venda usa o vendedor do handoff)', () => {
  const ff = lead({ estagio: 'Fechado', responsavelIds: ['1', '2'], vendedorPosVenda: '2' });
  assert.equal(responsavelEfetivo(ff, 'posVenda'), '2');
  assert.equal(responsavelEfetivo(ff, 'vendas'), '1');
  const ex = lead({ planoAcao: parsePlanoAcao(JSON.stringify({ vendas: { acao: 'x', responsavelId: '9' } })) });
  assert.equal(responsavelEfetivo(ex, 'vendas'), '9');
});

test('plano de ação: parse tolerante', () => {
  for (const ruim of [null, '', 'não é json', '[]', '"x"', '{"vendas": 5}']) {
    const p = parsePlanoAcao(ruim);
    assert.equal(p.vendas, null);
    assert.equal(p.ultimoResultado, null);
  }
  const p = parsePlanoAcao(JSON.stringify({ vendas: { acao: '  Validar   financiamento ', responsavelId: 3, rev: 2 } }));
  assert.equal(p.vendas.acao, 'Validar financiamento');
  assert.equal(p.vendas.responsavelId, '3');
  assert.equal(p.vendas.rev, 2);
});

test('plano de ação: revisão evita sobrescrever edição de outra pessoa', () => {
  const base = parsePlanoAcao(null);
  const r1 = aplicarAcaoNoPlano(base, 'vendas', { acao: 'Ligar para o decisor', responsavelId: '1' }, { expectedRev: 0, autor: 'Ana' });
  assert.equal(r1.conflito, false);
  assert.equal(r1.plano.vendas.rev, 1);
  // Bruno ainda vê rev 0 e tenta salvar por cima:
  const r2 = aplicarAcaoNoPlano(r1.plano, 'vendas', { acao: 'Outra coisa', responsavelId: '2' }, { expectedRev: 0, autor: 'Bruno' });
  assert.equal(r2.conflito, true);
  assert.equal(r2.atual.acao, 'Ligar para o decisor');
  // Com a revisão certa, passa e incrementa:
  const r3 = aplicarAcaoNoPlano(r1.plano, 'vendas', { acao: 'Outra coisa', responsavelId: '2' }, { expectedRev: 1, autor: 'Bruno' });
  assert.equal(r3.conflito, false);
  assert.equal(r3.plano.vendas.rev, 2);
  assert.equal(r3.plano.vendas.atualizadoPor, 'Bruno');
});

test('plano de ação: trilhas são independentes e limpar uma não afeta as outras', () => {
  let plano = parsePlanoAcao(null);
  plano = aplicarAcaoNoPlano(plano, 'vendas', { acao: 'A', responsavelId: '1' }).plano;
  plano = aplicarAcaoNoPlano(plano, 'posVenda', { acao: 'B', responsavelId: '2' }).plano;
  plano = aplicarAcaoNoPlano(plano, 'vendas', null).plano;
  assert.equal(plano.vendas, null);
  assert.equal(plano.posVenda.acao, 'B');
  const ser = JSON.parse(serializarPlanoAcao(plano));
  assert.equal(ser.vendas, undefined);
  assert.equal(ser.posVenda.acao, 'B');
  assert.ok(serializarPlanoAcao(plano).length < 2000);
});

test('plano de ação: texto longo é truncado (coluna long_text tem limite)', () => {
  const r = aplicarAcaoNoPlano(parsePlanoAcao(null), 'vendas', { acao: 'x'.repeat(500), responsavelId: '1' });
  assert.equal(r.plano.vendas.acao.length, 140);
});

test('Kanban: ordem por trilha', () => {
  const a = lead({ proximoFollowUp: '2026-10-10' });
  const b = lead({ proximoFollowUp: '2026-10-15' });
  const c = lead({ ultimoContato: '2026-09-01' });
  assert.deepEqual([c, b, a].sort((x, y) => compararNoKanban(x, y, HOJE)), [a, b, c]);
  const p1 = lead({ estagio: 'Perdido', dataPerda: '2026-09-01' });
  const p2 = lead({ estagio: 'Perdido', dataPerda: '2026-10-01' });
  const p3 = lead({ estagio: 'Perdido', dataReativacao: '2026-12-01' });
  assert.deepEqual([p1, p2, p3].sort((x, y) => compararNoKanban(x, y, HOJE)), [p3, p2, p1]);
});

test('escopo explícito: equipe inteira vs usuário (+ filtros extras)', () => {
  assert.equal(descreverEscopo({ responsavelId: '', usersById: {} }).texto, 'Escopo: equipe inteira');
  assert.equal(descreverEscopo({ responsavelId: '5', usersById: { 5: { name: 'Fulana' } } }).texto, 'Escopo: Fulana');
  const t = descreverEscopo({ responsavelId: '', usersById: {}, outrosFiltros: ['segmento', 'período'] });
  assert.equal(t.texto, 'Escopo: equipe inteira · filtros ativos: segmento, período');
  assert.equal(t.equipe, true);
});

test('getAcao devolve vazio seguro para lead sem plano', () => {
  const a = getAcao({}, 'vendas');
  assert.deepEqual([a.acao, a.responsavelId, a.compromissoCliente, a.rev], ['', null, false, 0]);
});
