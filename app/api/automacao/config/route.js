import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/admin-guard';
import { normalizarConfig, REGRAS } from '../../../../lib/automacao.js';
import { carregarConfig, salvarConfig } from '../../../../lib/automacaoServer';
import { dataValida } from '../../../../lib/acoes';

export const dynamic = 'force-dynamic';

function resposta(info) {
  return {
    config: info.config,
    fonte: info.fonte,
    gravavel: info.gravavel,
    desativadaPeloAmbiente: info.desativadaPeloAmbiente,
    erro: info.erro,
    regras: Object.values(REGRAS).map((r) => ({ id: r.id, nome: r.nome })),
  };
}

// Qualquer usuário logado lê (a tela precisa saber o que está ligado);
// só administrador altera.
export async function GET() {
  try {
    return NextResponse.json(resposta(await carregarConfig({ forcar: true })));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  const guard = await requireAdmin(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const body = await request.json().catch(() => ({}));
    const entrada = body.config && typeof body.config === 'object' ? body.config : null;
    if (!entrada) return NextResponse.json({ error: 'Envie o objeto "config".' }, { status: 400 });
    // valida antes de gravar: valores fora do intervalo são recusados (não "corrigidos" em silêncio)
    const validada = normalizarConfig(entrada);
    for (const [campo, min, max] of [['diasParada', 1, 90], ['janelaRecenteDias', 1, 365], ['diasPropostaSemAvanco', 1, 90]]) {
      if (campo in entrada && (!Number.isInteger(Number(entrada[campo])) || Number(entrada[campo]) < min || Number(entrada[campo]) > max)) {
        return NextResponse.json({ error: `"${campo}" deve ser um número inteiro entre ${min} e ${max}.` }, { status: 400 });
      }
    }
    if ('horaFollowUp' in entrada && validada.horaFollowUp !== entrada.horaFollowUp) {
      return NextResponse.json({ error: 'Horário inválido (use HH:MM).' }, { status: 400 });
    }
    if ('feriadosExtras' in entrada) {
      const lista = entrada.feriadosExtras;
      if (!Array.isArray(lista) || lista.length > 40 || lista.some((d) => !dataValida(d)) || new Set(lista).size !== lista.length) {
        return NextResponse.json({ error: 'Feriados extras: use uma lista (até 40) de datas AAAA-MM-DD válidas, sem repetir.' }, { status: 400 });
      }
    }
    const nova = await salvarConfig({ ...entrada, atualizadoPor: guard.payload.name, atualizadoEm: new Date().toISOString() });
    return NextResponse.json({ ok: true, config: nova });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
