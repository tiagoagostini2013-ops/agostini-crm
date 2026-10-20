import { NextResponse } from 'next/server';
import { getSessao } from '../../../../lib/sessao';
import { hojeSP } from '../../../../lib/tempo.js';
import { listarSugestoes, REGRAS, ehResponsavel } from '../../../../lib/automacao.js';
import { carregarConfig, carregarLeads, carregarLead, escopoDaSessao } from '../../../../lib/automacaoServer';

export const dynamic = 'force-dynamic';

// Lista as SUGESTÕES de próximos passos (modo sugestão). Calculadas no servidor a
// cada pedido, a partir do que já está no monday — não dependem de a página de
// ninguém estar aberta e não criam nada: só aceitar (POST em /sugestoes/[id]) grava.
//
// Escopo: administrador vê tudo (e pode filtrar por responsável); os demais veem
// só as oportunidades em que são responsáveis. A "análise prévia" (eventos
// antigos) só é devolvida com um responsável escolhido — nunca como lista geral.
export async function GET(request) {
  try {
    const sessao = await getSessao(request);
    const escopo = await escopoDaSessao(sessao);
    if (escopo.erro) return NextResponse.json({ error: escopo.erro }, { status: escopo.status });

    const url = new URL(request.url);
    const cfgInfo = await carregarConfig();
    const { config } = cfgInfo;
    const cabecalho = {
      hoje: hojeSP(),
      ativo: config.ativo,
      desativadaPeloAmbiente: cfgInfo.desativadaPeloAmbiente,
      regrasAtivas: Object.keys(REGRAS).filter((k) => config.regras[k]),
      configAviso: cfgInfo.erro,
      escopo: { admin: escopo.admin, semVinculo: !!escopo.semVinculo },
    };
    if (!config.ativo) return NextResponse.json({ ...cabecalho, sugestoes: [], antigas: [], totalAntigas: 0, avisos: [] });
    if (!escopo.admin && escopo.semVinculo) {
      return NextResponse.json({ ...cabecalho, sugestoes: [], antigas: [], totalAntigas: 0, avisos: [], aviso: 'Seu usuário ainda não está vinculado a uma pessoa do monday.com; peça ao administrador para vincular (Administração de usuários).' });
    }

    const responsavelId = escopo.admin ? url.searchParams.get('responsavelId') || null : escopo.mondayUserId;
    // Modo "uma oportunidade" (gaveta do lead): lê só aquele item.
    const unico = url.searchParams.get('itemId');
    let leads;
    if (unico && /^\d+$/.test(unico)) {
      const lead = await carregarLead(unico);
      leads = lead && (escopo.admin || ehResponsavel(lead, escopo.mondayUserId)) ? [lead] : [];
    } else {
      leads = await carregarLeads();
    }
    const r = listarSugestoes(leads, config, { hoje: cabecalho.hoje, responsavelId });
    const pedirAnalise = url.searchParams.get('analise') === '1';
    const out = {
      ...cabecalho,
      geradoEm: new Date().toISOString(),
      responsavelFiltro: responsavelId,
      sugestoes: r.recentes,
      totalAntigas: r.antigas.length,
      antigas: pedirAnalise && responsavelId ? r.antigas : [],
      analiseExigeResponsavel: pedirAnalise && !responsavelId,
      avisos: r.avisos,
    };
    if (escopo.admin && url.searchParams.get('debug') === '1') out.suprimidas = r.suprimidas;
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
