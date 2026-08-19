import { NextResponse } from 'next/server';
import { handleUpload } from '@vercel/blob/client';
import { SESSION_COOKIE, getSessionPayload } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Ponte pro Vercel Blob: o suplemento do Word manda o .docx direto pro
// armazenamento (sem passar pela nossa função), porque funções da Vercel só
// aceitam até 4.5 MB de corpo de requisição — pouco pra uma proposta técnica
// com fotos/desenhos anexados. Essa rota só entrega o "crachá" (token
// assinado) que autoriza aquele upload; o arquivo em si nunca passa por
// aqui. Depois do upload, o suplemento chama /api/word-addin/finalize só com
// a URL do blob (payload pequeno), que aí sim busca o conteúdo e manda pro
// monday.com.
//
// Requer a variável BLOB_READ_WRITE_TOKEN configurada (criada sozinha ao
// adicionar um Blob Store no projeto na Vercel — ver README).
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
        allowedContentTypes: [DOCX_MIME],
        addRandomSuffix: true,
        maximumSizeInBytes: 100 * 1024 * 1024, // 100MB de folga — bem acima do que um .docx real chega a pesar
      }),
      // Callback de confirmação (chamado pelo próprio servidor do Vercel
      // Blob, sem o cookie de sessão — por isso não faz nada que dependa de
      // autenticação aqui). Não precisamos dele: o vínculo com o lead só
      // acontece de fato quando o vendedor clica "Vincular ao CRM", que
      // chama /api/word-addin/finalize separadamente.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
