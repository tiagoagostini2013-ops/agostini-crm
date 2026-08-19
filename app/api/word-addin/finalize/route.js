import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { uploadFileToItem, addItemNote } from '../../../../lib/monday';
import { COLUMNS } from '../../../../lib/config';
import { SESSION_COOKIE, getSessionPayload } from '../../../../lib/auth';
import { convertDocxToPdf } from '../../../../lib/pdfConvert';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // segundos — dá folga pro polling do CloudConvert + baixar o .docx do Blob

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Recebe a URL do .docx que o suplemento acabou de subir no Vercel Blob
// (ver /api/word-addin/blob-upload — o arquivo em si não passa mais direto
// por aqui, só a URL, porque funções da Vercel recusam corpo de requisição
// acima de 4.5MB e uma proposta técnica com fotos/desenhos facilmente passa
// disso). Baixa o conteúdo aqui no servidor, anexa na coluna "Propostas" do
// lead certo no monday.com e, se o CloudConvert estiver configurado, gera e
// anexa também a versão em PDF — tudo isso é o que o botão "Vincular ao CRM"
// do suplemento dispara.
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

    const blobRes = await fetch(blobUrl);
    if (!blobRes.ok) {
      throw new Error('Não foi possível ler o arquivo recém enviado (blobUrl inválida ou expirada).');
    }
    const docxBuffer = Buffer.from(await blobRes.arrayBuffer());
    const safeName = (fileName || 'Proposta.docx').replace(/[\\/]/g, '-');
    const baseName = safeName.replace(/\.docx$/i, '');

    await uploadFileToItem(itemId, COLUMNS.propostas, docxBuffer, safeName, DOCX_MIME);

    let pdfStatus = 'skipped';
    let pdfError = null;
    if (process.env.CLOUDCONVERT_API_KEY) {
      try {
        const pdfBuffer = await convertDocxToPdf(docxBuffer, safeName);
        await uploadFileToItem(itemId, COLUMNS.propostas, pdfBuffer, `${baseName}.pdf`, 'application/pdf');
        pdfStatus = 'ok';
      } catch (err) {
        pdfStatus = err.message === 'TIMEOUT' ? 'timeout' : 'error';
        pdfError = err.message;
      }
    }

    const notaPdf =
      pdfStatus === 'ok'
        ? 'Word + PDF anexados.'
        : pdfStatus === 'timeout'
          ? 'Word anexado; conversão para PDF demorou mais que o esperado, tente novamente em instantes se precisar do PDF.'
          : pdfStatus === 'error'
            ? 'Word anexado; a conversão automática para PDF falhou.'
            : 'Word anexado (conversão automática para PDF não está configurada).';

    await addItemNote(
      itemId,
      `📄 Proposta vinculada via suplemento do Word por ${session.name}. ${notaPdf}`
    ).catch(() => {
      // Anexo já foi feito com sucesso — se só a anotação falhar, não é motivo
      // para reportar erro ao vendedor.
    });

    return NextResponse.json({ ok: true, pdfStatus, pdfError });
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
