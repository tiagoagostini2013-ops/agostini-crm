// Automação do acompanhamento (v3) — regras A–F em modo sugestão. DADOS FICTÍCIOS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listarSugestoes, avaliarItem, normalizarConfig, validarAceite, registrarDecisao, aplicarAceite,
  visaoSemanal, origemDaAcao, CONFIG_PADRAO,
} from '../lib/automacao.js';
import { parsePlanoAcao, serializarPlanoAcao, getAcao } from '../lib/agenda.js';
import { aplicarOperacao, registroVazio, parseRegistro, serializarRegistro } from '../lib/propostas.js';

const CFG = normalizarConfig({});
const plano = (o = {}) => ({ ...parsePlanoAcao(null), ...o });
const acao = (o = {}) => ({ acao: 'Ligar', responsavelId: '1', compromissoCliente: false, rev: 1, atualizadoEm: null, atualizadoPor: null, ...o });

let seq = 0;
function lead(o = {}) {
  seq += 1;
  return {
    id: String(100 + seq), name: `Cliente Fictício ${seq}`, empresa: `Empresa Fictícia ${seq}`, estagio: 'Proposta Enviada',
    createdAt: '2026-08-01T10:00:00Z', responsavelIds: ['1'], vendedorPosVenda: null,
    ultimoContato: null, proximoFollowUp: null, dataReativacao: null, proximoContatoPosVenda: null, prazoCompra: null,
    principalImpedimento: null, dataFechamento: null, dataPropostaEnviada: null,
    planoAcao: plano(), propostasRegistro: registroVazio(),
    ...o,
  };
}
function comEnvio(envioEm, extra = {}) {
  const r = aplicarOperacao(registroVazio(), { acao: 'registrar', numero: '2026-045', revisao: 'A', situacao: 'enviada', envioEm, arquivos: [] }, { hoje: '2026-12-31', gerarId: () => 'pX1', agora: 'x' }).registro;
  return lead({ propostasRegistro: r, ...extra });
}
const sug = (it, cfg = CFG, hoje = '2026-10-19') => listarSugestoes([it], cfg, { hoje });

// 1. Proposta enviada na sexta → segunda, considerando feriados configurados
test('A: envio na sexta sugere segunda às 09:00; feriado configurado empurra para terça', () => {
  const it = comEnvio('2026-10-16'); // sexta
  const r = sug(it, CFG, '2026-10-17');
  assert.equal(r.recentes.length, 1);
  const s = r.recentes[0];
  assert.equal(s.regra, 'A');
  assert.equal(s.acaoProposta.data, '2026-10-19');
  assert.equal(s.acaoProposta.hora, '09:00');
  assert.equal(s.origemRotulo, 'Sugerida por regra');
  assert.equal(s.evento.data, '2026-10-16'); // data do evento ≠ data programada
  assert.notEqual(s.evento.data, s.dataProgramada);
  // Segunda 07/12/2026 feriado municipal configurado → terça 08/12
  const it2 = comEnvio('2026-12-04');
  const cfg2 = normalizarConfig({ feriadosExtras: ['2026-12-07'] });
  assert.equal(sug(it2, cfg2, '2026-12-05').recentes[0].acaoProposta.data, '2026-12-08');
  assert.equal(sug(it2, CFG, '2026-12-05').recentes[0].acaoProposta.data, '2026-12-07');
  // Feriado nacional na sexta (20/11): envio na quinta 19/11 → segunda 23/11
  assert.equal(sug(comEnvio('2026-11-19'), CFG, '2026-11-19').recentes[0].acaoProposta.data, '2026-11-23');
});

// 2. Upload / PDF / visualização NÃO geram follow-up
test('A: arquivo anexado, rastreio (PDF gerado) e visualização não são envio', () => {
  // proposta registrada como rascunho com arquivo; rastreio mostra "enviado" (PDF gerado); sem registro explícito
  const r = aplicarOperacao(registroVazio(), { acao: 'registrar', numero: '9', situacao: 'rascunho', arquivos: [] }, { hoje: '2026-10-19', gerarId: () => 'pR' }).registro;
  const it = lead({ propostasRegistro: r, rastreioPropostas: [{ assetId: '1', sentAt: '2026-10-16T12:00:00Z', viewCount: 3 }], dataPropostaEnviada: '2026-10-16' });
  const out = sug(it);
  assert.equal(out.recentes.filter((s) => s.regra === 'A').length, 0);
  assert.ok(out.suprimidas.some((x) => x.regra === 'A' && /envio registrado explicitamente/.test(x.motivo)));
  // situação "enviada" legada, SEM data de envio explícita, também não dispara
  const leg = aplicarOperacao(registroVazio(), { acao: 'registrar', numero: '8', situacao: 'enviada', arquivos: [] }, { hoje: '2026-10-19', gerarId: () => 'pL' }).registro;
  assert.equal(leg.docs[0].envioEm, null);
  assert.equal(sug(lead({ propostasRegistro: leg })).recentes.filter((s) => s.regra === 'A').length, 0);
});

