import { NextResponse } from 'next/server';
import { updateItemColumns, fetchItemColumnText } from '../../../../lib/monday';
import { BOARD_ID, COLUMNS, STAGE_DATE_COLUMNS } from '../../../../lib/config';
import { buildColumnValues } from '../../../../lib/transform';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  try {
    const fields = await request.json();
    const columnValues = buildColumnValues(fields);

    // Carimba a data de hoje na coluna correspondente sempre que o PATCH
    // muda o estágio pra um dos estágios rastreados (Qualificado/Proposta
    // Enviada/Em Negociação/Fechado/Perdido) — usado pelo Dashboard
    // Gerencial (Fase 6) e pelas métricas de velocidade do funil (Fase 7)
    // sem depender do log de atividades do monday.com (que só existe daqui
    // pra frente de qualquer forma). O front-end só manda "estagio" no PATCH
    // quando ele realmente mudou (ver diff() em LeadDrawer.jsx e
    // handleDragEnd em Dashboard.jsx), então chegar aqui já significa que
    // uma transição de estágio aconteceu agora.
    const dateFieldKey = STAGE_DATE_COLUMNS[fields.estagio];
    if (dateFieldKey) {
      const today = new Date().toISOString().slice(0, 10);
      columnValues[COLUMNS[dateFieldKey]] = { date: today };
    }

    // Carimba a Data de Primeiro Contato (Fase 7) na primeira vez que o
    // vendedor preenche "Data Último Contato" pra este lead — busca o valor
    // atual antes de sobrescrever pra saber se já existia. Isso mede o
    // tempo real até o primeiro contato comercial, sem exigir nenhum passo
    // manual extra do vendedor (ele já preenche "Data Último Contato" como
    // parte do fluxo normal).
    if (fields.ultimoContato) {
      const contatoAtual = await fetchItemColumnText(Number(params.id), COLUMNS.ultimoContato);
      if (!contatoAtual) {
        columnValues[COLUMNS.dataPrimeiroContato] = { date: fields.ultimoContato };
      }
    }

    if (Object.keys(columnValues).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo para atualizar.' }, { status: 400 });
    }
    await updateItemColumns(BOARD_ID, Number(params.id), columnValues);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
