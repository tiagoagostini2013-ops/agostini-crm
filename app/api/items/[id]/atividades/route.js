import { NextResponse } from 'next/server';
import { updateItemColumns, fetchItemColumnTexts } from '../../../../../lib/monday';
import { BOARD_ID, COLUMNS, TRILHA_NOVA_COLUNA_TITULO } from '../../../../../lib/config';
import {
  aplicarAcaoNoPlano,
  serializarPlanoAcao,
  parsePlanoAcao,
  TRILHA_CAMPO_DATA,
  TRILHA_LABEL,
  CANAIS_ATIVIDADE,
  CANAL_INTERNO,
  RESULTADO_NOTA_MAX,
  RESULTADO_PLANO_MAX,
  ACAO_MAX,
  fmtDataBR,
} from '../../../../../lib/agenda.js';
import { validarTrilha, colunaDataDaTrilha, lerAcaoDoCorpo, mensagemColunaAusente } from '../../../../../lib/acoes';
import { hojeSP, dataSP, fmtDataHoraSP, localSPParaISO, ehDiaUtil, proximoDiaUtilOuIgual, agoraLocalSP } from '../../../../../lib/tempo.js';
import { refValida, refJaRegistrada, travar, soltar, registrarNota } from '../../../../../lib/estruturaServer';
import { getSessao } from '../../../../../lib/sessao';
import { carregarConfig } from '../../../../../lib/automacaoServer';

export const dynamic = 'force-dynamic';

