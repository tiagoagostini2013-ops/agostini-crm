import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/admin-guard';
import { hojeSP } from '../../../../lib/tempo.js';
import { visaoSemanal } from '../../../../lib/automacao.js';
import { carregarConfig, carregarLeads } from '../../../../lib/automacaoServer';

export const dynamic = 'force-dynamic';

// Visão SEMANAL do gestor (aba Gerencial, só administrador). Só leitura; os
// critérios de cada lista vêm junto (`criterios`) para a tela explicá-los.
export async function GET(request) {
  const guard = await requireAdmin(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const url = new URL(request.url);
    const { config } = await carregarConfig();
    const leads = await carregarLeads();
    const v = visaoSemanal(leads, config, { hoje: hojeSP(), responsavelId: url.searchParams.get('responsavelId') || null });
    return NextResponse.json(v);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
