import { NextResponse } from 'next/server';
import { fetchUsers } from '../../../lib/monday';
import {
  STAGES,
  SEGMENTOS,
  CARGOS_DECISOR,
  CANAIS_ORIGEM,
  MOTIVOS_PERDA,
  TIPOS_CONTATO,
} from '../../../lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const users = await fetchUsers();
    return NextResponse.json({
      users,
      stages: STAGES,
      segmentos: SEGMENTOS,
      cargos: CARGOS_DECISOR,
      canais: CANAIS_ORIGEM,
      motivos: MOTIVOS_PERDA,
      tipos: TIPOS_CONTATO,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
