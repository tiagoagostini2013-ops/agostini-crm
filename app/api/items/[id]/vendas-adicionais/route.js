import { NextResponse } from 'next/server';
import { fetchItemColumnText, updateItemColumns } from '../../../../../lib/monday';
import { COLUMNS, BOARD_ID } from '../../../../../lib/config';

export const dynamic = 'force-dynamic';

// Vendas recorrentes pra um cliente já fechado (ex: reposição de peças pro
// Lucas Andrade) — pedido do Tiago em 08/09/2026. Confirmado com ele: esse
// tipo de venda é direta (sem passar pela proposta/negociação do funil) e
// NÃO deveria virar um card novo no Kanban de vendas — só um registro
// vinculado ao próprio cliente. Por isso isto é uma lista JSON numa coluna
// (COLUMNS.vendasAdicionais), no mesmo princípio de "Contatos e Decisores"
// — leitura-modificação-escrita a cada POST, igual ao endpoint de
// anotações, pra não sobrescrever entradas que outra pessoa tenha
// adicionado entre a leitura e a escrita (ver notes/route.js).
function parseVendas(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function POST(request, { params }) {
  try {
    const { descricao, valor, data, registradoPor } = await request.json();
    const descricaoLimpa = String(descricao || '').trim();
    if (!descricaoLimpa) {
      return NextResponse.json({ error: 'Descreva o que foi vendido.' }, { status: 400 });
    }
    const valorNum = valor === '' || valor === undefined || valor === null ? null : Number(valor);
    if (valorNum !== null && Number.isNaN(valorNum)) {
      return NextResponse.json({ error: 'Valor inválido.' }, { status: 400 });
    }

    const itemId = Number(params.id);
    const dataVenda = data || new Date().toISOString().slice(0, 10);

    const atual = await fetchItemColumnText(itemId, COLUMNS.vendasAdicionais);
    const lista = parseVendas(atual);
    const novaVenda = {
      id: `va-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      data: dataVenda,
      descricao: descricaoLimpa,
      valor: valorNum,
      registradoPor: registradoPor || null,
    };
    lista.push(novaVenda);

    const columnValues = { [COLUMNS.vendasAdicionais]: JSON.stringify(lista) };

    // Uma venda registrada é evidência de contato real com o cliente — mesmo
    // princípio já aplicado nas anotações (ver notes/route.js): carimba
    // "Data Último Contato" com hoje, e "Data Primeiro Contato" também se
    // for a primeira vez.
    const hoje = new Date().toISOString().slice(0, 10);
    let ultimoContato = null;
    try {
      const contatoAtual = await fetchItemColumnText(itemId, COLUMNS.ultimoContato);
      columnValues[COLUMNS.ultimoContato] = { date: hoje };
      if (!contatoAtual) {
        columnValues[COLUMNS.dataPrimeiroContato] = { date: hoje };
      }
      ultimoContato = hoje;
    } catch {
      // Se só o carimbo de contato falhar, a venda já foi salva — não vira
      // erro pro vendedor (best-effort, mesmo padrão das anotações).
    }

    await updateItemColumns(BOARD_ID, itemId, columnValues);
    return NextResponse.json({ ok: true, vendasAdicionais: lista, ultimoContato });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Remove um registro específico (ex: lançado por engano) — pede o id da
// venda no corpo da requisição em vez de um segmento de rota extra, já que
// o volume aqui é baixo (não justifica uma rota /vendas-adicionais/[vendaId]
// própria).
export async function DELETE(request, { params }) {
  try {
    const { vendaId } = await request.json();
    if (!vendaId) {
      return NextResponse.json({ error: 'Faltou informar qual venda remover.' }, { status: 400 });
    }
    const itemId = Number(params.id);
    const atual = await fetchItemColumnText(itemId, COLUMNS.vendasAdicionais);
    const lista = parseVendas(atual).filter((v) => v.id !== vendaId);
    await updateItemColumns(BOARD_ID, itemId, { [COLUMNS.vendasAdicionais]: JSON.stringify(lista) });
    return NextResponse.json({ ok: true, vendasAdicionais: lista });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
