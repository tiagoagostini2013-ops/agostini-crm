import { NextResponse } from 'next/server';
import { updateItemColumns } from '../../../../../lib/monday';
import { BOARD_ID, COLUMNS, TRILHA_NOVA_COLUNA_TITULO } from '../../../../../lib/config';
import { getSessao } from '../../../../../lib/sessao';
import { hojeSP, fmtDataHoraSP } from '../../../../../lib/tempo.js';
import { fmtDataBR, serializarPlanoAcao, parsePlanoAcao, getAcao, TRILHA_CAMPO_DATA } from '../../../../../lib/agenda.js';
import { avaliarItem, validarAceite, aplicarAceite, registrarDecisao, decisaoDaChave, ehResponsavel, ORIGENS } from '../../../../../lib/automacao.js';
import { carregarConfig, carregarLead, escopoDaSessao } from '../../../../../lib/automacaoServer';
import { refValida, refJaRegistrada, travar, soltar, registrarNota } from '../../../../../lib/estruturaServer';
import { mensagemColunaAusente } from '../../../../../lib/acoes';

export const dynamic = 'force-dynamic';

const STATUS_POR_CODIGO = { obsoleta: 409, estagnada: 409, compromisso_cliente: 409, substituir: 409, dia_nao_util: 409, dado_invalido: 400 };

