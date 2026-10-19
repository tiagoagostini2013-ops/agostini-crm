import { NextResponse } from 'next/server';
import { createLead } from '../../../lib/monday';
import { CONTATOS_BOARD_ID, CONTATOS_COLUMNS, PAPEIS_DECISAO } from '../../../lib/config';
import { listarContatos } from '../../../lib/estruturaServer';
import { normalizarTelefone } from '../../../lib/empresas.js';

export const dynamic = 'force-dynamic';

// Cadastrar contato (pessoa). Só o nome é obrigatório; telefone, e-mail e
// empresa são opcionais — um contato pode existir sem empresa identificada.
// Telefone já cadastrado → 409 com o existente (usar o mesmo ou `force:true`).
export async function POST(request) {
  try {
    if (!CONTATOS_BOARD_ID) {
      return NextResponse.json({ error: 'O board "Contatos" ainda não foi configurado neste ambiente (MONDAY_CONTATOS_BOARD_ID). Veja o README.' }, { status: 409 });
    }
    const body = await request.json();
    const nome = String(body.nome || '').replace(/\s+/g, ' ').trim();
    if (!nome) return NextResponse.json({ error: 'Informe o nome do contato.' }, { status: 400 });
    if (nome.length > 100) return NextResponse.json({ error: 'O nome pode ter no máximo 100 caracteres.' }, { status: 400 });
    const papel = String(body.papel || '').trim();
    if (papel && !PAPEIS_DECISAO.includes(papel)) return NextResponse.json({ error: 'Papel na decisão inválido.' }, { status: 400 });
    const email = String(body.email || '').trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'E-mail inválido (ou deixe em branco).' }, { status: 400 });
    const telefone = String(body.telefone || '').trim().slice(0, 40);

    if (telefone && body.force !== true) {
      const tel = normalizarTelefone(telefone);
      if (tel) {
        const existentes = (await listarContatos()).filter((c) => normalizarTelefone(c.telefone) === tel);
        if (existentes.length) {
          return NextResponse.json({ duplicado: true, existentes, error: 'Já existe contato com este telefone. Use o existente ou confirme para criar outro mesmo assim.' }, { status: 409 });
        }
      }
    }
    const col = CONTATOS_COLUMNS;
    const colunas = {};
    if (telefone && col.telefone) colunas[col.telefone] = telefone;
    if (email && col.email) colunas[col.email] = email;
    if (papel && col.papel) colunas[col.papel] = papel;
    if (body.empresaId && col.empresaId) colunas[col.empresaId] = String(body.empresaId);
    const criado = await createLead(CONTATOS_BOARD_ID, null, nome, Object.keys(colunas).length ? colunas : null);
    return NextResponse.json({ contato: { id: String(criado.id), nome, telefone: telefone || null, email: email || null, papel: papel || null, empresaId: body.empresaId ? String(body.empresaId) : null } });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
