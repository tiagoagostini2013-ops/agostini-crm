import { NextResponse } from 'next/server';
import { renameItem, updateItemColumns } from '../../../../lib/monday';
import { EMPRESAS_BOARD_ID, EMPRESAS_COLUMNS } from '../../../../lib/config';
import { listarEmpresas, conflitoDeCampos } from '../../../../lib/estruturaServer';
import { normalizarCnpj } from '../../../../lib/empresas.js';

export const dynamic = 'force-dynamic';

// Editar dados da empresa. `base` = valores que o cliente carregou; se outro
// usuário já mudou algum dos campos enviados, responde 409 com o valor atual.
export async function PATCH(request, { params }) {
  try {
    if (!EMPRESAS_BOARD_ID) return NextResponse.json({ error: 'Board "Empresas" não configurado.' }, { status: 409 });
    const body = await request.json();
    const empresas = await listarEmpresas();
    const atual = empresas.find((e) => e.id === String(params.id));
    if (!atual) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
    const campos = ['nome', 'cnpj', 'cidade'].filter((c) => body[c] !== undefined);
    if (!campos.length) return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
    const conflito = conflitoDeCampos(atual, body.base, campos);
    if (conflito) {
      return NextResponse.json({ conflito: true, campos: conflito, atual, error: 'Outra pessoa alterou esta empresa enquanto você editava. Recarregue para ver os valores atuais.' }, { status: 409 });
    }
    if (body.nome !== undefined) {
      const nome = String(body.nome || '').replace(/\s+/g, ' ').trim();
      if (!nome || nome.length > 120) return NextResponse.json({ error: 'Nome inválido (1 a 120 caracteres).' }, { status: 400 });
      await renameItem(EMPRESAS_BOARD_ID, Number(params.id), nome);
    }
    const colunas = {};
    if (body.cnpj !== undefined) {
      const t = String(body.cnpj || '').trim();
      if (t && !normalizarCnpj(t)) return NextResponse.json({ error: 'CNPJ inválido: 14 dígitos ou em branco.' }, { status: 400 });
      if (!EMPRESAS_COLUMNS.cnpj) return NextResponse.json({ error: 'Coluna CNPJ não configurada (MONDAY_EMPRESAS_COL_CNPJ).' }, { status: 409 });
      colunas[EMPRESAS_COLUMNS.cnpj] = t;
    }
    if (body.cidade !== undefined) {
      if (!EMPRESAS_COLUMNS.cidade) return NextResponse.json({ error: 'Coluna Cidade não configurada (MONDAY_EMPRESAS_COL_CIDADE).' }, { status: 409 });
      colunas[EMPRESAS_COLUMNS.cidade] = String(body.cidade || '').trim().slice(0, 60);
    }
    if (Object.keys(colunas).length) await updateItemColumns(EMPRESAS_BOARD_ID, Number(params.id), colunas);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
