import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../lib/admin-guard';
import { fetchProductionSummary } from '../../../lib/production';

export const dynamic = 'force-dynamic';

// Fase 8 (Vendas × Produção), Parte A — painel agregado de capacidade e
// atraso, lendo os boards PEDIDOS/PRODUÇÃO da fábrica (não são boards deste
// projeto). Admin-only, mesmo padrão de acesso do resto do Dashboard
// Gerencial: dado de capacidade/financeiro é visão de gestão, não do dia a
// dia de quem trabalha o funil.
export async function GET(request) {
  const guard = await requireAdmin(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const summary = await fetchProductionSummary();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