// REGISTRAR UM ATENDIMENTO (v2) — concluir a ação planejada, anotar o resultado
// e agendar o próximo passo, num só formulário (reaproveita o da v1).
//
// Regras que esta rota garante (nenhuma depende só da tela):
//  - Autor = usuário da SESSÃO (o monday sempre registra o dono do token).
//  - Contato efetivo × tentativa sem resposta × interno: só "efetivo" mexe em
//    "Último contato"/"Primeiro contato". Tentativa e interno ficam só no
//    histórico. A data só AVANÇA (registrar algo antigo nunca recua o contato).
//  - "Quando aconteceu" é informado (padrão: agora, horário de Brasília) e fica
//    separado de "quando foi registrado" (data do update no monday).
//  - Idempotência: `requestId` vira "Ref:" no histórico; repetição (duplo clique,
//    retry) não grava de novo.
//  - Ação planejada só é dada como concluída quando a pessoa diz que foi; em
//    vendas, concluir sem próximo passo exige confirmação explícita (pendência).
//  - Data combinada com o cliente (compromisso) ainda no futuro não é
//    substituída sem confirmação; data fora de dia útil também pede confirmação.
//  - Falha ao gravar no monday = erro (nunca "sucesso" falso). Se só a nota de
//    histórico falhar, avisa e devolve o texto para tentar de novo.
export async function POST(request, { params }) {
  let chaveTrava = null;
  try {
    const body = await request.json();
    const sessao = await getSessao(request);
    const autor = sessao?.name || String(body.autor || '').trim() || 'alguém';

    const trilha = validarTrilha(body.trilha);
    if (!trilha) return NextResponse.json({ error: 'Trilha inválida.' }, { status: 400 });
    if (!refValida(body.requestId)) {
      return NextResponse.json({ error: 'Pedido sem identificador (requestId). Recarregue a página e tente de novo.' }, { status: 400 });
    }

    const resultado = String(body.resultado || '').trim();
    if (!resultado) return NextResponse.json({ error: 'Registre o resultado do atendimento (o que aconteceu).' }, { status: 400 });
    if (resultado.length > RESULTADO_NOTA_MAX) {
      return NextResponse.json({ error: `O resultado pode ter no máximo ${RESULTADO_NOTA_MAX} caracteres.` }, { status: 400 });
    }
    const canal = CANAIS_ATIVIDADE.includes(body.canal) ? body.canal : null;
    if (!canal) return NextResponse.json({ error: 'Escolha o canal do atendimento.' }, { status: 400 });
    if (typeof body.contatoRealizado !== 'boolean') {
      return NextResponse.json({ error: 'Informe se houve contato efetivo ou foi tentativa sem resposta.' }, { status: 400 });
    }
    const contatoRealizado = canal === CANAL_INTERNO ? false : body.contatoRealizado;
    const concluiuAcao = body.concluiuAcaoPlanejada !== false;

    // Quando aconteceu (relógio de Brasília). Padrão: agora.
    const agora = new Date();
    const ocorreuLocal = body.ocorreuEm ? String(body.ocorreuEm) : agoraLocalSP(agora);
    const ocorreuISO = localSPParaISO(ocorreuLocal);
    if (!ocorreuISO) return NextResponse.json({ error: 'Data/hora do atendimento inválida.' }, { status: 400 });
    const ocorreuMs = new Date(ocorreuISO).getTime();
    if (ocorreuMs > agora.getTime() + 5 * 60 * 1000) {
      return NextResponse.json({ error: 'O atendimento não pode ter acontecido no futuro. Corrija a data/hora (ou use "Agendar próximo passo").' }, { status: 400 });
    }
    if (ocorreuMs < agora.getTime() - 370 * 86400000) {
      return NextResponse.json({ error: 'Data do atendimento antiga demais (mais de um ano).' }, { status: 400 });
    }
    const dataOcorrencia = dataSP(ocorreuISO);
    const hoje = hojeSP(agora);

    let proximo = { acao: null, data: null };
    if (concluiuAcao) {
      proximo = lerAcaoDoCorpo(body.proximoPasso);
      if (proximo.erro) return NextResponse.json({ error: proximo.erro }, { status: 400 });
      if (proximo.acao && proximo.acao.acao.length > ACAO_MAX) {
        return NextResponse.json({ error: `O próximo passo pode ter no máximo ${ACAO_MAX} caracteres.` }, { status: 400 });
      }
      if (proximo.data && proximo.data < hoje) {
        return NextResponse.json({ error: 'A data do próximo passo não pode estar no passado.' }, { status: 400 });
      }
    }

    const colData = colunaDataDaTrilha(trilha);
    const faltando = [];
    if (!COLUMNS.planoAcao) faltando.push('Plano de Ação (JSON)');
    if (!colData) faltando.push(TRILHA_NOVA_COLUNA_TITULO[trilha]);
    if (faltando.length) return NextResponse.json({ error: mensagemColunaAusente(faltando) }, { status: 409 });

    // Feriados extras configurados pelo administrador (além dos nacionais).
    const feriadosExtras = (await carregarConfig()).config.feriadosExtras;

    const itemId = Number(params.id);
    chaveTrava = `atv:${itemId}:${body.requestId}`;
    if (!travar(chaveTrava)) {
      chaveTrava = null;
      return NextResponse.json({ ok: true, duplicado: true, aviso: 'Este registro já está sendo processado.' });
    }
    if (await refJaRegistrada(itemId, body.requestId)) {
      return NextResponse.json({ ok: true, duplicado: true, aviso: 'Este atendimento já havia sido registrado (repetição ignorada).' });
    }

    const textos = await fetchItemColumnTexts(itemId, [COLUMNS.planoAcao, COLUMNS.ultimoContato, COLUMNS.dataPrimeiroContato, colData]);
    const planoAtual = parsePlanoAcao(textos[COLUMNS.planoAcao]);
    const ultimoContatoAtual = (textos[COLUMNS.ultimoContato] || '').slice(0, 10) || null;
    const dataAtualTrilha = (textos[colData] || '').slice(0, 10) || null;

    if (concluiuAcao) {
      // Concluir sem próximo passo em vendas deixa a oportunidade sem ação: só com confirmação.
      if (trilha === 'vendas' && !proximo.acao && !proximo.data && body.confirmaSemProximoPasso !== true) {
        return NextResponse.json(
          { codigo: 'sem_proximo_passo', error: 'A oportunidade ficaria sem próximo passo. Defina a próxima ação e a data, ou confirme que deseja registrar sem próximo passo (ela será sinalizada como pendente).' },
          { status: 409 }
        );
      }
      // Data combinada com o cliente que ainda não chegou não é trocada em silêncio.
      const comp = planoAtual[trilha]?.compromissoCliente && dataAtualTrilha && dataAtualTrilha > hoje;
      if (comp && (proximo.data || null) !== dataAtualTrilha && body.confirmaSubstituirCompromisso !== true) {
        return NextResponse.json(
          { codigo: 'compromisso_cliente', dataAtual: dataAtualTrilha, error: `A ação planejada estava combinada com o cliente para ${fmtDataBR(dataAtualTrilha)} e essa data ainda não chegou. Confirme que o combinado mudou para substituir.` },
          { status: 409 }
        );
      }
      // Fora de dia útil: só passa com confirmação (a menos que seja compromisso do cliente).
      if (proximo.data && !ehDiaUtil(proximo.data, feriadosExtras) && !proximo.acao?.compromissoCliente && body.confirmaDiaNaoUtil !== true) {
        return NextResponse.json(
          { codigo: 'dia_nao_util', sugestao: proximoDiaUtilOuIgual(proximo.data, feriadosExtras), error: `${fmtDataBR(proximo.data)} não é dia útil (fim de semana ou feriado). Escolha o próximo dia útil (${fmtDataBR(proximoDiaUtilOuIgual(proximo.data, feriadosExtras))}) ou confirme esta data.` },
          { status: 409 }
        );
      }
    }

    let plano = planoAtual;
    if (concluiuAcao) {
      const r = aplicarAcaoNoPlano(planoAtual, trilha, proximo.acao, { expectedRev: body.expectedRev, autor });
      if (r.conflito) {
        return NextResponse.json(
          { conflito: true, atual: r.atual, error: `Outra pessoa alterou a ação deste lead${r.atual?.atualizadoPor ? ` (${r.atual.atualizadoPor})` : ''} enquanto você registrava. Clique em ↻ Atualizar e reabra o lead para ver o valor atual.` },
          { status: 409 }
        );
      }
      plano = r.plano;
    }
    plano = {
      ...plano,
      ultimoResultado: {
        data: dataOcorrencia,
        trilha,
        contatoRealizado,
        canal,
        resumo: resultado.replace(/\s+/g, ' ').slice(0, RESULTADO_PLANO_MAX),
        autor,
      },
    };

    const columnValues = { [COLUMNS.planoAcao]: serializarPlanoAcao(plano) };
    if (concluiuAcao) columnValues[colData] = proximo.data ? { date: proximo.data } : null;
    // Só contato EFETIVO mexe no último contato — e a data só avança.
    let ultimoContatoNovo = null;
    if (contatoRealizado && COLUMNS.ultimoContato && (!ultimoContatoAtual || dataOcorrencia > ultimoContatoAtual)) {
      columnValues[COLUMNS.ultimoContato] = { date: dataOcorrencia };
      ultimoContatoNovo = dataOcorrencia;
    }
    if (contatoRealizado && COLUMNS.dataPrimeiroContato && !textos[COLUMNS.dataPrimeiroContato] && !ultimoContatoAtual) {
      columnValues[COLUMNS.dataPrimeiroContato] = { date: dataOcorrencia };
    }
    try {
      await updateItemColumns(BOARD_ID, itemId, columnValues);
    } catch (err) {
      return NextResponse.json({ error: `Não foi possível gravar no monday.com — nada foi registrado. (${err.message})`, gravado: false }, { status: 502 });
    }

    const planejada = String(body.acaoConcluida || '').replace(/\s+/g, ' ').trim().slice(0, ACAO_MAX);
    const linhas = [
      `✅ Atendimento registrado por ${autor} — ${TRILHA_LABEL[trilha]}`,
      `Quando: ${fmtDataHoraSP(ocorreuISO)}`,
      `Canal: ${canal} · Contato efetivo com o cliente: ${contatoRealizado ? 'sim' : 'não'}`,
    ];
    if (planejada) linhas.push(`Ação planejada: ${planejada} (${concluiuAcao ? 'concluída' : 'mantida, não concluída'})`);
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
    } else {
      linhas.push('Próximo passo: ação planejada mantida.');
    }
    const nota = await registrarNota(itemId, linhas, body.requestId);

    return NextResponse.json({
      ok: true,
      planoAcao: plano,
      campoData: TRILHA_CAMPO_DATA[trilha],
      data: concluiuAcao ? proximo.data || null : undefined,
      ultimoContato: ultimoContatoNovo,
      contatoEfetivo: contatoRealizado,
      pendencia: concluiuAcao && trilha === 'vendas' && !proximo.acao && !proximo.data ? 'sem_proximo_passo' : null,
      notaRegistrada: nota.ok,
      textoHistorico: nota.texto,
      avisoNota: nota.ok ? undefined : `O atendimento foi gravado, mas o texto do histórico não (${nota.erro}). Use "Tentar gravar histórico de novo".`,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (chaveTrava) soltar(chaveTrava);
  }
}
