import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import {
  uploadFileToItem,
  addItemNote,
  fetchItemFileColumnRaw,
  fetchItemColumnText,
  updateItemColumns,
  findNewFileAssetId,
} from '../../../../lib/monday';
import { COLUMNS, BOARD_ID } from '../../../../lib/config';
import { SESSION_COOKIE, getSessionPayload, createSignedToken } from '../../../../lib/auth';
import { fetchBlobContent } from '../../../../lib/blobServer';
import { convertDocxToPdf } from '../../../../lib/pdfConvert';
import { parseTrackingList, createTrackingRecord } from '../../../../lib/proposalTracking';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // segundos — dá folga pra baixar o .docx do Blob, converter pra PDF e subir os dois pro monday.com

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const TRACK_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 dias — sobra pra qualquer prazo de validade de proposta

// Recebe a URL do .docx que o suplemento acabou de subir no Vercel Blob (ver
// /api/word-addin/blob-upload — o arquivo em si não passa mais direto por
// aqui, só a URL, porque funções da Vercel recusam corpo de requisição acima
// de 4.5MB e uma proposta técnica com fotos/desenhos facilmente passa disso).
// Baixa o conteúdo aqui no servidor e anexa na coluna "Propostas" do lead
// certo no monday.com — é o que o botão "Vincular ao CRM" do suplemento
// dispara.
//
// Reativado em 20/08/2026 (tinha sido removido em 19/08 pra simplificar o
// fluxo): além do .docx, agora também gera um PDF via CloudConvert e anexa
// junto — é sobre esse PDF que o rastreio de leitura (visualizada quando?
// quanto tempo?) funciona, pedido pelo Tiago depois de ver algo parecido num
// concorrente. Se a conversão falhar ou o CLOUDCONVERT_API_KEY não estiver
// configurado, o .docx ainda é anexado normalmente — só fica sem PDF/link de
// rastreio dessa vez (reportado como aviso, não como erro, pro vendedor não
// perder o trabalho de vincular o Word por causa disso).
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

    // ---------- PDF + rastreio de leitura ----------
    let trackUrl = null;
    let pdfWarning = null;
    if (!process.env.CLOUDCONVERT_API_KEY) {
      pdfWarning = 'PDF e link de rastreio não gerados: CLOUDCONVERT_API_KEY não está configurado no servidor.';
    } else {
      try {
        // Lista de assets ANTES de subir o PDF, pra saber por diferença qual
        // é o asset novo depois (a mutação de upload do monday.com só devolve
        // o id do item, não o do arquivo recém-criado).
        const rawBefore = await fetchItemFileColumnRaw(itemId, COLUMNS.propostas);
        const existingIds = new Set(
          (rawBefore.files || []).filter((f) => f.fileType === 'ASSET' && f.assetId).map((f) => String(f.assetId))
        );

        const pdfBuffer = await convertDocxToPdf(docxBuffer, safeName, { maxWaitMs: 35000 });
        const pdfName = safeName.replace(/\.docx$/i, '') + '.pdf';
        await uploadFileToItem(itemId, COLUMNS.propostas, pdfBuffer, pdfName, PDF_MIME);

        const newAssetId = await findNewFileAssetId(itemId, COLUMNS.propostas, existingIds);
        if (!newAssetId) {
          throw new Error('PDF anexado, mas não foi possível identificar o arquivo novo pra gerar o link de rastreio.');
        }

        const sendId = crypto.randomUUID();
        const record = createTrackingRecord({ sendId, fileName: pdfName, assetId: newAssetId, sentBy: session.name });

        const rawTracking = await fetchItemColumnText(itemId, COLUMNS.rastreioPropostas);
        const list = parseTrackingList(rawTracking);
        list.push(record);
        await updateItemColumns(BOARD_ID, itemId, { [COLUMNS.rastreioPropostas]: JSON.stringify(list) });

        const trackToken = await createSignedToken(
          { itemId: String(itemId), sendId, assetId: newAssetId, fileName: pdfName, purpose: 'proposal-track' },
          TRACK_TOKEN_TTL_MS
        );
        trackUrl = `${request.nextUrl.origin}/p/${trackToken}`;

        await addItemNote(
          itemId,
          `📄 PDF gerado e link de rastreio criado por ${session.name} — avisa quando o cliente abrir.`
        ).catch(() => {});
      } catch (err) {
        pdfWarning = `Word anexado, mas o PDF/link de rastreio não pôde ser gerado: ${err.message}`;
      }
    }

    return NextResponse.json({ ok: true, trackUrl, pdfWarning });
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
