import { NextResponse } from 'next/server';
import { getSessionPayload } from '../../../../lib/auth';
import { fetchItemColumnText, updateItemColumns } from '../../../../lib/monday';
import { COLUMNS, BOARD_ID } from '../../../../lib/config';
import { parseTrackingList, applyTrackingEvent } from '../../../../lib/proposalTracking';

export const dynamic = 'force-dynamic';

// Cap por ping — proteção contra uma aba esquecida aberta em segundo plano
// sem disparar o "visibilitychange" corretamente (ex: navegador suspende o
// timer mas não o evento) inflar o tempo total. 60s é bem mais que o
// intervalo real de heartbeat do visualizador (15s).
const MAX_INCREMENT_MS = 60 * 1000;

// Recebe os pings do beacon do visualizador público (ver
// components/ProposalTrackViewer.jsx): 'open' quando a página carrega de
// verdade num navegador, 'heartbeat' com o tempo acumulado desde o último
// ping. Atualiza o registro certo dentro do JSON da coluna "Rastreio de
// Propostas" do lead (ver lib/proposalTracking.js).
//
// Limitação aceita conscientemente: se dois pings da mesma proposta
// chegarem quase ao mesmo tempo (ex: duas abas abertas), é uma leitura seguida
// de escrita sem lock — o mais lento pode sobrescrever o mais rápido e um
// incremento de tempo se perder. Baixo risco e baixo custo (o pior caso é
// subestimar o tempo total, nunca travar a experiência de quem está vendo a
// proposta), não valeu a pena resolver com lock otimista pra este uso.
export async function POST(request, { params }) {
  const payload = await getSessionPayload(params.token);
  if (!payload || payload.purpose !== 'proposal-track') {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const event = body.event === 'heartbeat' ? 'heartbeat' : 'open';
  const durationMs = Math.max(0, Math.min(Number(body.durationMs) || 0, MAX_INCREMENT_MS));

  try {
    const raw = await fetchItemColumnText(payload.itemId, COLUMNS.rastreioPropostas);
    const list = parseTrackingList(raw);
    const idx = list.findIndex((r) => r.sendId === payload.sendId);
    if (idx === -1) {
      // Registro sumiu (lead apagado, coluna limpa manualmente etc.) — não
      // há onde gravar, mas isso não é um erro do cliente vendo a proposta.
      return NextResponse.json({ ok: true });
    }
    list[idx] = applyTrackingEvent(list[idx], event, durationMs);
    await updateItemColumns(BOARD_ID, payload.itemId, { [COLUMNS.rastreioPropostas]: JSON.stringify(list) });
    return NextResponse.json({ ok: true });
  } catch {
    // Nunca deixa um erro de rastreio aparecer pro cliente vendo o PDF — o
    // pior caso aceitável aqui é perder um ping, não quebrar a página dele.
    return NextResponse.json({ ok: false });
  }
}
