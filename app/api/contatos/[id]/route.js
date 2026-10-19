import { NextResponse } from 'next/server';
import { renameItem, updateItemColumns } from '../../../../lib/monday';
import { CONTATOS_BOARD_ID, CONTATOS_COLUMNS, PAPEIS_DECISAO } from '../../../../lib/config';
import { listarContatos, conflitoDeCampos } from '../../../../lib/estruturaServer';

export const dynamic = 'force-dynamic';

const CAMPOS = ['nome', 'telefone', 'email', 'papel', 'empresaId'];

export async function PATCH(request, { params }) {
  try {
    if (!CONTATOS_BOARD_ID) return NextResponse.json({ error: 'Board "Contatos" não configurado.' }, { status: 409 });
    const body = await request.json();
    const atual = (await listarContatos()).find((c) => c.id === String(params.id));
    if (!atual) return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 });
    const campos = CAMPOS.filter((c) => body[c] !== undefined);
    if (!campos.length) return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
    const conflito = conflitoDeCampos(atual, body.base, campos);
    if (conflito) {
      return NextResponse.json({ conflito: true, campos: conflito, atual, error: 'Outra pessoa alterou este contato enquanto você editava. Recarregue para ver os valores atuais.' }, { status: 409 });
    }
    const col = CONTATOS_COLUMNS;
    const colunas = {};
    if (body.nome !== undefined) {
      const nome = String(body.nome || '').replace(/\s+/g, ' ').trim();
      if (!nome || nome.length > 100) return NextResponse.json({ error: 'Nome inválido (1 a 100 caracteres).' }, { status: 400 });
      await renameItem(CONTATOS_BOARD_ID, Number(params.id), nome);
    }
    for (const k of ['telefone', 'email', 'papel', 'empresaId']) {
      if (body[k] === undefined) continue;
      if (!col[k]) return NextResponse.json({ error: `Coluna "${k}" do board Contatos não configurada.` }, { status: 409 });
      const v = String(body[k] || '').trim();
      if (k === 'papel' && v && !PAPEIS_DECISAO.includes(v)) return NextResponse.json({ error: 'Papel na decisão inválido.' }, { status: 400 });
      if (k === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
      colunas[col[k]] = v;
    }
    if (Object.keys(colunas).length) await updateItemColumns(CONTATOS_BOARD_ID, Number(params.id), colunas);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
