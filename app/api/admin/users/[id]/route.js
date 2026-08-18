import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAdmin } from '../../../../../lib/admin-guard';
import { updateAppUser } from '../../../../../lib/users';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const guard = await requireAdmin(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await request.json().catch(() => ({}));
  const fields = {};

  if (body.password !== undefined) {
    if (!body.password || body.password.length < 4) {
      return NextResponse.json({ error: 'A senha precisa ter pelo menos 4 caracteres.' }, { status: 400 });
    }
    fields.senhaHash = await bcrypt.hash(body.password, 10);
  }
  if (body.admin !== undefined) fields.admin = !!body.admin;
  if (body.ativo !== undefined) fields.ativo = !!body.ativo;

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
  }

  try {
    await updateAppUser(Number(params.id), fields);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
