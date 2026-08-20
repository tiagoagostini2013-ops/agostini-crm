import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/admin-guard';
import { fetchItemColumnText, updateItemColumns } from '../../../../lib/monday';
import { SETTINGS_BOARD_ID, FORECAST_SETTINGS_ITEM_ID, SETTINGS_COLUMNS, FORECAST_STAGES, DEFAULT_FORECAST_PROBABILITIES } from '../../../../lib/config';

export const dynamic = 'force-dynamic';

// Probabilidades de fechamento por estágio, usadas no forecast ponderado da
// aba Métricas (Fase 5). Guardadas como JSON num item dedicado do board
// "CRM Agostini - Configurações" — não são um dado de negócio (lead/cliente),
// só um parâmetro do painel, por isso não vive no board principal.
//
// A sessão já é exigida por middleware.js para qualquer rota fora de
// PUBLIC_PATHS — aqui só GET (leitura, qualquer vendedor logado pode ver o
// forecast) fica aberto; PATCH (ajustar as probabilidades) exige admin, pra
// não deixar um vendedor qualquer mudar um número que afeta a visão de todo
// mundo.
export async function GET() {
  try {
    const text = await fetchItemColumnText(FORECAST_SETTINGS_ITEM_ID, SETTINGS_COLUMNS.valorJson);
    let stored = {};
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') stored = parsed;
      } catch {
        // JSON inválido guardado por engano — ignora e cai no padrão.
      }
    }
    // Sempre devolve todos os estágios do funil aberto, preenchendo com o
    // padrão quem não tiver valor salvo ainda (ex: recém-criado).
    const probabilities = {};
    for (const stage of FORECAST_STAGES) {
      const v = Number(stored[stage]);
      probabilities[stage] = Number.isFinite(v) ? clamp(v) : DEFAULT_FORECAST_PROBABILITIES[stage];
    }
    return NextResponse.json({ probabilities });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  const guard = await requireAdmin(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const body = await request.json().catch(() => ({}));
    const input = body.probabilities;
    if (!input || typeof input !== 'object') {
      return NextResponse.json({ error: 'Envie um objeto "probabilities" com um número (0-100) por estágio.' }, { status: 400 });
    }

    const probabilities = {};
    for (const stage of FORECAST_STAGES) {
      const v = Number(input[stage]);
      if (!Number.isFinite(v)) {
        return NextResponse.json({ error: `Probabilidade inválida para o estágio "${stage}".` }, { status: 400 });
      }
      probabilities[stage] = clamp(v);
    }

    await updateItemColumns(SETTINGS_BOARD_ID, FORECAST_SETTINGS_ITEM_ID, {
      [SETTINGS_COLUMNS.valorJson]: JSON.stringify(probabilities),
    });

    return NextResponse.json({ ok: true, probabilities });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}