// 3. Evento repetido não duplica; chave estável
test('A: reprocessar/evento repetido gera a mesma chave (sem duplicata)', () => {
  const it = comEnvio('2026-10-16');
  const a = sug(it).recentes;
  const b = sug(it).recentes;
  assert.equal(a.length, 1);
  assert.equal(a[0].chave, b[0].chave);
  // registrar envio de novo na mesma data é no-op no registro
  const reg = it.propostasRegistro;
  const r2 = aplicarOperacao(reg, { acao: 'enviar', id: reg.docs[0].id, data: '2026-10-16' }, { hoje: '2026-10-19', expectedRev: reg.rev });
  assert.equal(r2.semAlteracao, true);
  // duas listas juntas do mesmo lead → ainda uma sugestão
  assert.equal(listarSugestoes([it, it], CFG, { hoje: '2026-10-19' }).recentes.length, 2); // chamador não deve duplicar leads; a chave é a mesma:
  const chaves = listarSugestoes([it, it], CFG, { hoje: '2026-10-19' }).recentes.map((s) => s.chave);
  assert.equal(new Set(chaves).size, 1);
});

// 4. Ação existente evita tarefa redundante; compromisso intacto
test('A/B: ação já agendada (ou combinada com o cliente) não gera outra', () => {
  const it = comEnvio('2026-10-16', { proximoFollowUp: '2026-10-22', planoAcao: plano({ vendas: acao() }) });
  const r = sug(it);
  assert.equal(r.recentes.filter((s) => s.tipo === 'acao').length, 0);
  assert.ok(r.suprimidas.some((x) => /já existe ação agendada/i.test(x.motivo)));
  const comp = comEnvio('2026-10-16', { proximoFollowUp: '2026-10-28', planoAcao: plano({ vendas: acao({ compromissoCliente: true, acao: 'Visita combinada' }) }) });
  const r2 = sug(comp);
  assert.equal(r2.recentes.filter((s) => s.tipo === 'acao').length, 0);
  assert.ok(r2.suprimidas.some((x) => /combinada com o cliente/.test(x.motivo)));
  // o plano continua exatamente como estava
  assert.equal(getAcao(comp, 'vendas').acao, 'Visita combinada');
  assert.equal(comp.proximoFollowUp, '2026-10-28');
});

// 5. Tentativa sem resposta: +7 dias corridos, ajuste p/ dia útil, não é contato efetivo
test('B: nova tentativa em 7 dias corridos; feriado/fim de semana vai para o próximo dia útil', () => {
  const ur = (data) => ({ data, trilha: 'vendas', contatoRealizado: false, canal: 'Ligação', resumo: 'Não atendeu', autor: 'Ana' });
  const it = lead({ planoAcao: plano({ ultimoResultado: ur('2026-10-15') }), ultimoContato: '2026-10-01' });
  const s = sug(it, CFG, '2026-10-16').recentes[0];
  assert.equal(s.regra, 'B');
  assert.equal(s.acaoProposta.data, '2026-10-22');
  assert.equal(s.acaoProposta.hora, null);
  // segunda 05/10 + 7 = segunda 12/10 (feriado nacional) → terça 13/10
  assert.equal(sug(lead({ planoAcao: plano({ ultimoResultado: ur('2026-10-05') }) }), CFG, '2026-10-06').recentes[0].acaoProposta.data, '2026-10-13');
  // sábado 10/10 + 7 = sábado 17/10 → segunda 19/10
  assert.equal(sug(lead({ planoAcao: plano({ ultimoResultado: ur('2026-10-10') }) }), CFG, '2026-10-12').recentes[0].acaoProposta.data, '2026-10-19');
  // tentativa não é contato efetivo: o último contato do lead segue o mesmo (a regra nunca o altera)
  assert.equal(it.ultimoContato, '2026-10-01');
  assert.match(s.justificativa, /não conta como contato efetivo/);
  // contato efetivo posterior encerra a sugestão
  assert.equal(sug(lead({ planoAcao: plano({ ultimoResultado: ur('2026-10-15') }), ultimoContato: '2026-10-16' }), CFG, '2026-10-17').recentes.filter((x) => x.regra === 'B').length, 0);
  // registro interno não é tentativa
  const interno = lead({ planoAcao: plano({ ultimoResultado: { ...ur('2026-10-15'), canal: 'Interno (sem contato com o cliente)' } }) });
  assert.equal(sug(interno).recentes.filter((x) => x.regra === 'B').length, 0);
});

