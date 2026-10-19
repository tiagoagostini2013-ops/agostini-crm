import { NextResponse } from 'next/server';
import { updateItemColumns, fetchItemColumnTexts } from '../../../../../lib/monday';
import { BOARD_ID, COLUMNS, CONTATOS_BOARD_ID } from '../../../../../lib/config';
import { parseOportunidade, aplicarOportunidade } from '../../../../../lib/oportunidade.js';
import { listarContatos } from '../../../../../lib/estruturaServer';
import { getSessao } from '../../../../../lib/sessao';

export const dynamic = 'force-dynamic';

function semColuna() {
  return NextResponse.json({ error: 'A coluna "Oportunidade (JSON)" ainda não foi criada neste ambiente. Rode scripts/criar-estrutura-oportunidades.mjs e configure MONDAY_COL_OPORTUNIDADE (ver README).' }, { status: 409 });
}

export async function GET(request, { params }) {
  try {
    if (!COLUMNS.oportunidade) return semColuna();
    const t = await fetchItemColumnTexts(Number(params.id), [COLUMNS.oportunidade]);
    return NextResponse.json({ oportunidade: parseOportunidade(t[COLUMNS.oportunidade]) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Nome da oportunidade e contatos vinculados. Controle de conflito por `rev`.
export async function PUT(request, { params }) {
  try {
    if (!COLUMNS.oportunidade) return semColuna();
    const body = await request.json();
    const sessao = await getSessao(request);
    const itemId = Number(params.id);

    if (body.adicionarContatoId) {
      if (!CONTATOS_BOARD_ID) return NextResponse.json({ error: 'Board "Contatos" não configurado neste ambiente.' }, { status: 409 });
      const existe = (await listarContatos()).some((c) => c.id === String(body.adicionarContatoId));
      if (!existe) return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 });
    }
    const t = await fetchItemColumnTexts(itemId, [COLUMNS.oportunidade]);
    const atual = parseOportunidade(t[COLUMNS.oportunidade]);
    const r = aplicarOportunidade(
      atual,
      { nome: body.nome, adicionarContatoId: body.adicionarContatoId, removerContatoId: body.removerContatoId },
      { expectedRev: body.expectedRev, autor: sessao?.name }
    );
    if (r.conflito) {
      return NextResponse.json({ conflito: true, atual: r.atual, error: 'Outra pessoa alterou a oportunidade enquanto você editava. Recarregue para ver o valor atual.' }, { status: 409 });
    }
    if (r.erro) return NextResponse.json({ error: r.erro }, { status: 400 });
    if (r.mudou) await updateItemColumns(BOARD_ID, itemId, { [COLUMNS.oportunidade]: r.texto });
    return NextResponse.json({ ok: true, oportunidade: parseOportunidade(r.texto), mudou: r.mudou });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
