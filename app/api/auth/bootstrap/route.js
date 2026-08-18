import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { SESSION_COOKIE, createSessionToken } from '../../../../lib/auth';
import { fetchAppUsers, createAppUser } from '../../../../lib/users';

export const dynamic = 'force-dynamic';

// Só funciona quando o board de usuários está vazio — cria a primeira conta
// (sempre como Admin) e já loga a pessoa. Depois disso, novas contas só
// podem ser criadas por um admin logado, em /admin/usuarios.
export async function POST(request) {
  const { name, password } = await request.json().catch(() => ({}));

  if (!name || !name.trim() || !password || password.length < 4) {
    return NextResponse.json(
      { error: 'Informe um nome e uma senha com pelo menos 4 caracteres.' },
      { status: 400 }
    );
  }

  let existing;
  try {
    existing = await fetchAppUsers();
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (existing.length > 0) {
    return NextResponse.json(
      { error: 'Já existe um administrador cadastrado. Peça para ele criar o seu acesso.' },
      { status: 409 }
    );
  }

  const hash = await bcrypt.hash(password, 10);
  let created;
  try {
    created = await createAppUser(name.trim(), hash, { admin: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const token = await createSessionToken({ uid: created.id, name: name.trim(), admin: true });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
