import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { SESSION_COOKIE, createSessionToken } from '../../../../lib/auth';
import { findAppUserByName } from '../../../../lib/users';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { name, password } = await request.json().catch(() => ({}));

  if (!name || !password) {
    return NextResponse.json({ error: 'Informe seu nome e sua senha.' }, { status: 400 });
  }

  let user;
  try {
    user = await findAppUserByName(name);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (!user || !user.ativo || !user.senhaHash) {
    return NextResponse.json({ error: 'Nome ou senha incorretos.' }, { status: 401 });
  }

  const ok = await bcrypt.compare(password, user.senhaHash);
  if (!ok) {
    return NextResponse.json({ error: 'Nome ou senha incorretos.' }, { status: 401 });
  }

  const token = await createSessionToken({ uid: user.id, name: user.name, admin: user.admin });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // "none" (em vez de "lax") é necessário porque o suplemento do Word abre
    // esta página dentro de um iframe hospedado pelo Word/Office — sem isso,
    // o navegador aceita o cookie mas nunca o reenvia nas chamadas seguintes
    // feitas de dentro desse iframe, e o login nunca "gruda". SameSite=None
    // exige Secure=true sempre (não só em produção), senão o navegador
    // rejeita o cookie de qualquer jeito.
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
