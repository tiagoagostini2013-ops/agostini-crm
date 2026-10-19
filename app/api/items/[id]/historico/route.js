import { NextResponse } from 'next/server';
import { fetchItemUpdates, fetchItemSnapshot } from '../../../../../lib/monday';
import { COLUMNS } from '../../../../../lib/config';
import { fetchAppUsers } from '../../../../../lib/users';
import { montarHistorico, ultimoContatoEfetivo, ultimaAtividade, atendimentoSemProximoPasso } from '../../../../../lib/historico.js';
import { parseTrackingListTolerante } from '../../../../../lib/proposalTracking.js';

export const dynamic = 'force-dynamic';

const CAMPOS_DATA = ['dataQualificacao', 'dataPropostaEnviada', 'dataNegociacao', 'dataFechamento', 'dataPerda', 'dataEntregaEfetiva', 'ultimoContato'];

// Histórico cronológico unificado da oportunidade (somente leitura): lê as
// atualizações do monday, o rastreio de propostas e os carimbos de estágio do
// próprio item, e devolve uma única lista sem duplicar o mesmo evento.
export async function GET(request, { params }) {
  try {
    const itemId = Number(params.id);
    const colunas = [COLUMNS.rastreioPropostas, ...CAMPOS_DATA.map((k) => COLUMNS[k])];
    const [{ updates, truncado }, snap, usuarios] = await Promise.all([
      fetchItemUpdates(itemId),
      fetchItemSnapshot(itemId, colunas),
      fetchAppUsers().then((u) => u.map((x) => x.name)).catch(() => []),
    ]);
    if (!snap) return NextResponse.json({ error: 'Oportunidade não encontrada.' }, { status: 404 });
    const item = { createdAt: snap.createdAt };
    for (const k of CAMPOS_DATA) item[k] = COLUMNS[k] ? snap.textos[COLUMNS[k]] : null;
    const rastreio = parseTrackingListTolerante(snap.textos[COLUMNS.rastreioPropostas]);
    const eventos = montarHistorico({ updates, rastreio: rastreio.lista, item, usuarios });
    return NextResponse.json({
      eventos,
      ultimoContatoEfetivo: ultimoContatoEfetivo(eventos, item.ultimoContato),
      ultimaAtividade: ultimaAtividade(eventos),
      atendimentoSemProximoPasso: atendimentoSemProximoPasso(eventos),
      truncado, // true = há mais de 600 atualizações; as mais antigas não foram lidas
      rastreioTruncado: rastreio.truncado,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
