import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAdmin } from '../../../../lib/admin-guard';
import { fetchAppUsers, createAppUser, findAppUserByName } from '../../../../lib/users';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const guard = await requireAdmin(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const users = await fetchAppUsers();
    return NextResponse.json({
      users: users.map((u) => ({ id: u.id, name: u.name, admin: u.admin, ativo: u.ativo, mondayUserId: u.mondayUserId })),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const guard = await requireAdmin(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { name, password, admin, mondayUserId } = await request.json().catch(() => ({}));
  if (!name || !name.trim() || !password || password.length < 4) {
    return NextResponse.json(
      { error: 'Informe um nome e uma senha com pelo menos 4 caracteres.' },
      { status: 400 }
    );
  }

  try {
    const existing = await findAppUserByName(name);
    if (existing) {
      return NextResponse.json({ error: 'Já existe alguém cadastrado com esse nome.' }, { status: 409 });
    }
    const hash = await bcrypt.hash(password, 10);
    const created = await createAppUser(name.trim(), hash, { admin: !!admin, mondayUserId: mondayUserId || null });
    return NextResponse.json({ user: { id: created.id, name: name.trim() } });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
