import { NextResponse } from 'next/server';
import { fetchUsers } from '../../../lib/monday';
import { fetchAppUsers } from '../../../lib/users';
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
    const [allUsers, appUsers] = await Promise.all([fetchUsers(), fetchAppUsers()]);

    // Só entra na lista de "responsável" (filtro do Kanban/Agenda e o
    // seletor ao criar/editar um lead) quem tem conta ativa no painel E está
    // vinculado a uma pessoa do monday.com em "Gerenciar usuários" — assim
    // gente de outros setores (PCP, almoxarifado, técnicos etc.) não aparece
    // mais nessas listas, mesmo tendo acesso ao monday.com.
    const salesMondayIds = new Set(
      appUsers.filter((u) => u.ativo && u.mondayUserId).map((u) => String(u.mondayUserId))
    );
    const users = allUsers.filter((u) => salesMondayIds.has(String(u.id)));

    return NextResponse.json({
      users,
      // Lista completa (todos os setores) — usada só para conseguir mostrar
      // o nome de quem já estava marcado como responsável em leads antigos,
      // mesmo que essa pessoa não esteja (ou não esteja mais) vinculada a
      // uma conta do painel.
      allUsers,
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
