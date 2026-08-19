import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { uploadFileToItem, addItemNote, fetchItemFileColumnRaw } from '../../../../../lib/monday';
import { COLUMNS } from '../../../../../lib/config';
import { SESSION_COOKIE, getSessionPayload } from '../../../../../lib/auth';
import { mapFileColumnFiles } from '../../../../../lib/transform';
import { fetchBlobContent } from '../../../../../lib/blobServer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // folga pra baixar o arquivo do Blob e subir pro monday.com

// Recebe a URL de um arquivo que o painel acabou de subir no Vercel Blob
// (ver /api/files/blob-upload — o arquivo em si não passa por aqui, só a
// URL, pelo mesmo motivo do suplemento do Word: funções da Vercel recusam
// corpo de requisição acima de 4.5MB). Baixa o conteúdo aqui no servidor e
// anexa na coluna de arquivos do lead — proposta, orçamento de frete, layout
// do cliente, o que for.
export async function POST(request, { params }) {
  let blobUrl;
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = await getSessionPayload(token);
    if (!session) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }

    const itemId = Number(params.id);
    const body = await request.json().catch(() => ({}));
    const { fileName } = body;
    blobUrl = body.blobUrl;
    if (!itemId || !blobUrl || !fileName) {
      return NextResponse.json({ error: 'itemId, blobUrl e fileName são obrigatórios.' }, { status: 400 });
    }

    const blobRes = await fetchBlobContent(blobUrl);
    const buffer = Buffer.from(await blobRes.arrayBuffer());
    const safeName = String(fileName).replace(/[\\/]/g, '-');
    const mimeType = blobRes.headers.get('content-type') || 'application/octet-stream';

    await uploadFileToItem(itemId, COLUMNS.propostas, buffer, safeName, mimeType);

    await addItemNote(itemId, `📎 Arquivo "${safeName}" anexado por ${session.name}.`).catch(() => {
      // Anexo já foi feito com sucesso — se só a anotação falhar, não é
      // motivo para reportar erro ao vendedor.
    });

    // Reconsulta a coluna pra devolver a lista já atualizada (com o novo
    // assetId) — assim o painel atualiza a tela sem precisar recarregar tudo.
    const raw = await fetchItemFileColumnRaw(itemId, COLUMNS.propostas);
    const arquivos = mapFileColumnFiles(raw);

    return NextResponse.json({ ok: true, arquivos });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    // O blob é só um ponto de passagem (o arquivo definitivo fica no
    // monday.com) — apaga em seguida pra não acumular armazenamento à toa.
    if (blobUrl) {
      await del(blobUrl).catch(() => {});
    }
  }
}