// ACEITAR (com ou sem ajuste) ou DISPENSAR uma sugestão de uma oportunidade.
//
// Garantias desta rota (nenhuma depende só da tela):
//  - Antes de qualquer gravação o lead é RELIDO do monday e a sugestão é recalculada
//    com os dados frescos. Se ela não se aplica mais → 409 "obsoleta"; se a ação da
//    trilha foi criada/alterada desde que a sugestão foi gerada (`impressao`) → 409
//    "estagnada". Sugestão velha nunca sobrescreve ação mais recente.
//  - Compromisso combinado com o cliente e ação já existente só são trocados com
//    confirmação explícita; dia não útil também.
//  - Idempotente: decisão já registrada para a chave → devolve ok/duplicado, sem
//    gravar de novo (duplo clique, retry, evento repetido). `requestId` vira a
//    "Ref:" da nota de histórico.
//  - Autor vem da SESSÃO. Quem não é admin só decide nas suas oportunidades.
//  - Falha ao gravar no monday = erro com `gravado:false`; nunca "sucesso" falso.
//    Se só a nota de histórico falhar, avisa (notaRegistrada:false).
//  - Aceitar NÃO é realizar: cria a ação agendada, com origem "Criada a partir de
//    sugestão aceita"; ela só vira feita pelo registro de atendimento.
//  - NENHUMA mensagem é enviada ao cliente.
export async function POST(request, { params }) {
  let travada = null;
  try {
    const body = await request.json();
    const sessao = await getSessao(request);
    const escopo = await escopoDaSessao(sessao);
    if (escopo.erro) return NextResponse.json({ error: escopo.erro }, { status: escopo.status });
    const autor = sessao?.name || 'alguém';

    if (!refValida(body.requestId)) {
      return NextResponse.json({ error: 'Pedido sem identificador (requestId). Recarregue a página e tente de novo.' }, { status: 400 });
    }
    const decisao = body.decisao === 'dispensar' ? 'dispensar' : body.decisao === 'aceitar' ? 'aceitar' : null;
    if (!decisao) return NextResponse.json({ error: 'Decisão inválida (aceitar ou dispensar).' }, { status: 400 });
    const chave = String(body.chave || '');
    if (!/^[A-F]\.[A-Za-z0-9._-]{1,50}$/.test(chave)) return NextResponse.json({ error: 'Sugestão inválida.' }, { status: 400 });

    const cfgInfo = await carregarConfig();
    const { config } = cfgInfo;
    if (!config.ativo) return NextResponse.json({ codigo: 'regra_desativada', error: 'A automação está desativada pelo administrador.' }, { status: 409 });
    if (!config.regras[chave[0]]) return NextResponse.json({ codigo: 'regra_desativada', error: `A regra ${chave[0]} está desativada pelo administrador.` }, { status: 409 });

    const itemId = Number(params.id);
    travada = `sg:${itemId}`;
    if (!travar(travada)) {
      travada = null;
      return NextResponse.json({ ok: true, duplicado: true, aviso: 'Outra decisão para esta oportunidade está sendo processada.' });
    }
    if (await refJaRegistrada(itemId, body.requestId)) {
      return NextResponse.json({ ok: true, duplicado: true, aviso: 'Esta decisão já havia sido registrada (repetição ignorada).' });
    }

    const lead = await carregarLead(itemId);
    if (!lead) return NextResponse.json({ error: 'Oportunidade não encontrada.' }, { status: 404 });
    if (!escopo.admin && !(escopo.mondayUserId && ehResponsavel(lead, escopo.mondayUserId))) {
      return NextResponse.json({ error: 'Você só pode decidir sugestões das oportunidades em que é responsável.' }, { status: 403 });
    }
    const jaDecidida = decisaoDaChave(lead.planoAcao, chave);
    if (jaDecidida) {
      return NextResponse.json({ ok: true, duplicado: true, aviso: jaDecidida === 'a' ? 'Esta sugestão já havia sido aceita.' : 'Esta sugestão já havia sido dispensada.', planoAcao: lead.planoAcao });
    }

    const hoje = hojeSP();
    const avaliada = avaliarItem(lead, config, { hoje });
    const sugestao = avaliada.sugestoes.find((s) => s.chave === chave) || null;
    const trilha = sugestao?.trilha || null;

    const faltando = [];
    if (!COLUMNS.planoAcao) faltando.push('Plano de Ação (JSON)');
    if (decisao === 'aceitar' && trilha && !COLUMNS[TRILHA_CAMPO_DATA[trilha]]) faltando.push(TRILHA_NOVA_COLUNA_TITULO[trilha]);
    if (faltando.length) return NextResponse.json({ error: mensagemColunaAusente(faltando) }, { status: 409 });

    const agora = new Date().toISOString();

    // ---------------------------------------------------------------- dispensar
    if (decisao === 'dispensar') {
      if (!sugestao) return NextResponse.json({ codigo: 'obsoleta', error: 'Esta sugestão não se aplica mais. Atualize a lista.' }, { status: 409 });
      const r = registrarDecisao(lead.planoAcao, chave, 'd', hoje);
      if (r.erro) return NextResponse.json({ error: r.erro }, { status: 409 });
      try {
        await updateItemColumns(BOARD_ID, itemId, { [COLUMNS.planoAcao]: r.texto });
      } catch (err) {
        return NextResponse.json({ error: `Não foi possível gravar no monday.com — nada foi registrado. (${err.message})`, gravado: false }, { status: 502 });
      }
      const motivo = String(body.motivo || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const nota = await registrarNota(itemId, [
        `🤖 Sugestão dispensada por ${autor} — ${sugestao.regraNome} (regra ${sugestao.regra})`,
        `Sugestão: ${sugestao.titulo}`,
        ...(motivo ? [`Motivo informado: ${motivo}`] : []),
        'Não será apresentada de novo até haver um novo evento relevante.',
      ], body.requestId);
      return NextResponse.json({ ok: true, decisao: 'dispensada', planoAcao: r.plano, notaRegistrada: nota.ok, textoHistorico: nota.texto, avisoNota: nota.ok ? undefined : `A dispensa foi gravada, mas o texto do histórico não (${nota.erro}).` });
    }

    // ------------------------------------------------------------------ aceitar
    const v = validarAceite({
      item: lead,
      sugestao,
      impressaoVista: body.impressao,
      ajuste: body.ajuste || {},
      confirma: { substituir: body.confirma?.substituir === true, substituirCompromisso: body.confirma?.substituirCompromisso === true, diaNaoUtil: body.confirma?.diaNaoUtil === true },
      cfg: config,
      hoje,
    });
    if (!v.ok) {
      const { erro, codigo, ...resto } = v;
      return NextResponse.json({ codigo, error: erro, ...resto }, { status: STATUS_POR_CODIGO[codigo] || 409 });
    }
    const revAtual = getAcao(lead, sugestao.trilha).rev;
    const ap = aplicarAceite(lead.planoAcao, sugestao, v, { autor, agora, expectedRev: revAtual, hoje });
    if (ap.conflito) return NextResponse.json({ codigo: 'estagnada', error: 'Outra pessoa alterou a ação desta oportunidade agora há pouco. Atualize a lista e confira.' }, { status: 409 });
    if (ap.erro) return NextResponse.json({ error: ap.erro }, { status: 409 });

    const colData = COLUMNS[TRILHA_CAMPO_DATA[sugestao.trilha]];
    try {
      await updateItemColumns(BOARD_ID, itemId, { [COLUMNS.planoAcao]: ap.texto, [colData]: { date: v.data } });
    } catch (err) {
      return NextResponse.json({ error: `Não foi possível gravar no monday.com — nada foi registrado. (${err.message})`, gravado: false }, { status: 502 });
    }

    const n = v.nova;
    const origemFinal = n.compromissoCliente ? ORIGENS.cliente : ORIGENS.sugestao;
    const linhas = [
      `🤖 Sugestão aceita por ${autor} — ${sugestao.regraNome} (regra ${sugestao.regra})`,
      `Origem: ${ORIGENS.regra} → ${origemFinal}${v.ajustada ? ' (ajustada por quem aceitou)' : ''}`,
      `Motivo da sugestão: ${sugestao.justificativa.slice(0, 700)}`,
      `Ação agendada (ainda não realizada): ${n.acao} — ${fmtDataBR(v.data)}${n.hora ? ` às ${n.hora} (lembrete interno do CRM)` : ''}${n.compromissoCliente ? ' — combinado com o cliente' : ''}`,
      `Evento de origem: ${sugestao.evento.rotulo}${sugestao.evento.data ? ` em ${fmtDataBR(sugestao.evento.data)}` : ''} · Registrado em ${fmtDataHoraSP(agora)}`,
    ];
    if (v.substituiu) linhas.push(`Substituiu: ${v.substituiu.acao || '(sem texto)'}${v.substituiu.data ? ` — ${fmtDataBR(v.substituiu.data)}` : ''}${v.substituiu.compromissoCliente ? ' — combinada com o cliente (substituição confirmada)' : ''}`);
    const nota = await registrarNota(itemId, linhas, body.requestId);

    return NextResponse.json({
      ok: true,
      decisao: 'aceita',
      planoAcao: ap.plano,
      campoData: TRILHA_CAMPO_DATA[sugestao.trilha],
      data: v.data,
      hora: n.hora || null,
      trilha: sugestao.trilha,
      notaRegistrada: nota.ok,
      textoHistorico: nota.texto,
      avisoNota: nota.ok ? undefined : `A ação foi gravada, mas o texto do histórico não (${nota.erro}).`,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (travada) soltar(travada);
  }
}
