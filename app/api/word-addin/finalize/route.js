import { NextResponse } from 'next/server';
import { uploadFileToItem, addItemNote } from '../../../../lib/monday';
import { COLUMNS } from '../../../../lib/config';
import { SESSION_COOKIE, getSessionPayload } from '../../../../lib/auth';
import { convertDocxToPdf } from '../../../../lib/pdfConvert';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // segundos — dá mais folga para o polling do CloudConvert (ver lib/pdfConvert.js)

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Recebe o .docx que o vendedor está editando no Word (mandado pelo
// suplemento como base64), anexa na coluna "Propostas" do lead certo no
// monday.com e, se o CloudConvert estiver configurado, gera e anexa também a
// versão em PDF — tudo isso é o que o botão "Vincular ao CRM" do suplemento
// dispara.
export async function POST(request) {
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = await getSessionPayload(token);
    if (!session) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }

    const { itemId, fileBase64, fileName } = await request.json().catch(() => ({}));
    if (!itemId || !fileBase64) {
      return NextResponse.json({ error: 'itemId e fileBase64 são obrigatórios.' }, { status: 400 });
    }

    const docxBuffer = Buffer.from(fileBase64, 'base64');
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
  }
}
