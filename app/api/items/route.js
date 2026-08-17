import { NextResponse } from 'next/server';
import { fetchAllItems, createLead } from '../../../lib/monday';
import { BOARD_ID, COLUMNS } from '../../../lib/config';
import { flattenItem, buildColumnValues } from '../../../lib/transform';

export const dynamic = 'force-dynamic';

const COLUMN_IDS = Object.values(COLUMNS);

export async function GET() {
  try {
    const items = await fetchAllItems(BOARD_ID, COLUMN_IDS);
    return NextResponse.json({ items: items.map(flattenItem) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Cria um novo lead manualmente pela página (ex: contato que chegou por
// telefone e não passou pela extensão do Chrome).
export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 });
    }
    const columnValues = buildColumnValues({ estagio: 'Lead', ...body.fields });
    const created = await createLead(BOARD_ID, null, body.name.trim(), columnValues);
    return NextResponse.json({ item: created });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
