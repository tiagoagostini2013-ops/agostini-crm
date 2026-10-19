import { NextResponse } from 'next/server';
import { updateItemColumns, addItemNote } from '../../../../../lib/monday';
import { BOARD_ID, COLUMNS, TRILHA_NOVA_COLUNA_TITULO } from '../../../../../lib/config';
import {
  aplicarAcaoNoPlano,
  serializarPlanoAcao,
  TRILHA_CAMPO_DATA,
  TRILHA_LABEL,
  CANAIS_ATIVIDADE,
  CANAL_INTERNO,
  RESULTADO_NOTA_MAX,
  RESULTADO_PLANO_MAX,
  ACAO_MAX,
  fmtDataBR,
} from '../../../../../lib/agenda.js';
import {
  validarTrilha,
  colunaDataDaTrilha,
  lerEstadoDoLead,
  lerAcaoDoCorpo,
  hojeISO,
  mensagemColunaAusente,
} from '../../../../../lib/acoes';

export const dynamic = 'force-dynamic';

// REGISTRAR UMA ATIVIDADE REALIZADA (concluir a ação planejada e agendar o
// próximo passo). É aqui — e não numa simples edição do cadastro — que um
// contato com o cliente passa a "valer":
//   - contatoRealizado = true  → carimba "Último contato" (e "Primeiro
//     contato" se for o primeiro). Tentativa sem resposta e atividade
//     interna ficam no histórico mas NÃO contam como contato.
//   - editar campos do lead, mexer no plano ou escrever uma anotação marcada
//     como interna nunca carimba contato.
//
// O que a rota grava, numa só mutação (change_multiple_column_values) mais
// uma atualização de histórico no monday (a mesma área das "Anotações"):
//   plano de ação → próximo passo da trilha (ou limpa, se não houver) + resumo
//                   do último resultado;
//   data da trilha → data do próximo passo (ou limpa);
//   último contato → só se houve contato efetivo.
// Histórico completo fica nas atualizações do monday (sem limite de tamanho);
// o JSON guarda só o último resultado, pra a coluna nunca estourar.
export async function POST(request, { params }) {
  try {
    const body = await request.json();
    const trilha = validarTrilha(body.trilha);
    if (!trilha) return NextResponse.json({ error: 'Trilha inválida.' }, { status: 400 });

    const resultado = String(body.resultado || '').trim();
    if (!resultado) {
      return NextResponse.json({ error: 'Registre o resultado da atividade (o que aconteceu).' }, { status: 400 });
    }
    if (resultado.length > RESULTADO_NOTA_MAX) {
      return NextResponse.json({ error: `O resultado pode ter no máximo ${RESULTADO_NOTA_MAX} caracteres.` }, { status: 400 });
    }
    const canal = CANAIS_ATIVIDADE.includes(body.canal) ? body.canal : null;
    if (!canal) return NextResponse.json({ error: 'Escolha o canal da atividade.' }, { status: 400 });
    if (typeof body.contatoRealizado !== 'boolean') {
      return NextResponse.json({ error: 'Informe se houve contato efetivo com o cliente.' }, { status: 400 });
    }
    // Atividade interna nunca é contato com o cliente, mesmo que o front mande true.
    const contatoRealizado = canal === CANAL_INTERNO ? false : body.contatoRealizado;
    const concluiuAcao = body.concluiuAcaoPlanejada !== false;

    let proximo = { acao: null, data: null };
    if (concluiuAcao) {
      proximo = lerAcaoDoCorpo(body.proximoPasso);
      if (proximo.erro) return NextResponse.json({ error: proximo.erro }, { status: 400 });
      if (proximo.acao && proximo.acao.acao.length > ACAO_MAX) {
        return NextResponse.json({ error: `O próximo passo pode ter no máximo ${ACAO_MAX} caracteres.` }, { status: 400 });
      }
    }

    const colData = colunaDataDaTrilha(trilha);
    const faltando = [];
    if (!COLUMNS.planoAcao) faltando.push('Plano de Ação (JSON)');
    if (!colData) faltando.push(TRILHA_NOVA_COLUNA_TITULO[trilha]);
    if (faltando.length) return NextResponse.json({ error: mensagemColunaAusente(faltando) }, { status: 409 });

    const itemId = Number(params.id);
    const hoje = hojeISO();
    const { plano: planoAtual, ultimoContatoTexto } = await lerEstadoDoLead(itemId);

    let plano = planoAtual;
    if (concluiuAcao) {
      const r = aplicarAcaoNoPlano(planoAtual, trilha, proximo.acao, {
        expectedRev: body.expectedRev,
        autor: body.autor,
      });
      if (r.conflito) {
        return NextResponse.json(
          {
            conflito: true,
            atual: r.atual,
            error: `Outra pessoa alterou a ação deste lead${r.atual?.atualizadoPor ? ` (${r.atual.atualizadoPor})` : ''} enquanto você registrava. Clique em ↻ Atualizar e reabra o lead para ver o valor atual.`,
          },
          { status: 409 }
        );
      }
      plano = r.plano;
    }
    plano = {
      ...plano,
      ultimoResultado: {
        data: hoje,
        trilha,
        contatoRealizado,
        canal,
        resumo: resultado.replace(/\s+/g, ' ').slice(0, RESULTADO_PLANO_MAX),
        autor: body.autor || null,
      },
    };

    const columnValues = { [COLUMNS.planoAcao]: serializarPlanoAcao(plano) };
    if (concluiuAcao) columnValues[colData] = proximo.data ? { date: proximo.data } : null;
    if (contatoRealizado && COLUMNS.ultimoContato) {
      columnValues[COLUMNS.ultimoContato] = { date: hoje };
      if (!ultimoContatoTexto) columnValues[COLUMNS.dataPrimeiroContato] = { date: hoje };
    }
    await updateItemColumns(BOARD_ID, itemId, columnValues);

    // Histórico legível no monday (mesma lista das "Anotações" do lead). Se só
    // isto falhar, a atividade já está salva — avisa sem desfazer.
    const linhas = [
      `✅ Atividade registrada por ${body.autor || 'alguém'} — ${TRILHA_LABEL[trilha]}`,
      `Canal: ${canal} · Contato efetivo com o cliente: ${contatoRealizado ? 'sim' : 'não'}`,
    ];
    const planejada = String(body.acaoConcluida || '').replace(/\s+/g, ' ').trim().slice(0, ACAO_MAX);
    if (planejada) linhas.push(`Ação planejada: ${planejada}`);
    linhas.push(`Resultado: ${resultado}`);
    if (concluiuAcao) {
      if (proximo.acao || proximo.data) {
        const quem = String(body.proximoPasso?.responsavelNome || '').trim();
        linhas.push(
          `Próximo passo: ${proximo.acao?.acao || '(sem descrição)'}${quem ? ` — ${quem}` : ''}${proximo.data ? ` — ${fmtDataBR(proximo.data)}` : ''}${proximo.acao?.compromissoCliente ? ' — combinado com o cliente' : ''}`
        );
      } else {
        linhas.push('Próximo passo: nenhum agendado.');
      }
    }
    let notaRegistrada = true;
    try {
      await addItemNote(itemId, linhas.join('\n'));
    } catch {
      notaRegistrada = false;
    }

    return NextResponse.json({
      ok: true,
      planoAcao: plano,
      campoData: TRILHA_CAMPO_DATA[trilha],
      data: concluiuAcao ? proximo.data || null : undefined,
      ultimoContato: contatoRealizado ? hoje : null,
      notaRegistrada,
      textoHistorico: linhas.join('\n'),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