// 6. Dispensada não reaparece; novo evento gera nova sugestão
test('dispensada não reaparece sem novo motivo; novo evento (novo envio) gera nova sugestão', () => {
  const it = comEnvio('2026-10-16');
  const s = sug(it).recentes[0];
  const d = registrarDecisao(it.planoAcao, s.chave, 'd', '2026-10-19');
  const it2 = { ...it, planoAcao: d.plano };
  assert.equal(sug(it2).recentes.filter((x) => x.regra === 'A').length, 0);
  // persiste ao serializar/recarregar
  const recarregado = { ...it, planoAcao: parsePlanoAcao(d.texto) };
  assert.equal(sug(recarregado).recentes.filter((x) => x.regra === 'A').length, 0);
  // novo envio (outra data) = novo evento = nova chave
  const reg = it.propostasRegistro;
  const novo = aplicarOperacao(reg, { acao: 'enviar', id: reg.docs[0].id, data: '2026-10-19' }, { hoje: '2026-10-19', expectedRev: reg.rev }).registro;
  const r = sug({ ...recarregado, propostasRegistro: novo }, CFG, '2026-10-19').recentes[0];
  assert.ok(r);
  assert.notEqual(r.chave, s.chave);
});

// 7. Aceite grava a ação com origem; aceitar não é realizar; não reaparece depois de concluída
test('aceitar cria a ação (origem "sugestão aceita"); depois de concluir a ação a mesma sugestão não volta', () => {
  const it = comEnvio('2026-10-16');
  const s = sug(it, CFG, '2026-10-17').recentes[0];
  const v = validarAceite({ item: it, sugestao: s, impressaoVista: s.fp, cfg: CFG, hoje: '2026-10-17' });
  assert.ok(v.ok, JSON.stringify(v));
  const ap = aplicarAceite(it.planoAcao, s, v, { autor: 'Ana', agora: '2026-10-17T12:00:00Z', expectedRev: 0, hoje: '2026-10-17' });
  const p = parsePlanoAcao(ap.texto);
  assert.equal(p.vendas.acao, s.acaoProposta.acao);
  assert.equal(p.vendas.hora, '09:00');
  assert.equal(p.vendas.origem, 'sugestao');
  assert.equal(origemDaAcao(p.vendas).rotulo, 'Criada a partir de sugestão aceita');
  assert.equal(p.sg[0][1], 'a');
  // ação foi realizada (plano limpo) mas a decisão fica registrada → sem nova sugestão
  const depois = { ...it, planoAcao: { ...p, vendas: null } };
  assert.equal(sug(depois, CFG, '2026-10-20').recentes.filter((x) => x.regra === 'A').length, 0);
  // aceitar uma segunda vez é recusado pela reavaliação (suprimida: já aceita / ação agendada)
  const duplo = { ...it, planoAcao: p, proximoFollowUp: v.data };
  assert.equal(sug(duplo, CFG, '2026-10-17').recentes.filter((x) => x.tipo === 'acao').length, 0);
});

