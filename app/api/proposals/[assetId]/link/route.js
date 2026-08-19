import { NextResponse } from 'next/server';
import { createSignedToken } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

const LINK_TTL_MS = 30 * 60 * 1000; // 30 min — dá tempo de ver o documento com folga

// Gera um link de curta duração para a prévia de um arquivo (ver
// /api/proposal-file/[assetId]). Essa rota em si já é protegida pelo
// middleware (exige sessão logada); o token devolvido é o que autoriza a
// rota pública de fato a servir o arquivo, sem exigir cookie — necessário
// porque quem busca o conteúdo do .docx/.xlsx é o servidor da Microsoft
// (Office Online Viewer), que não tem como mandar nosso cookie de sessão.
export async function GET(request, { params }) {
  const token = await createSignedToken(
    { assetId: params.assetId, purpose: 'proposal-view' },
    LINK_TTL_MS
  );
  const viewUrl = `/api/proposal-file/${encodeURIComponent(params.assetId)}?token=${encodeURIComponent(token)}`;
  return NextResponse.json({ viewUrl });
}
