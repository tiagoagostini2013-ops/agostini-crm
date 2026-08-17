import { NextResponse } from 'next/server';
import { updateItemColumns } from '../../../../lib/monday';
import { BOARD_ID } from '../../../../lib/config';
import { buildColumnValues } from '../../../../lib/transform';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  try {
    const fields = await request.json();
    const columnValues = buildColumnValues(fields);
    if (Object.keys(columnValues).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo para atualizar.' }, { status: 400 });
    }
    await updateItemColumns(BOARD_ID, Number(params.id), columnValues);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
