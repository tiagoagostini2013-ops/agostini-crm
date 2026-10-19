import { NextResponse } from 'next/server';
import { updateItemColumns } from '../../../../../lib/monday';
import { BOARD_ID, COLUMNS, TRILHA_NOVA_COLUNA_TITULO } from '../../../../../lib/config';
import { aplicarAcaoNoPlano, serializarPlanoAcao, TRILHA_CAMPO_DATA, ACAO_MAX } from '../../../../../lib/agenda.js';
import {
  validarTrilha,
  colunaDataDaTrilha,
  lerEstadoDoLead,
  lerAcaoDoCorpo,
  mensagemColunaAusente,
} from '../../../../../lib/acoes';

export const dynamic = 'force-dynamic';

// Define (ou atualiza) a PRÓXIMA AÇÃO de uma trilha do lead: o que fazer,
// quem faz e quando. Não conta como contato com o cliente — editar o plano
// nunca carimba "Último contato" (ver /atividades, que é quem registra um
// contato de verdade).
//
// Onde fica cada coisa (ver lib/agenda.js):
//   data  → coluna nativa do monday da trilha (proximoFollowUp / dataReativacao
//           / proximoContatoPosVenda), pra o monday também enxergar;
//   ação + responsável + "combinado com o cliente" → JSON em planoAcao.
// Conflito: leitura-modificação-escrita com número de revisão por trilha. Se
// outra pessoa salvou a mesma trilha desde que esta tela foi aberta, responde
// 409 com o valor atual em vez de sobrescrever.
export async function PUT(request, { params }) {
  try {
    const body = await request.json();
    const trilha = validarTrilha(body.trilha);
    if (!trilha) return NextResponse.json({ error: 'Trilha inválida.' }, { status: 400 });

    const lido = lerAcaoDoCorpo(body);
    if (lido.erro) return NextResponse.json({ error: lido.erro }, { status: 400 });
    if (lido.acao && lido.acao.acao.length > ACAO_MAX) {
      return NextResponse.json({ error: `A ação pode ter no máximo ${ACAO_MAX} caracteres.` }, { status: 400 });
    }

    const colData = colunaDataDaTrilha(trilha);
    const faltando = [];
    if (!COLUMNS.planoAcao) faltando.push('Plano de Ação (JSON)');
    if (!colData) faltando.push(TRILHA_NOVA_COLUNA_TITULO[trilha]);
    if (faltando.length) return NextResponse.json({ error: mensagemColunaAusente(faltando) }, { status: 409 });

    const itemId = Number(params.id);
    const { plano } = await lerEstadoDoLead(itemId);
    const r = aplicarAcaoNoPlano(plano, trilha, lido.acao, {
      expectedRev: body.expectedRev,
      autor: body.autor,
    });
    if (r.conflito) {
      return NextResponse.json(
        {
          conflito: true,
          atual: r.atual,
          error: `Outra pessoa alterou esta ação${r.atual?.atualizadoPor ? ` (${r.atual.atualizadoPor})` : ''} enquanto você editava. Veja o valor atual (clique em ↻ Atualizar para ver também a data) e salve de novo se ainda fizer sentido.`,
        },
        { status: 409 }
      );
    }

    await updateItemColumns(BOARD_ID, itemId, {
      [COLUMNS.planoAcao]: serializarPlanoAcao(r.plano),
      [colData]: lido.data ? { date: lido.data } : null,
    });
    return NextResponse.json({
      ok: true,
      planoAcao: r.plano,
      campoData: TRILHA_CAMPO_DATA[trilha],
      data: lido.data || null,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
