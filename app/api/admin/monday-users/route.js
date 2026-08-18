import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/admin-guard';
import { fetchUsers } from '../../../../lib/monday';

export const dynamic = 'force-dynamic';

// Lista completa de pessoas da conta do monday.com (todos os setores) — usada
// só na tela de administração, para o admin escolher a qual pessoa real cada
// conta do painel corresponde. Não confundir com /api/meta, que já vem
// filtrado para só quem está vinculado (ver lib/users.js).
export async function GET(request) {
  const guard = await requireAdmin(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const users = await fetchUsers();
    return NextResponse.json({ users });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