// 8. Sugestão obsoleta não sobrescreve ação mais recente; compromisso exige confirmação
test('aceite recusado se outra ação foi criada depois; substituição e compromisso exigem confirmação', () => {
  const it = comEnvio('2026-10-16');
  const s = sug(it, CFG, '2026-10-17').recentes[0];
  // Outra pessoa criou uma ação (rev 1) depois da geração
  const alterado = { ...it, proximoFollowUp: '2026-10-21', planoAcao: plano({ vendas: acao({ rev: 1 }) }) };
  const v = validarAceite({ item: alterado, sugestao: sug(alterado, CFG, '2026-10-17').recentes[0], impressaoVista: s.fp, cfg: CFG, hoje: '2026-10-17' });
  // com ação agendada a sugestão nem existe mais → obsoleta
  assert.equal(v.codigo, 'obsoleta');
  // Ação vencida (sem confirmação): pede confirmação para substituir
  const venc = comEnvio('2026-10-10', { proximoFollowUp: '2026-10-12', planoAcao: plano({ vendas: acao({ acao: 'Ligar antigo' }) }) });
  const sv = sug(venc, CFG, '2026-10-17').recentes[0];
  assert.ok(sv.substitui);
  assert.equal(validarAceite({ item: venc, sugestao: sv, impressaoVista: sv.fp, cfg: CFG, hoje: '2026-10-17' }).codigo, 'substituir');
  assert.ok(validarAceite({ item: venc, sugestao: sv, impressaoVista: sv.fp, confirma: { substituir: true }, cfg: CFG, hoje: '2026-10-17' }).ok);
  // Impressão digital diferente → "estagnada"
  const e = validarAceite({ item: venc, sugestao: sv, impressaoVista: 'outra', confirma: { substituir: true }, cfg: CFG, hoje: '2026-10-17' });
  assert.equal(e.codigo, 'estagnada');
  // Data fora de dia útil exige confirmação
  const nd = validarAceite({ item: it, sugestao: s, impressaoVista: s.fp, ajuste: { data: '2026-10-24' }, cfg: CFG, hoje: '2026-10-17' });
  assert.equal(nd.codigo, 'dia_nao_util');
  assert.equal(nd.sugestaoData, '2026-10-26');
});

// 9. Perdida deixa de receber sugestões de prospecção
test('perdida: nenhuma sugestão de prospecção (nem destaque); nada é apagado', () => {
  const it = comEnvio('2026-10-16', { estagio: 'Perdido', proximoFollowUp: '2026-10-10', prazoCompra: '2026-10-25' });
  const r = sug(it);
  assert.equal(r.recentes.length + r.antigas.length, 0);
  assert.equal(it.proximoFollowUp, '2026-10-10');
});

// 10. Fechada gera pendência de passagem sem marcar entrega
test('F: venda fechada sugere passagem para pós-venda; não mexe em estágio de pós-venda nem entrega', () => {
  const it = lead({ estagio: 'Fechado', dataFechamento: '2026-10-15', estagioPosVenda: null });
  const r = sug(it, CFG, '2026-10-19');
  assert.equal(r.recentes.length, 1);
  const s = r.recentes[0];
  assert.equal(s.regra, 'F');
  assert.equal(s.trilha, 'posVenda');
  assert.match(s.justificativa, /não significa "entregue"/);
  assert.equal(s.semResponsavelPosVenda, true);
  assert.equal(it.estagioPosVenda, null);
  assert.equal(it.dataEntregaEfetiva, undefined);
  // já existe ação de pós-venda → fluxo atual preservado
  const j = lead({ estagio: 'Fechado', dataFechamento: '2026-10-15', planoAcao: plano({ posVenda: acao({ acao: 'Agendar entrega' }) }) });
  assert.equal(sug(j).recentes.length, 0);
  // não há sugestões de prospecção para fechada
  assert.equal(r.recentes.filter((x) => ['A', 'B', 'D', 'E'].includes(x.regra)).length, 0);
  // fechada antiga vai para a análise prévia (sem ação em massa automática)
  const velha = lead({ estagio: 'Fechado', dataFechamento: '2026-03-01' });
  const rv = sug(velha);
  assert.equal(rv.recentes.length, 0);
  assert.equal(rv.antigas.length, 1);
});

