import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../lib/admin-guard';
import { fetchAllItems, createLead } from '../../../lib/monday';
import { PAINEL_VENDAS_BOARD_ID, PAINEL_VENDAS_COLUMNS } from '../../../lib/config';

export const dynamic = 'force-dynamic';

// Painel de Vendas semanal (pedido do Tiago em 28/08/2026) — ver nota em
// lib/config.js. Só admins acessam (mesma regra da aba Gerencial): é um
// registro de gestão, não uma ferramenta do dia a dia do time comercial.

function get(columns, key) {
  const col = columns[PAINEL_VENDAS_COLUMNS[key]];
  return col ? col.text : null;
}

function parseSemana(item) {
  const c = item.columns || {};
  let negocios = [];
  const negociosText = get(c, 'negociosJson');
  if (negociosText) {
    try {
      const parsed = JSON.parse(negociosText);
      if (Array.isArray(parsed)) negocios = parsed;
    } catch {
      negocios = [];
    }
  }
  return {
    id: item.id,
    inicioSemana: get(c, 'inicioSemana'),
    fimSemana: get(c, 'fimSemana'),
    negocios,
    apalavreamentos: get(c, 'apalavreamentos') || '',
    evolucoes: get(c, 'evolucoes') || '',
    surgidos: get(c, 'surgidos') || '',
    perdidas: get(c, 'perdidas') || '',
  };
}

export async function GET(request) {
  const guard = await requireAdmin(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const items = await fetchAllItems(PAINEL_VENDAS_BOARD_ID, Object.values(PAINEL_VENDAS_COLUMNS));
    const semanas = items
      .map(parseSemana)
      // Mais recente primeiro — por início da semana; sem data, cai pro fim.
      .sort((a, b) => (b.inicioSemana || '').localeCompare(a.inicioSemana || ''));
    return NextResponse.json({ semanas });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const guard = await requireAdmin(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const body = await request.json().catch(() => ({}));
    const { inicioSemana, fimSemana, negocios, apalavreamentos, evolucoes, surgidos, perdidas } = body;
    if (!inicioSemana || !fimSemana) {
      return NextResponse.json({ error: 'Informe início e fim da semana.' }, { status: 400 });
    }

    const columnValues = {
      [PAINEL_VENDAS_COLUMNS.inicioSemana]: { date: inicioSemana },
      [PAINEL_VENDAS_COLUMNS.fimSemana]: { date: fimSemana },
      [PAINEL_VENDAS_COLUMNS.negociosJson]: JSON.stringify(Array.isArray(negocios) ? negocios : []),
      [PAINEL_VENDAS_COLUMNS.apalavreamentos]: apalavreamentos || '',
      [PAINEL_VENDAS_COLUMNS.evolucoes]: evolucoes || '',
      [PAINEL_VENDAS_COLUMNS.surgidos]: surgidos || '',
      [PAINEL_VENDAS_COLUMNS.perdidas]: perdidas || '',
    };

    const itemName = `Semana ${inicioSemana} a ${fimSemana}`;
    const created = await createLead(PAINEL_VENDAS_BOARD_ID, null, itemName, columnValues);
    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
