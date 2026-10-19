// Testes da pontuação de prioridades (lib/prioridades.js). Dados FICTÍCIOS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pontuarLead, calcularPrioridades, PESOS, SCORE_MINIMO } from '../lib/prioridades.js';
import { parsePlanoAcao } from '../lib/agenda.js';

const HOJE = '2026-10-19';

function lead(over = {}) {
  return {
    id: String(Math.random()),
    name: 'Lead Fictício',
    estagio: 'Qualificado',
    responsavelIds: ['1'],
    valorEstimado: null,
    proximoFollowUp: null,
    ultimoContato: '2026-10-18',
    prazoCompra: null,
    rastreioPropostas: [],
    planoAcao: parsePlanoAcao(null),
    ...over,
  };
}
const comAcao = (acao, extra = {}) => parsePlanoAcao(JSON.stringify({ vendas: { acao, responsavelId: '1', ...extra } }));

test('só vendas ativas são pontuadas', () => {
  assert.equal(pontuarLead(lead({ estagio: 'Perdido' }), HOJE), null);
  assert.equal(pontuarLead(lead({ estagio: 'Fechado' }), HOJE), null);
  assert.ok(pontuarLead(lead({ estagio: 'Lead' }), HOJE));
});

test('compromisso com o cliente pesa mais que valor: negócio pequeno com retorno combinado vence um grande sem compromisso', () => {
  const pequenoComCompromisso = lead({
    name: 'Pequeno',
    valorEstimado: '8000',
    proximoFollowUp: HOJE,
    planoAcao: comAcao('Enviar a condição combinada', { compromissoCliente: true }),
  });
  const grandeSemCompromisso = lead({ name: 'Grande', valorEstimado: '5000000', estagio: 'Em Negociação', proximoFollowUp: '2026-11-30' });
  const r = calcularPrioridades([grandeSemCompromisso, pequenoComCompromisso], HOJE);
  assert.equal(r.itens[0].item.name, 'Pequeno');
});

test('vencido há mais tempo pontua mais, com teto', () => {
  const um = pontuarLead(lead({ proximoFollowUp: '2026-10-18' }), HOJE);
  const cinco = pontuarLead(lead({ proximoFollowUp: '2026-10-14' }), HOJE);
  const cem = pontuarLead(lead({ proximoFollowUp: '2026-07-01' }), HOJE);
  const trinta = pontuarLead(lead({ proximoFollowUp: '2026-09-19' }), HOJE);
  assert.ok(cinco.score > um.score);
  assert.equal(cem.score, trinta.score, 'teto de dias de atraso');
});

test('campo ausente = desconhecido, sem pontuar nem penalizar', () => {
  const sem = pontuarLead(lead({ estagio: 'Proposta Enviada' }), HOJE);
  assert.deepEqual(sem.desconhecidos.sort(), ['Prazo de compra não informado', 'Valor estimado não informado']);
  assert.ok(!sem.motivos.some((m) => m.tipo === 'valor' || m.tipo === 'prazo'));
  assert.equal(sem.score, PESOS.estagio['Proposta Enviada']);
  // valor 0 também é "não informado":
  assert.ok(pontuarLead(lead({ valorEstimado: '0' }), HOJE).desconhecidos.includes('Valor estimado não informado'));
});

test('prazo de compra: faixas e prazo vencido', () => {
  const p = (d) => pontuarLead(lead({ prazoCompra: d }), HOJE).motivos.find((m) => m.tipo === 'prazo');
  assert.equal(p('2026-11-01').peso, PESOS.prazo30);
  assert.equal(p('2026-12-10').peso, PESOS.prazo60);
  assert.equal(p('2027-01-10').peso, PESOS.prazo90);
  assert.equal(p('2027-06-01'), undefined);
  assert.match(p('2026-10-01').texto, /já passou/);
});

