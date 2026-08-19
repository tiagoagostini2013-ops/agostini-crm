import { NextResponse } from 'next/server';
import { removeFileFromItem, addItemNote } from '../../../../../../lib/monday';
import { BOARD_ID, COLUMNS } from '../../../../../../lib/config';
import { SESSION_COOKIE, getSessionPayload } from '../../../../../../lib/auth';

export const dynamic = 'force-dynamic';

// Remove um arquivo anexado por engano. A API do monday.com não tem "apague
// só este arquivo": removeFileFromItem busca a lista atual direto do
// monday.com e escreve de volta sem o assetId removido (ver
// lib/monday.js — update_assets_on_item substitui a coluna inteira).
export async function DELETE(request, { params }) {
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = await getSessionPayload(token);
    if (!session) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }

    const itemId = Number(params.id);
    const arquivos = await removeFileFromItem(BOARD_ID, itemId, COLUMNS.propostas, params.assetId);

    await addItemNote(itemId, `🗑️ Um arquivo foi removido do CRM por ${session.name}.`).catch(() => {});

    return NextResponse.json({ ok: true, arquivos });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
