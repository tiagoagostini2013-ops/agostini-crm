import { NextResponse } from 'next/server';
import { fetchAllItems, createLead, fetchAssetsPublicUrls } from '../../../lib/monday';
import { BOARD_ID, COLUMNS } from '../../../lib/config';
import { flattenItem, buildColumnValues } from '../../../lib/transform';

export const dynamic = 'force-dynamic';

const COLUMN_IDS = Object.values(COLUMNS);

export async function GET() {
  try {
    const rawItems = await fetchAllItems(BOARD_ID, COLUMN_IDS);
    const items = rawItems.map(flattenItem);

    // A coluna "Propostas" só traz o fileId no value da coluna — busca as
    // URLs públicas de todos os arquivos de uma vez (evita 1 chamada por
    // lead) e completa cada item.
    const assetIds = items.flatMap((it) => it.propostas.filter((p) => p.isAsset).map((p) => p.fileId));
    if (assetIds.length > 0) {
      try {
        const assetMap = await fetchAssetsPublicUrls(assetIds);
        for (const it of items) {
          it.propostas = it.propostas.map((p) => ({ ...p, url: assetMap[p.fileId]?.url || null }));
        }
      } catch {
        // Se a busca de URLs falhar, ainda mostramos os nomes dos arquivos
        // (sem link clicável) em vez de derrubar a listagem inteira.
      }
    }

    return NextResponse.json({ items });
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
