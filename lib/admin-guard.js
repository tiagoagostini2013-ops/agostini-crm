import { SESSION_COOKIE, getSessionPayload } from './auth';

// Helper usado pelas rotas /api/admin/* — confirma que quem está chamando
// está logado E marcado como Admin no board de usuários.
export async function requireAdmin(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const payload = await getSessionPayload(token);
  if (!payload) return { error: 'Não autenticado.', status: 401 };
  if (!payload.admin) return { error: 'Só administradores podem fazer isso.', status: 403 };
  return { payload };
}
