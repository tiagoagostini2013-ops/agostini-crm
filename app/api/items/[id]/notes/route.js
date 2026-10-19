import { NextResponse } from 'next/server';
import { fetchItemNotes, addItemNote, fetchItemColumnText, updateItemColumns } from '../../../../../lib/monday';
import { COLUMNS, BOARD_ID } from '../../../../../lib/config';
import { refJaRegistrada } from '../../../../../lib/estruturaServer';
import { hojeSP } from '../../../../../lib/tempo.js';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const notes = await fetchItemNotes(Number(params.id));
    return NextResponse.json({ notes });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Registrar uma anotação é evidência de que o vendedor acabou de ter contato
// com o cliente — pedido do Tiago em 21/08/2026, depois de reparar que
// escrever uma anotação não atualizava mais nada no lead. Carimba "Data
// Último Contato" com hoje automaticamente, e "Data Primeiro Contato" (Fase
// 7) também, se for a primeira vez que esse lead recebe alguma data de
// contato (mesma regra já aplicada quando o vendedor preenche esse campo à
// mão — ver app/api/items/[id]/route.js).
//
// De propósito só isso: "Próximo follow-up" continua exigindo uma decisão do
// vendedor (quando ele quer voltar a falar com o cliente não é algo que dê
// pra adivinhar), então esse campo não é tocado aqui — o LeadDrawer mostra um
// atalho pra definir isso logo depois de salvar a anotação, mas não é
// automático.
export async function POST(request, { params }) {
  try {
    const { text, contato } = await request.json();
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Escreva algo antes de salvar.' }, { status: 400 });
    }
    const itemId = Number(params.id);
    // Reenvio do texto de histórico de um atendimento cuja nota falhou: a "Ref:"
    // impede gravar duas vezes. Esse reenvio nunca mexe em "Último contato"
    // (o atendimento já tratou disso).
    const refM = /^Ref: (\S+)\s*$/m.exec(text);
    if (refM && (await refJaRegistrada(itemId, refM[1]))) {
      return NextResponse.json({ ok: true, duplicado: true, ultimoContato: null });
    }
    await addItemNote(itemId, text.trim());
    if (refM) return NextResponse.json({ ok: true, ultimoContato: null });

    // `contato: false` = anotação INTERNA (ex: lembrete, contexto, comentário
    // pra equipe) — fica no histórico mas não carimba "Último contato", pra
    // diferenciar contato efetivo com o cliente de simples registro. Sem o
    // campo (ou true) o comportamento de sempre é mantido (pedido de 21/08).
    const hoje = hojeSP();
    let ultimoContato = null;
    if (contato === false) {
      return NextResponse.json({ ok: true, ultimoContato: null });
    }
    try {
      const columnValues = { [COLUMNS.ultimoContato]: { date: hoje } };
      const contatoAtual = await fetchItemColumnText(itemId, COLUMNS.ultimoContato);
      if (!contatoAtual) {
        columnValues[COLUMNS.dataPrimeiroContato] = { date: hoje };
      }
      await updateItemColumns(BOARD_ID, itemId, columnValues);
      ultimoContato = hoje;
    } catch {
      // A anotação já foi salva com sucesso — se só o carimbo de contato
      // falhar, não vira erro pro vendedor (best-effort).
    }

    return NextResponse.json({ ok: true, ultimoContato });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
