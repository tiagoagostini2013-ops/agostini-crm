import { NextResponse } from 'next/server';
import { SESSION_COOKIE, getSessionPayload } from '../../../../lib/auth';
import { fetchAppUsers } from '../../../../lib/users';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const payload = await getSessionPayload(token);
  if (!payload) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }

  // Vínculo com a pessoa real do monday.com (mondayUserId) — usado pelo
  // front-end (Fase 7) pra filtrar quais leads são "meus" e mostrar métricas
  // pessoais (ex: meu tempo até o 1º contato) sem expor a lista de todo
  // mundo. Não é crítico pro login em si, então uma falha aqui não derruba a
  // sessão — só faz essas métricas pessoais não aparecerem.
  let mondayUserId = null;
  try {
    const users = await fetchAppUsers();
    const me = users.find((u) => String(u.id) === String(payload.uid));
    mondayUserId = me ? me.mondayUserId : null;
  } catch {
    // silencioso — ver comentário acima
  }

  return NextResponse.json({ name: payload.name, admin: !!payload.admin, mondayUserId });
}
