import { NextResponse } from 'next/server';
import { updateItemColumns, fetchItemColumnTexts } from '../../../../../lib/monday';
import { BOARD_ID, COLUMNS, EMPRESAS_BOARD_ID } from '../../../../../lib/config';
import { listarEmpresas, registrarNota, novaRef } from '../../../../../lib/estruturaServer';
import { getSessao } from '../../../../../lib/sessao';

export const dynamic = 'force-dynamic';

// Vincular (ou desvincular) a oportunidade a uma empresa cadastrada.
// Grava SÓ o id da empresa na coluna "Empresa ID" — nada é copiado para o lead e
// o texto antigo da coluna "Empresa" não é tocado (histórico preservado). O
// vínculo é sempre uma ação explícita de quem usa a tela; nenhum vínculo é
// criado por semelhança de nome.
export async function PUT(request, { params }) {
  try {
    if (!COLUMNS.empresaId || !EMPRESAS_BOARD_ID) {
      return NextResponse.json({ error: 'A estrutura de empresas ainda não foi configurada neste ambiente (coluna "Empresa ID" e board "Empresas"). Veja o README.' }, { status: 409 });
    }
    const body = await request.json();
    const sessao = await getSessao(request);
    const itemId = Number(params.id);
    const novo = body.empresaId ? String(body.empresaId) : null;

    const [textos, empresas] = await Promise.all([
      fetchItemColumnTexts(itemId, [COLUMNS.empresaId]),
      listarEmpresas(),
    ]);
    const atual = (textos[COLUMNS.empresaId] || '').trim() || null;
    // Conflito: outra pessoa já mudou o vínculo desde que esta tela abriu.
    if (body.expectedEmpresaId !== undefined && (body.expectedEmpresaId || null) !== atual) {
      const atualNome = empresas.find((e) => e.id === atual)?.nome || null;
      return NextResponse.json({ conflito: true, atual: { empresaId: atual, empresaNome: atualNome }, error: 'Outra pessoa já alterou a empresa desta oportunidade. Recarregue para ver o vínculo atual.' }, { status: 409 });
    }
    const emp = novo ? empresas.find((e) => e.id === novo) : null;
    if (novo && !emp) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
    if (atual === novo) return NextResponse.json({ ok: true, empresaId: novo, empresaNome: emp?.nome || null, semMudanca: true });

    await updateItemColumns(BOARD_ID, itemId, { [COLUMNS.empresaId]: novo || '' });
    const antes = atual ? empresas.find((e) => e.id === atual)?.nome || `#${atual}` : null;
    const linhas = novo
      ? [`🏢 Oportunidade vinculada à empresa "${emp.nome}" por ${sessao?.name || 'alguém'}${antes ? ` (antes: "${antes}")` : ''}.`]
      : [`🏢 Vínculo com a empresa "${antes}" removido por ${sessao?.name || 'alguém'}.`];
    const nota = await registrarNota(itemId, linhas, novaRef());
    return NextResponse.json({ ok: true, empresaId: novo, empresaNome: emp?.nome || null, notaRegistrada: nota.ok });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
