import { NextResponse } from 'next/server';
import { fetchAllItems } from '../../../../lib/monday';
import { BOARD_ID, COLUMNS } from '../../../../lib/config';
import { flattenItem } from '../../../../lib/transform';
import { listarEmpresas, listarContatos } from '../../../../lib/estruturaServer';
import { requireAdmin } from '../../../../lib/admin-guard';
import { sugerirVinculosEmpresa, sugerirGruposDeLeads, acharContatoEquivalente, achaDuplicatasContatos } from '../../../../lib/empresas.js';

export const dynamic = 'force-dynamic';

// SOMENTE LEITURA (admin): sugestões para REVISÃO humana de vínculos entre
// leads existentes, empresas e contatos. Nada é gravado nem aplicado aqui.
export async function GET(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const ids = [COLUMNS.empresa, COLUMNS.empresaId, COLUMNS.contatosDecisao, COLUMNS.telefone, COLUMNS.estagio].filter(Boolean);
    const [itens, empresas, contatos] = await Promise.all([fetchAllItems(BOARD_ID, ids), listarEmpresas(), listarContatos()]);
    const leads = itens.map(flattenItem);
    const legados = [];
    for (const l of leads) {
      for (const c of l.contatos || []) {
        legados.push({ leadId: l.id, leadNome: l.name, contato: c, equivalente: acharContatoEquivalente(c, contatos) });
      }
    }
    return NextResponse.json({
      somenteLeitura: true,
      totais: { leads: leads.length, empresas: empresas.length, contatos: contatos.length, contatosLegados: legados.length },
      vinculosEmpresa: sugerirVinculosEmpresa(leads, empresas),
      gruposSemEmpresa: sugerirGruposDeLeads(leads),
      contatosLegados: legados,
      duplicatasContatos: achaDuplicatasContatos(contatos),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
