import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { uploadFileToItem, addItemNote } from '../../../../lib/monday';
import { COLUMNS } from '../../../../lib/config';
import { SESSION_COOKIE, getSessionPayload } from '../../../../lib/auth';
import { fetchBlobContent } from '../../../../lib/blobServer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // segundos — dá folga pra baixar o .docx do Blob e subir pro monday.com

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Recebe a URL do .docx que o suplemento acabou de subir no Vercel Blob (ver
// /api/word-addin/blob-upload — o arquivo em si não passa mais direto por
// aqui, só a URL, porque funções da Vercel recusam corpo de requisição acima
// de 4.5MB e uma proposta técnica com fotos/desenhos facilmente passa disso).
// Baixa o conteúdo aqui no servidor e anexa na coluna "Propostas" do lead
// certo no monday.com — é o que o botão "Vincular ao CRM" do suplemento
// dispara.
//
// Só o .docx é anexado (sem gerar/salvar PDF automaticamente — removido a
// pedido do Tiago para simplificar o fluxo). Se algum dia isso voltar a fazer
// sentido, o código de conversão via CloudConvert ainda existe em
// lib/pdfConvert.js, só não é mais chamado daqui.
export async function POST(request) {
  let blobUrl;
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = await getSessionPayload(token);
    if (!session) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { itemId, fileName } = body;
    blobUrl = body.blobUrl;
    if (!itemId || !blobUrl) {
      return NextResponse.json({ error: 'itemId e blobUrl são obrigatórios.' }, { status: 400 });
    }

    const blobRes = await fetchBlobContent(blobUrl);
    const docxBuffer = Buffer.from(await blobRes.arrayBuffer());
    const safeName = (fileName || 'Proposta.docx').replace(/[\\/]/g, '-');

    await uploadFileToItem(itemId, COLUMNS.propostas, docxBuffer, safeName, DOCX_MIME);

    await addItemNote(itemId, `📄 Proposta (Word) vinculada via suplemento do Word por ${session.name}.`).catch(() => {
      // Anexo já foi feito com sucesso — se só a anotação falhar, não é motivo
      // para reportar erro ao vendedor.
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    // O blob é só um ponto de passagem (o arquivo definitivo fica no
    // monday.com) — apaga em seguida pra não acumular armazenamento à toa,
    // com sucesso ou erro.
    if (blobUrl) {
      await del(blobUrl).catch(() => {});
    }
  }
}
