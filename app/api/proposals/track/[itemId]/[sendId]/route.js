import { NextResponse } from 'next/server';
import { createSignedToken } from '../../../../../../lib/auth';
import { fetchItemColumnText } from '../../../../../../lib/monday';
import { COLUMNS } from '../../../../../../lib/config';
import { parseTrackingList } from '../../../../../../lib/proposalTracking';

export const dynamic = 'force-dynamic';

const TRACK_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // mesma validade usada ao criar o registro

// Rota autenticada (protegida pelo middleware, como o resto do painel) pra
// reemitir o link de rastreio de um envio já feito — útil se o vendedor
// perdeu o link que apareceu no suplemento na hora e precisa mandar de novo.
// Reemitir é seguro: o token é só uma assinatura em cima de itemId+sendId+
// assetId que já existem, não é um segredo de uso único guardado em algum
// lugar — gerar um novo não invalida nem duplica o registro de rastreio.
export async function GET(request, { params }) {
  try {
    const raw = await fetchItemColumnText(params.itemId, COLUMNS.rastreioPropostas);
    const list = parseTrackingList(raw);
    const record = list.find((r) => r.sendId === params.sendId);
    if (!record) {
      return NextResponse.json({ error: 'Envio não encontrado.' }, { status: 404 });
    }

    const trackToken = await createSignedToken(
      {
        itemId: String(params.itemId),
        sendId: record.sendId,
        assetId: record.assetId,
        fileName: record.fileName,
        purpose: 'proposal-track',
      },
      TRACK_TOKEN_TTL_MS
    );
    const url = `${request.nextUrl.origin}/p/${trackToken}`;
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
