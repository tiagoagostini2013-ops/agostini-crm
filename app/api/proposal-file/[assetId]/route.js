import { NextResponse } from 'next/server';
import { getSessionPayload } from '../../../../lib/auth';
import { fetchAssetsPublicUrls } from '../../../../lib/monday';

export const dynamic = 'force-dynamic';

// Rota pública de propósito (ver middleware.js) — protegida por token
// assinado de curta duração, não por cookie de sessão, porque quem busca o
// conteúdo pode ser o servidor da Microsoft (Office Online Viewer) abrindo
// um .docx/.xlsx, não o navegador do vendedor.
//
// Também resolve dois problemas da public_url crua do monday.com:
// 1) ela expira em 1h — aqui sempre buscamos uma nova na hora H;
// 2) ela vem com "Content-Disposition: attachment", que faz o navegador
//    tentar baixar o arquivo em vez de exibir dentro do <iframe> da prévia —
//    aqui devolvemos com "inline".
export async function GET(request, { params }) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const payload = await getSessionPayload(token);

  if (!payload || payload.purpose !== 'proposal-view' || String(payload.assetId) !== String(params.assetId)) {
    return NextResponse.json({ error: 'Link inválido ou expirado. Feche e reabra a proposta.' }, { status: 401 });
  }

  let asset;
  try {
    const assetMap = await fetchAssetsPublicUrls([params.assetId]);
    asset = assetMap[String(params.assetId)];
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (!asset || !asset.url) {
    return NextResponse.json({ error: 'Arquivo não encontrado no monday.com.' }, { status: 404 });
  }

  const upstream = await fetch(asset.url);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Não foi possível baixar o arquivo original do monday.com.' }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const safeName = (asset.name || 'arquivo').replace(/"/g, '');

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(asset.name || 'arquivo')}`,
      'Cache-Control': 'private, max-age=60',
    },
  });
}
