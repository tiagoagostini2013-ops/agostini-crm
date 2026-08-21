import { NextResponse } from 'next/server';
import { getSessionPayload } from '../../../../lib/auth';
import { fetchAssetsPublicUrls, fetchItemColumnText, updateItemColumns } from '../../../../lib/monday';
import { COLUMNS, BOARD_ID } from '../../../../lib/config';
import { parseTrackingList, applyTrackingEvent } from '../../../../lib/proposalTracking';

export const dynamic = 'force-dynamic';

// Serve o PDF como ANEXO (Content-Disposition: attachment) pro botão "Baixar
// PDF" do visualizador público (ver components/ProposalTrackViewer.jsx) —
// rota separada de app/api/proposal-track-file/[token], que serve o mesmo
// arquivo mas inline (pro <embed> da página) e de propósito não registra
// nada.
//
// Aqui SIM registramos um evento de "download", porque essa rota só é
// alcançada por um clique deliberado no nosso próprio botão, dentro de uma
// página que o robô de prévia do WhatsApp nunca chega a renderizar (ele só
// lê o HTML/meta tags da página inicial, não executa JavaScript nem clica em
// nada) — o mesmo raciocínio que já vale pro evento "aberto".
//
// Ressalva que já está documentada em lib/proposalTracking.js e vale repetir
// aqui: isso mede quem clicou nesse botão, não quem salvou o arquivo pelo
// visualizador nativo do navegador (o ícone de salvar do próprio Chrome/Edge
// ao ver o PDF embutido) — essa ação não gera nenhuma requisição nova, então
// não tem como ser vista daqui.
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

  // Best-effort: nunca deixa uma falha ao gravar o evento impedir o download
  // em si — o pior caso aceitável é perder o registro de "baixou", não
  // travar o cliente tentando pegar o arquivo.
  try {
    const raw = await fetchItemColumnText(payload.itemId, COLUMNS.rastreioPropostas);
    const list = parseTrackingList(raw);
    const idx = list.findIndex((r) => r.sendId === payload.sendId);
    if (idx !== -1) {
      list[idx] = applyTrackingEvent(list[idx], 'download', 0);
      await updateItemColumns(BOARD_ID, payload.itemId, { [COLUMNS.rastreioPropostas]: JSON.stringify(list) });
    }
  } catch {
    // silencioso de propósito — ver comentário acima
  }

  const safeName = (payload.fileName || asset.name || 'proposta.pdf').replace(/"/g, '');
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
