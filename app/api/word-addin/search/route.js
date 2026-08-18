import { NextResponse } from 'next/server';
import { fetchAllItems } from '../../../../lib/monday';
import { BOARD_ID, COLUMNS } from '../../../../lib/config';
import { flattenItem } from '../../../../lib/transform';

export const dynamic = 'force-dynamic';

const COLUMN_IDS = Object.values(COLUMNS);

// Busca leads pelo nome/empresa para o suplemento do Word (autenticado pelo
// mesmo cookie de sessão do painel — ver middleware.js). Reaproveita
// fetchAllItems (mesma função usada pelo Kanban) e filtra em memória, já que
// o board tem algumas centenas de itens — não vale a pena uma query GraphQL
// de busca separada só para isso.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    if (q.length < 2) {
      return NextResponse.json({ items: [] });
    }

    const items = await fetchAllItems(BOARD_ID, COLUMN_IDS);
    const flattened = items.map(flattenItem);

    const matches = flattened
      .filter((item) => {
        const haystack = `${item.name || ''} ${item.empresa || ''}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 20);

    return NextResponse.json({ items: matches });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
