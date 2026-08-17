import { NextResponse } from 'next/server';
import { SESSION_COOKIE, createSessionToken } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { password } = await request.json().catch(() => ({}));
  const expected = process.env.APP_PASSWORD;

  if (!expected) {
    return NextResponse.json(
      { error: 'APP_PASSWORD não configurado no servidor.' },
      { status: 500 }
    );
  }

  if (password !== expected) {
    return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
  }

  const token = await createSessionToken();
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
