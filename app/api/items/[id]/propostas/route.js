import { NextResponse } from 'next/server';
import { updateItemColumns, fetchItemColumnTexts, fetchItemFileColumnRaw } from '../../../../../lib/monday';
import { BOARD_ID, COLUMNS } from '../../../../../lib/config';
import { mapFileColumnFiles } from '../../../../../lib/transform';
import { parseRegistro, aplicarOperacao, visaoPropostas, sugerirAgrupamentos } from '../../../../../lib/propostas.js';
import { parseTrackingListTolerante } from '../../../../../lib/proposalTracking.js';
import { registrarNota, novaRef } from '../../../../../lib/estruturaServer';
import { hojeSP } from '../../../../../lib/tempo.js';
import { getSessao } from '../../../../../lib/sessao';

export const dynamic = 'force-dynamic';

function semColuna() {
  return NextResponse.json({ error: 'A coluna "Propostas — Registro (JSON)" ainda não foi criada neste ambiente. Rode scripts/criar-estrutura-oportunidades.mjs e configure MONDAY_COL_PROPOSTAS_REGISTRO (ver README).' }, { status: 409 });
}

async function carregar(itemId) {
  const [textos, raw] = await Promise.all([
    fetchItemColumnTexts(itemId, [COLUMNS.propostasRegistro, COLUMNS.rastreioPropostas]),
    COLUMNS.propostas ? fetchItemFileColumnRaw(itemId, COLUMNS.propostas) : { files: [] },
  ]);
  const arquivos = mapFileColumnFiles(raw);
  const registro = parseRegistro(textos[COLUMNS.propostasRegistro]);
  const rastreio = parseTrackingListTolerante(textos[COLUMNS.rastreioPropostas]);
  return { arquivos, registro, rastreio };
}

function paraResposta({ arquivos, registro, rastreio }) {
  const visao = visaoPropostas(registro, arquivos, rastreio.lista);
  const { vinculados, ...visaoJson } = visao;
  const sugestoes = sugerirAgrupamentos(arquivos, vinculados, visao.docs);
  return { ...visaoJson, arquivos, sugestoes, rastreioTruncado: rastreio.truncado };
}

export async function GET(request, { params }) {
  try {
    if (!COLUMNS.propostasRegistro) return semColuna();
    return NextResponse.json(paraResposta(await carregar(Number(params.id))));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Aplica UMA operação ao registro de propostas (registrar, nova_revisao,
// atualizar, vigente, aceitar, remover). Só classifica o que já está anexado:
// nunca apaga arquivo, nunca altera o valor estimado da oportunidade e nunca
// presume que o arquivo mais recente foi enviado/aceito.
export async function POST(request, { params }) {
  try {
    if (!COLUMNS.propostasRegistro) return semColuna();
    const body = await request.json();
    if (body.expectedRev === undefined || body.expectedRev === null) {
      return NextResponse.json({ error: 'Recarregue a tela de propostas (revisão não informada).' }, { status: 400 });
    }
    const sessao = await getSessao(request);
    const itemId = Number(params.id);
    const estado = await carregar(itemId);
    const r = aplicarOperacao(estado.registro, body.op || {}, {
      expectedRev: body.expectedRev,
      autor: sessao?.name,
      agora: new Date().toISOString(),
      hoje: hojeSP(),
      assetsAtuais: new Set(estado.arquivos.map((a) => a.assetId)),
    });
    if (r.conflito) {
      return NextResponse.json({ conflito: true, error: 'Outra pessoa alterou as propostas desta oportunidade enquanto você editava. A lista foi recarregada.', ...paraResposta(estado) }, { status: 409 });
    }
    if (r.erro) return NextResponse.json({ error: r.erro }, { status: 400 });
    if (r.semAlteracao) {
      // Mesmo envio registrado de novo (duplo clique, retry): nada é gravado.
      return NextResponse.json({ ok: true, semAlteracao: true, aviso: 'Este envio já estava registrado nessa data (nada alterado).', efeitos: [], notaRegistrada: true, ...paraResposta(estado) });
    }

    await updateItemColumns(BOARD_ID, itemId, { [COLUMNS.propostasRegistro]: r.texto });
    const nota = await registrarNota(itemId, [`📑 ${r.nota} (${sessao?.name || 'alguém'})`], novaRef());
    const novo = await carregar(itemId);
    return NextResponse.json({ ok: true, efeitos: r.efeitos, notaRegistrada: nota.ok, ...paraResposta(novo) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
