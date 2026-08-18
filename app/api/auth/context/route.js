import { NextResponse } from 'next/server';
import { fetchAppUsers } from '../../../../lib/users';

export const dynamic = 'force-dynamic';

// Rota pública (não exige login) — a tela de login usa isso pra saber se
// mostra o formulário de "criar administrador" (nenhum usuário ainda) ou o
// login normal, e pra popular a lista de nomes.
export async function GET() {
  try {
    const users = await fetchAppUsers();
    const active = users.filter((u) => u.ativo);
    return NextResponse.json({
      hasUsers: users.length > 0,
      users: active.map((u) => ({ name: u.name })),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
