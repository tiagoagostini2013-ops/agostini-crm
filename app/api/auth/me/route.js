import { NextResponse } from 'next/server';
import { SESSION_COOKIE, getSessionPayload } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const payload = await getSessionPayload(token);
  if (!payload) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }
  return NextResponse.json({ name: payload.name, admin: !!payload.admin });
}