test('proposta aberta recentemente aumenta a prioridade; enviada e ignorada também sinaliza', () => {
  const aberta = pontuarLead(
    lead({ rastreioPropostas: [{ sentAt: '2026-10-10T10:00:00Z', firstViewedAt: '2026-10-18T09:00:00Z', lastViewedAt: '2026-10-18T09:30:00Z', downloadCount: 1, lastDownloadedAt: '2026-10-18T09:31:00Z' }] }),
    HOJE
  );
  const m = aberta.motivos.find((x) => x.tipo === 'proposta');
  assert.equal(m.peso, PESOS.propostaAbertaRecente);
  assert.match(m.texto, /abriu a proposta há 1 dia e baixou o PDF/);
  const ignorada = pontuarLead(lead({ rastreioPropostas: [{ sentAt: '2026-10-10T10:00:00Z', firstViewedAt: null }] }), HOJE);
  assert.equal(ignorada.motivos.find((x) => x.tipo === 'proposta').peso, PESOS.propostaSemAbertura);
  const antiga = pontuarLead(lead({ rastreioPropostas: [{ sentAt: '2026-09-01T10:00:00Z', firstViewedAt: '2026-09-02T10:00:00Z', lastViewedAt: '2026-09-02T10:00:00Z' }] }), HOJE);
  assert.equal(antiga.motivos.find((x) => x.tipo === 'proposta'), undefined);
});

test('contato: lead nunca contatado e sem contato há muito tempo', () => {
  const novo = pontuarLead(lead({ estagio: 'Lead', ultimoContato: null, createdAt: '2026-10-19T08:00:00Z' }), HOJE);
  assert.equal(novo.motivos.find((m) => m.tipo === 'contato').peso, PESOS.nuncaContatadoLead);
  const slaVencido = pontuarLead(lead({ estagio: 'Lead', ultimoContato: null, createdAt: '2026-10-16T08:00:00Z' }), HOJE);
  assert.equal(slaVencido.motivos.find((m) => m.tipo === 'contato').peso, PESOS.nuncaContatadoLeadSlaVencido);
  assert.match(slaVencido.motivos.find((m) => m.tipo === 'contato').texto, /há 3 dias — SLA de 24h vencido/);
  // ...e entra na lista sozinho (sem precisar de compromisso):
  assert.equal(calcularPrioridades([lead({ estagio: 'Lead', ultimoContato: null, createdAt: '2026-10-16T08:00:00Z' })], HOJE).itens.length, 1);
  const nunca = pontuarLead(lead({ estagio: 'Qualificado', ultimoContato: null }), HOJE);
  assert.equal(nunca.motivos.find((m) => m.tipo === 'contato').peso, PESOS.nuncaContatadoOutros);
  const velho = pontuarLead(lead({ ultimoContato: '2026-09-20' }), HOJE);
  assert.match(velho.motivos.find((m) => m.tipo === 'contato').texto, /há 29 dias/);
});

test('todo ponto tem motivo: soma dos pesos = score', () => {
  const r = pontuarLead(
    lead({ estagio: 'Em Negociação', valorEstimado: '300000', proximoFollowUp: '2026-10-16', prazoCompra: '2026-11-05', ultimoContato: '2026-10-01', planoAcao: comAcao('Apresentar condições ao decisor', { compromissoCliente: true }) }),
    HOJE
  );
  const soma = r.motivos.reduce((s, m) => s + m.peso, 0);
  assert.ok(Math.abs(soma - r.score) < 0.11);
  assert.match(r.motivos[0].texto, /vencida há 3 dias — Apresentar condições ao decisor|Combinado/);
});

test('limiar: lead sem nada relevante fica de fora; com compromisso hoje sempre entra', () => {
  const calmo = lead({ name: 'Calmo' });
  const hoje = lead({ name: 'Hoje', proximoFollowUp: HOJE });
  const r = calcularPrioridades([calmo, hoje], HOJE);
  assert.deepEqual(r.itens.map((i) => i.item.name), ['Hoje']);
  assert.equal(r.totalAtivos, 2);
  assert.equal(r.totalComCompromisso, 1);
  assert.ok(pontuarLead(calmo, HOJE).score < SCORE_MINIMO);
});

test('ordem estável e determinística em empate', () => {
  const a = lead({ name: 'A', proximoFollowUp: HOJE });
  const b = lead({ name: 'B', proximoFollowUp: HOJE });
  const r1 = calcularPrioridades([b, a], HOJE).itens.map((i) => i.item.name);
  const r2 = calcularPrioridades([a, b], HOJE).itens.map((i) => i.item.name);
  assert.deepEqual(r1, ['A', 'B']);
  assert.deepEqual(r2, r1);
});

test('pontuar não muta o lead', () => {
  const l = lead({ valorEstimado: '1000', proximoFollowUp: '2026-10-01' });
  const antes = JSON.stringify(l);
  pontuarLead(l, HOJE);
  assert.equal(JSON.stringify(l), antes);
});