// 11. D — oportunidade parada
test('D: sem próxima ação ou sem contato efetivo; retorno futuro combinado não é atraso; ação vencida não duplica a agenda', () => {
  const semAcao = lead({ createdAt: '2026-09-01T10:00:00Z', ultimoContato: '2026-10-10' });
  const d = sug(semAcao).recentes.find((x) => x.regra === 'D');
  assert.equal(d.motivoD, 'sem_proxima_acao');
  assert.equal(d.acaoProposta, null);
  // retorno futuro combinado com o cliente → nada
  const comb = lead({ ultimoContato: '2026-08-20', proximoFollowUp: '2026-11-10', planoAcao: plano({ vendas: acao({ compromissoCliente: true }) }) });
  assert.equal(sug(comb).recentes.length + sug(comb).antigas.length, 0);
  // ação planejada (não combinada) futura, mas sem contato efetivo há 10 dias (limite 7) → sem_contato
  const par = lead({ ultimoContato: '2026-10-09', proximoFollowUp: '2026-10-30', planoAcao: plano({ vendas: acao() }) });
  const dp = sug(par).recentes.find((x) => x.regra === 'D');
  assert.equal(dp.motivoD, 'sem_contato');
  assert.equal(dp.detalhes.diasSemContato, 10);
  // limite configurável: 15 dias → não destaca
  assert.equal(sug(par, normalizarConfig({ diasParada: 15 })).recentes.length, 0);
  // ação vencida já aparece como atrasada: sem destaque duplicado
  const venc = lead({ ultimoContato: '2026-10-01', proximoFollowUp: '2026-10-10', planoAcao: plano({ vendas: acao() }) });
  assert.equal(sug(venc).recentes.filter((x) => x.regra === 'D').length, 0);
  // uma única pendência por oportunidade e chave estável (sem alerta diário repetido)
  const dia1 = sug(semAcao, CFG, '2026-10-19').recentes.filter((x) => x.regra === 'D');
  const dia2 = sug(semAcao, CFG, '2026-10-20').recentes.filter((x) => x.regra === 'D');
  assert.equal(dia1.length, 1);
  assert.equal(dia1[0].chave, dia2[0].chave);
  // dispensada → só volta com novo contato efetivo (nova referência → nova chave)
  const disp = { ...semAcao, planoAcao: registrarDecisao(semAcao.planoAcao, dia1[0].chave, 'd', '2026-10-19').plano };
  assert.equal(sug(disp, CFG, '2026-10-26').recentes.filter((x) => x.regra === 'D').length, 0);
  const novoContato = { ...disp, ultimoContato: '2026-10-27' };
  assert.equal(sug(novoContato, CFG, '2026-10-28').recentes.filter((x) => x.regra === 'D').length, 1);
  // lead recém-criado com ação futura: não é "parado"
  const novo = lead({ createdAt: '2026-10-17T10:00:00Z', proximoFollowUp: '2026-10-30', planoAcao: plano({ vendas: acao() }) });
  assert.equal(sug(novo).recentes.length, 0);
  // D não move estágio nem declara perda: o lead segue idêntico
  assert.equal(semAcao.estagio, 'Proposta Enviada');
});

// 12. E — prazo de compra
test('E: prazo em 30 dias mostra impedimento e próxima ação; sem passo pede definição; não substitui follow-up', () => {
  const it = lead({ prazoCompra: '2026-11-10', principalImpedimento: 'Aprovação do financiamento', proximoFollowUp: '2026-10-25', planoAcao: plano({ vendas: acao({ acao: 'Visitar planta' }) }), ultimoContato: '2026-10-17' });
  const e = sug(it).recentes.find((x) => x.regra === 'E');
  assert.ok(e);
  assert.match(e.justificativa, /Aprovação do financiamento/);
  assert.match(e.justificativa, /Visitar planta/);
  assert.equal(e.semProximoPasso, false);
  assert.equal(e.acaoProposta, null);
  const sem = lead({ prazoCompra: '2026-11-10', ultimoContato: '2026-10-17' });
  const e2 = sug(sem).recentes.find((x) => x.regra === 'E');
  assert.equal(e2.semProximoPasso, true);
  assert.match(e2.justificativa, /não substitui a data de follow-up/);
  // fora da janela de 30 dias
  assert.equal(sug(lead({ prazoCompra: '2026-12-20', ultimoContato: '2026-10-17', planoAcao: plano({ vendas: acao() }), proximoFollowUp: '2026-10-30' })).recentes.filter((x) => x.regra === 'E').length, 0);
});

// Config / interruptores
test('regras podem ser desativadas individualmente e no total', () => {
  const it = comEnvio('2026-10-16');
  assert.equal(sug(it, normalizarConfig({ regras: { A: false } })).recentes.filter((x) => x.regra === 'A').length, 0);
  assert.equal(sug(it, normalizarConfig({ ativo: false })).recentes.length, 0);
  assert.equal(normalizarConfig({ diasParada: 'x', horaFollowUp: '25:99' }).diasParada, CONFIG_PADRAO.diasParada);
  assert.equal(normalizarConfig({ horaFollowUp: '25:99' }).horaFollowUp, '09:00');
});

// Retroativo
test('eventos antigos vão para a análise prévia, não para a lista principal', () => {
  const it = comEnvio('2026-07-01');
  const r = sug(it);
  assert.equal(r.recentes.length, 0);
  assert.equal(r.antigas.length, 1);
  assert.equal(r.antigas[0].antiga, true);
  // a data sugerida nunca fica no passado
  assert.ok(r.antigas[0].acaoProposta.data >= '2026-10-19');
});

