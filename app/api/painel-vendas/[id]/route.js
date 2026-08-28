import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/admin-guard';
import { updateItemColumns, deleteItem } from '../../../../lib/monday';
import { PAINEL_VENDAS_BOARD_ID, PAINEL_VENDAS_COLUMNS } from '../../../../lib/config';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const guard = await requireAdmin(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const body = await request.json().catch(() => ({}));
    const { inicioSemana, fimSemana, negocios, apalavreamentos, evolucoes, surgidos, perdidas } = body;

    const columnValues = {};
    if (inicioSemana) columnValues[PAINEL_VENDAS_COLUMNS.inicioSemana] = { date: inicioSemana };
    if (fimSemana) columnValues[PAINEL_VENDAS_COLUMNS.fimSemana] = { date: fimSemana };
    if (negocios !== undefined) columnValues[PAINEL_VENDAS_COLUMNS.negociosJson] = JSON.stringify(negocios || []);
    if (apalavreamentos !== undefined) columnValues[PAINEL_VENDAS_COLUMNS.apalavreamentos] = apalavreamentos;
    if (evolucoes !== undefined) columnValues[PAINEL_VENDAS_COLUMNS.evolucoes] = evolucoes;
    if (surgidos !== undefined) columnValues[PAINEL_VENDAS_COLUMNS.surgidos] = surgidos;
    if (perdidas !== undefined) columnValues[PAINEL_VENDAS_COLUMNS.perdidas] = perdidas;

    if (Object.keys(columnValues).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo para atualizar.' }, { status: 400 });
    }

    await updateItemColumns(PAINEL_VENDAS_BOARD_ID, Number(params.id), columnValues);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const guard = await requireAdmin(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    await deleteItem(Number(params.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
