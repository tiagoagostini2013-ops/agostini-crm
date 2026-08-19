import { NextResponse } from 'next/server';
import { handleUpload } from '@vercel/blob/client';
import { SESSION_COOKIE, getSessionPayload } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

// Upload genérico usado pelo botão "Adicionar arquivo" do painel principal —
// proposta, orçamento de frete, layout do cliente, foto, planilha, o que for.
// Mesmo esquema já usado pelo suplemento do Word (ver
// app/api/word-addin/blob-upload): o navegador manda o arquivo direto pro
// Vercel Blob, sem passar pela nossa função, porque funções da Vercel
// recusam corpo de requisição acima de 4.5MB.
//
// Sem "allowedContentTypes" de propósito: como o pedido explicitamente
// inclui tipos variados (PDF, imagem, planilha, CAD/layout etc.), não faz
// sentido restringir por tipo aqui — quem decide o que anexar é o vendedor.
export async function POST(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSessionPayload(token);
  if (!session) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }

  const body = await request.json();

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        addRandomSuffix: true,
        maximumSizeInBytes: 100 * 1024 * 1024, // 100MB de folga
      }),
      // Não faz nada dependente de sessão aqui — este callback é chamado pelo
      // próprio servidor do Vercel Blob, sem o cookie do vendedor. O vínculo
      // de verdade com o lead só acontece quando o painel chama
      // /api/items/[id]/files logo em seguida.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