// Aviso C
test('compromisso combinado em dia não útil gera aviso e a data é preservada', () => {
  const it = lead({ proximoFollowUp: '2026-10-24', planoAcao: plano({ vendas: acao({ compromissoCliente: true }) }), ultimoContato: '2026-10-18' });
  const out = avaliarItem(it, CFG, { hoje: '2026-10-19' });
  assert.equal(out.avisos.length, 1);
  assert.equal(out.avisos[0].regra, 'C');
  assert.equal(it.proximoFollowUp, '2026-10-24');
});

// Limite de armazenamento do plano
test('lista de decisões respeita o limite e o JSON do plano cabe na coluna', () => {
  let p = plano({ vendas: acao({ acao: 'x'.repeat(140) }), posVenda: acao({ acao: 'y'.repeat(140) }), reativacao: acao({ acao: 'z'.repeat(140) }) });
  for (let i = 0; i < 25; i++) p = registrarDecisao(p, `A.p${i}.2026-10-1${i % 10}`, 'd', '2026-10-19').plano;
  assert.ok(p.sg.length <= 10);
  assert.ok(serializarPlanoAcao(p).length <= 1900);
});

// Visão do gestor
test('visão semanal: critérios, filtro por responsável, sem afirmar "ausência de atendimento"', () => {
  const a = lead({ id: '1', responsavelIds: ['1'], proximoFollowUp: null }); // sem ação
  const b = lead({ id: '2', responsavelIds: ['2'], proximoFollowUp: '2026-10-10', planoAcao: plano({ vendas: acao({ compromissoCliente: true, responsavelId: '2' }) }), prazoCompra: '2026-11-05', principalImpedimento: 'Crédito' });
  const c = lead({ id: '3', responsavelIds: ['1'], estagio: 'Proposta Enviada', dataPropostaEnviada: '2026-10-01', prazoCompra: '2026-12-01' });
  const f = lead({ id: '4', responsavelIds: ['2'], estagio: 'Fechado', dataFechamento: '2026-10-05' });
  const todos = visaoSemanal([a, b, c, f], CFG, { hoje: '2026-10-19' });
  assert.equal(todos.compromissosVencidos.length, 1);
  assert.equal(todos.compras30.length, 1);
  assert.equal(todos.compras60.length, 1);
  assert.equal(todos.passagemPosVenda.length, 1);
  assert.ok(todos.propostasSemAvanco.some((x) => x.itemId === c.id));
  assert.ok(todos.semProximaAcao.length >= 2);
  const so1 = visaoSemanal([a, b, c, f], CFG, { hoje: '2026-10-19', responsavelId: '1' });
  assert.equal(so1.compromissosVencidos.length, 0);
  assert.equal(so1.passagemPosVenda.length, 0);
  assert.match(todos.criterios.propostasSemAvanco, /não prova que não houve atendimento/);
});

// Registro de envio: validações
test('envio: não aceita data futura; só proposta não substituída/aceita; revisão nova começa sem envio', () => {
  let r = aplicarOperacao(registroVazio(), { acao: 'registrar', numero: '1', situacao: 'rascunho', arquivos: [] }, { hoje: '2026-10-19', gerarId: () => 'pA' }).registro;
  assert.match(aplicarOperacao(r, { acao: 'enviar', id: 'pA', data: '2026-10-25' }, { hoje: '2026-10-19', expectedRev: r.rev }).erro, /futuro/);
  const ok = aplicarOperacao(r, { acao: 'enviar', id: 'pA', data: '2026-10-19' }, { hoje: '2026-10-19', expectedRev: r.rev });
  assert.equal(ok.registro.docs[0].situacao, 'enviada');
  assert.equal(ok.registro.docs[0].envioEm, '2026-10-19');
  const volta = parseRegistro(ok.texto);
  assert.equal(volta.docs[0].envioEm, '2026-10-19'); // persiste ao recarregar
  const rev = aplicarOperacao(ok.registro, { acao: 'nova_revisao', baseId: 'pA', revisao: 'B', arquivos: [] }, { hoje: '2026-10-19', gerarId: () => 'pB', expectedRev: ok.registro.rev });
  assert.equal(rev.registro.docs[1].envioEm, null);
  assert.equal(rev.registro.docs[1].situacao, 'rascunho');
});
