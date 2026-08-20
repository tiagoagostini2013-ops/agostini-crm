// Fase 8 (Vendas × Produção) — Parte A: painel agregado de capacidade e
// atraso da produção, lendo direto dos boards PEDIDOS e PRODUÇÃO que a
// fábrica já mantém no monday.com (não foram criados por este projeto, são
// bem maiores e mais antigos que o CRM Agostini). Só leitura — nenhuma
// mutação é feita nesses boards por aqui.
//
// Não existe hoje nenhum vínculo formal entre um lead do CRM Agostini e um
// Pedido específico (isso é a Fase 8 Parte B, ainda não implementada), então
// este módulo só produz números agregados/estatísticos, não visão por lead.
import { fetchAllItems } from './monday';
import {
  PEDIDOS_BOARD_ID,
  PEDIDOS_COLUMNS,
  PEDIDOS_GROUP_FINALIZADOS,
  PRODUCAO_BOARD_ID,
  PRODUCAO_COLUMNS,
  PRODUCAO_GROUP_FINALIZADAS,
  PRODUCAO_GRUPOS_ORDEM,
} from './config';

function toNumber(text) {
  if (!text) return 0;
  const n = Number(String(text).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function toDateOnly(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function flattenPedido(item) {
  const c = item.columns || {};
  const get = (key) => (c[PEDIDOS_COLUMNS[key]] ? c[PEDIDOS_COLUMNS[key]].text : null) || null;
  return {
    id: item.id,
    cliente: item.name,
    grupoId: item.group ? item.group.id : null,
    numeroPedido: get('numeroPedido'),
    tipo: get('tipo') || 'Não informado',
    prazoEntrega: get('prazoEntrega'),
    total: toNumber(get('total')),
    receber: toNumber(get('receber')),
    atrasado: get('atrasado') === 'ATRASADO',
  };
}

function flattenOP(item) {
  const c = item.columns || {};
  const get = (key) => (c[PRODUCAO_COLUMNS[key]] ? c[PRODUCAO_COLUMNS[key]].text : null) || null;
  return {
    id: item.id,
    nome: item.name,
    grupoId: item.group ? item.group.id : null,
    cliente: get('cliente'),
    numeroPedido: get('numeroPedido'),
    prazoEntrega: get('prazoEntrega'),
    statusPed: get('statusPed'),
  };
}

// Painel agregado — pensado pra rodar dentro do Dashboard Gerencial
// (admin-only). Retorna só números e uma lista curta de destaques, nunca os
// 1700+ pedidos crus, pra manter a resposta leve e a tela focada no que
// importa pra um gestor (não é um substituto do monday.com pra navegar
// pedido por pedido).
export async function fetchProductionSummary() {
  const [pedidosRaw, producaoRaw] = await Promise.all([
    fetchAllItems(PEDIDOS_BOARD_ID, Object.values(PEDIDOS_COLUMNS)),
    fetchAllItems(PRODUCAO_BOARD_ID, Object.values(PRODUCAO_COLUMNS)),
  ]);

  const pedidosAbertos = pedidosRaw.filter((it) => it.group?.id !== PEDIDOS_GROUP_FINALIZADOS).map(flattenPedido);
  const producaoAberta = producaoRaw.filter((it) => it.group?.id !== PRODUCAO_GROUP_FINALIZADAS).map(flattenOP);

  const atrasados = pedidosAbertos.filter((p) => p.atrasado);
  const valorTotalAberto = pedidosAbertos.reduce((acc, p) => acc + p.total, 0);
  const valorAReceber = pedidosAbertos.reduce((acc, p) => acc + p.receber, 0);

  const porTipoMap = {};
  pedidosAbertos.forEach((p) => {
    if (!porTipoMap[p.tipo]) porTipoMap[p.tipo] = { tipo: p.tipo, qtd: 0, valor: 0 };
    porTipoMap[p.tipo].qtd += 1;
    porTipoMap[p.tipo].valor += p.total;
  });
  const porTipo = Object.values(porTipoMap).sort((a, b) => b.qtd - a.qtd);

  const hoje = toDateOnly(new Date().toISOString().slice(0, 10));
  const listaAtrasados = atrasados
    .map((p) => {
      const prazo = toDateOnly(p.prazoEntrega);
      const diasAtraso = prazo ? Math.round((hoje - prazo) / (1000 * 60 * 60 * 24)) : null;
      return { ...p, diasAtraso };
    })
    .sort((a, b) => (b.diasAtraso || 0) - (a.diasAtraso || 0))
    .slice(0, 15);

  const porEstagioMap = {};
  producaoAberta.forEach((op) => {
    const grupo = PRODUCAO_GRUPOS_ORDEM.find((g) => g.id === op.grupoId);
    const titulo = grupo ? grupo.titulo : 'Outro';
    porEstagioMap[titulo] = (porEstagioMap[titulo] || 0) + 1;
  });
  const porEstagio = PRODUCAO_GRUPOS_ORDEM.map((g) => ({ titulo: g.titulo, qtd: porEstagioMap[g.titulo] || 0 })).filter(
    (g) => g.qtd > 0
  );

  const producaoAtrasadas = producaoAberta.filter((op) => {
    const prazo = toDateOnly(op.prazoEntrega);
    return prazo && prazo < hoje;
  }).length;

  return {
    pedidos: {
      totalAberto: pedidosAbertos.length,
      atrasados: atrasados.length,
      valorTotalAberto,
      valorAReceber,
      porTipo,
      listaAtrasados,
    },
    producao: {
      totalAberto: producaoAberta.length,
      atrasadas: producaoAtrasadas,
      porEstagio,
    },
  };
}
