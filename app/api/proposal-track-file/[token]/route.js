import { NextResponse } from 'next/server';
import { getSessionPayload } from '../../../../lib/auth';
import { fetchAssetsPublicUrls } from '../../../../lib/monday';

export const dynamic = 'force-dynamic';

// Serve o PDF em si pro visualizador público de rastreio (ver
// app/p/[token]/page.js). De propósito NÃO registra nenhum evento de
// visualização aqui — essa rota pode ser chamada por coisas que não são o
// cliente abrindo a proposta de verdade (ex: o próprio navegador
// pré-carregando o <embed>, um leitor de PDF fazendo range requests). Quem
// registra "aberto"/tempo de tela é só o beacon de JavaScript da página (ver
// components/ProposalTrackViewer.jsx e app/api/track/[token]/route.js) —
// robôs de prévia de link (WhatsApp etc.) não executam JavaScript, então
// nunca chegam a disparar esse beacon.
export async function GET(request, { params }) {
  const payload = await getSessionPayload(params.token);
  if (!payload || payload.purpose !== 'proposal-track') {
    return NextResponse.json({ error: 'Link inválido ou expirado. Peça um novo ao vendedor.' }, { status: 401 });
  }

  let asset;
  try {
    const assetMap = await fetchAssetsPublicUrls([payload.assetId]);
    asset = assetMap[String(payload.assetId)];
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (!asset || !asset.url) {
    return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });
  }

  const upstream = await fetch(asset.url);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Não foi possível carregar o arquivo.' }, { status: 502 });
  }

  const safeName = (payload.fileName || asset.name || 'proposta.pdf').replace(/"/g, '');
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
