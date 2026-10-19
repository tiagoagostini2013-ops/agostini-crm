// Histórico cronológico UNIFICADO de uma oportunidade — puro (sem imports de
// framework), testado em tests/historico.test.mjs.
//
// Fontes (nenhuma é copiada para outro lugar; só LIDAS e combinadas):
//   1. Atualizações (updates) do item no monday — onde já ficam anotações,
//      atendimentos registrados, anexos e propostas;
//   2. "Rastreio de Propostas" — envio em PDF e visualizações estimadas;
//   3. Carimbos de data do próprio item — entrada em cada estágio.
//
// O monday SEMPRE registra o autor de um update como o dono do token da API,
// então o autor "de verdade" só existe no TEXTO (prefixo escrito pelo CRM). Aqui
// ele só é aceito quando o texto tem uma assinatura reconhecível; fora disso o
// autor fica `null` ("não informado") — nunca é inventado.
//
// Cada evento distingue:
//   ocorreuEm   — quando a coisa aconteceu (só quando foi informado; null = não
//                 informado, e a tela diz isso);
//   registradoEm — quando o registro foi criado (created_at do update);
//   categoria   — 'efetivo' (contato real com o cliente) | 'tentativa' (sem
//                 resposta) | 'interno' | 'nao_informado' (anotação antiga: não
//                 dá pra saber) | 'sistema' (estágio, arquivos, propostas).
// Abrir WhatsApp, editar o cadastro e visualizar proposta NUNCA são contato
// efetivo: o primeiro e o segundo nem viram evento; o terceiro é 'sistema'.

import { localSPParaISO, dataSP } from './tempo.js';

export const CATEGORIAS = ['efetivo', 'tentativa', 'interno', 'nao_informado', 'sistema'];

const RE_ATENDIMENTO = /^✅ (?:Atividade registrada|Atendimento registrado) por (.+?) — (.+)$/m;
const RE_QUANDO = /^Quando: (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})\s*$/m;
const RE_CANAL = /^Canal: (.+?)(?: · Contato efetivo com o cliente: (sim|não|nao))?\s*$/m;
const RE_REF = /^Ref: (\S+)\s*$/m;

// Resultado do parse de UM update (função pura, testada isoladamente).
export function interpretarUpdate(text, { usuarios = [] } = {}) {
  const t = String(text || '').replace(/\r/g, '').trim();

  // 1) Atendimento registrado pelo CRM (v1 "Atividade", v2 "Atendimento")
  const cab = RE_ATENDIMENTO.exec(t);
  if (cab) {
    const canalM = RE_CANAL.exec(t);
    const canal = canalM ? canalM[1].trim() : null;
    const efetivoTxt = canalM?.[2] || null;
    const interno = canal && /^Interno/i.test(canal);
    let categoria = 'nao_informado';
    if (interno) categoria = 'interno';
    else if (efetivoTxt === 'sim') categoria = 'efetivo';
    else if (efetivoTxt) categoria = 'tentativa';
    const q = RE_QUANDO.exec(t);
    const ocorreuEm = q ? localSPParaISO(`${q[3]}-${q[2]}-${q[1]}T${q[4]}:${q[5]}`) : null;
    const ref = RE_REF.exec(t)?.[1] || null;
    const corpo = t
      .split('\n')
      .slice(1)
      .filter((l) => !RE_QUANDO.test(l) && !RE_REF.test(l) && !/^Canal: /.test(l))
      .join('\n')
      .trim();
    return {
      tipo: 'atendimento',
      canal,
      categoria,
      autor: cab[1].trim(),
      autorOrigem: 'texto',
      ocorreuEm,
      ref,
      trilha: cab[2].trim(),
      conteudo: corpo,
    };
  }

  // 2) Mensagens automáticas do CRM (anexos, propostas, handoff, remoção)
  const porMatch = / por ([^.\n—]+?)(?:\.| —|$)/.exec(t.split('\n')[0]);
  if (/^📎 Arquivo "/.test(t)) {
    return sistema('arquivo', t, porMatch);
  }
  if (/^🗑️ /.test(t)) return sistema('arquivo_removido', t, porMatch);
  if (/^📄 PDF gerado e link de rastreio/.test(t)) return { ...sistema('proposta_envio', t, porMatch), chave: 'pdf_rastreio' };
  if (/^📄 Proposta/.test(t)) return sistema('proposta', t, porMatch);
  if (/^📑 /.test(t)) {
    const ref = RE_REF.exec(t)?.[1] || null;
    return { ...sistema('proposta', t.replace(RE_REF, '').trim(), porMatch), ref };
  }
  if (/^🤝 /.test(t)) return sistema('handoff', t, porMatch);
  if (/^🏢 /.test(t)) {
    const ref = RE_REF.exec(t)?.[1] || null;
    return { ...sistema('vinculo', t.replace(RE_REF, '').trim(), porMatch), ref };
  }

  // 3) Anotação livre: o CRM escreve "Nome: texto" ou "Nome (anotação interna): texto"
  let autor = null;
  let interna = false;
  let conteudo = t;
  const interSemAutor = /^Anotação interna: ([\s\S]*)$/.exec(t);
  if (interSemAutor) {
    interna = true;
    conteudo = interSemAutor[1];
  } else {
    const m = /^(.{2,60}?)( \(anotação interna\))?: ([\s\S]*)$/.exec(t);
    if (m && usuarios.some((u) => String(u).trim().toLowerCase() === m[1].trim().toLowerCase())) {
      autor = usuarios.find((u) => String(u).trim().toLowerCase() === m[1].trim().toLowerCase()).trim();
      interna = !!m[2];
      conteudo = m[3];
    }
  }
  return {
    tipo: 'nota',
    canal: null,
    categoria: interna ? 'interno' : 'nao_informado',
    autor,
    autorOrigem: autor ? 'texto' : null,
    ocorreuEm: null,
    ref: null,
    conteudo: conteudo.trim(),
  };
}

function sistema(tipo, texto, porMatch) {
  return {
    tipo,
    canal: null,
    categoria: 'sistema',
    autor: porMatch ? porMatch[1].trim() : null,
    autorOrigem: porMatch ? 'texto' : null,
    ocorreuEm: null,
    ref: null,
    conteudo: texto,
  };
}

const ROTULO_ESTAGIO = [
  ['dataQualificacao', 'Entrou em Qualificado'],
  ['dataPropostaEnviada', 'Entrou em Proposta Enviada'],
  ['dataNegociacao', 'Entrou em Em Negociação'],
  ['dataFechamento', 'Entrou em Fechado'],
  ['dataPerda', 'Entrou em Perdido'],
  ['dataEntregaEfetiva', 'Entrega efetiva registrada'],
];

function ts(e) {
  return e.ocorreuEm || e.registradoEm || '';
}

function chaveOrdem(e) {
  // Compara instantes. Datas "puras" (só dia) entram ao meio-dia de Brasília
  // para não "pular" de dia por causa do fuso.
  const v = ts(e);
  if (!v) return 0;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T15:00:00Z`) : new Date(v);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

// Monta a lista de eventos (mais recente primeiro).
//   updates   : [{id, text, createdAt}] do monday
//   rastreio  : lista de registros de envio de proposta
//   item      : item achatado (datas de estágio, createdAt)
//   usuarios  : nomes conhecidos do painel (para reconhecer autor em anotações)
export function montarHistorico({ updates = [], rastreio = [], item = {}, usuarios = [] } = {}) {
  const eventos = [];
  const vistosId = new Set();
  const vistosRef = new Set();

  const pdfRastreio = []; // updates "PDF gerado..." que podem duplicar um envio do rastreio

  for (const u of updates) {
    if (!u) continue;
    const id = `u:${u.id}`;
    if (vistosId.has(id)) continue;
    vistosId.add(id);
    const info = interpretarUpdate(u.text, { usuarios });
    // Mesmo atendimento gravado duas vezes (duplo clique) → só o primeiro vale.
    if (info.ref) {
      if (vistosRef.has(info.ref)) continue;
      vistosRef.add(info.ref);
    }
    const ev = {
      id,
      origem: 'monday',
      registradoEm: u.createdAt || null,
      ...info,
    };
    delete ev.chave;
    if (info.chave === 'pdf_rastreio') pdfRastreio.push(ev);
    eventos.push(ev);
  }

  // Rastreio de propostas: envio + visualização estimada + cliques em baixar.
  for (const r of rastreio || []) {
    if (!r || !r.sendId) continue;
    const base = { origem: 'rastreio', categoria: 'sistema', canal: null, ref: r.sendId };
    if (r.sentAt) {
      // O update "PDF gerado e link de rastreio criado" descreve o MESMO fato.
      const t0 = new Date(r.sentAt).getTime();
      const dup = pdfRastreio.find(
        (e) => !e._consumido && Math.abs(new Date(e.registradoEm).getTime() - t0) <= 5 * 60 * 1000
      );
      if (dup) dup._consumido = true;
      eventos.push({
        ...base,
        id: `r:${r.sendId}:envio`,
        tipo: 'proposta_envio',
        registradoEm: r.sentAt,
        ocorreuEm: r.sentAt,
        autor: r.sentBy || dup?.autor || null,
        autorOrigem: r.sentBy ? 'rastreio' : dup?.autor ? 'texto' : null,
        conteudo: `Proposta enviada em PDF: ${r.fileName || 'arquivo'}`,
        arquivo: r.fileName || null,
        assetId: r.assetId || null,
      });
    }
    if (r.firstViewedAt) {
      eventos.push({
        ...base,
        id: `r:${r.sendId}:visualizacao`,
        tipo: 'proposta_visualizacao',
        registradoEm: r.firstViewedAt,
        ocorreuEm: r.firstViewedAt,
        autor: null,
        autorOrigem: null,
        conteudo: `Visualização estimada do link da proposta (primeira)${
          r.viewCount > 1 ? ` — ${r.viewCount} aberturas no total, última em ${r.lastViewedAt || '—'}` : ''
        }. Isto não confirma leitura nem aceite.`,
        arquivo: r.fileName || null,
      });
    }
    if (r.firstDownloadedAt) {
      eventos.push({
        ...base,
        id: `r:${r.sendId}:download`,
        tipo: 'proposta_visualizacao',
        registradoEm: r.firstDownloadedAt,
        ocorreuEm: r.firstDownloadedAt,
        autor: null,
        autorOrigem: null,
        conteudo: `Cliente clicou em "Baixar PDF" no link da proposta${
          r.downloadCount > 1 ? ` (${r.downloadCount} vezes)` : ''
        }.`,
        arquivo: r.fileName || null,
      });
    }
  }
  // Updates "PDF gerado" que casaram com um envio do rastreio saem (o envio já aparece).
  const semDuplicados = eventos.filter((e) => !e._consumido);

  // Entradas em estágio (carimbos do próprio item) e criação.
  for (const [campo, rotulo] of ROTULO_ESTAGIO) {
    const d = item?.[campo] ? String(item[campo]).slice(0, 10) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) continue;
    semDuplicados.push({
      id: `s:${campo}`,
      origem: 'item',
      tipo: 'estagio',
      categoria: 'sistema',
      canal: null,
      ref: null,
      ocorreuEm: d,
      registradoEm: null,
      autor: null,
      autorOrigem: null,
      conteudo: `${rotulo} (data do carimbo; quem mudou não é registrado)`,
    });
  }
  if (item?.createdAt) {
    semDuplicados.push({
      id: 's:criado',
      origem: 'item',
      tipo: 'criacao',
      categoria: 'sistema',
      canal: null,
      ref: null,
      ocorreuEm: null,
      registradoEm: item.createdAt,
      autor: null,
      autorOrigem: null,
      conteudo: 'Oportunidade criada no CRM',
    });
  }

  semDuplicados.sort((a, b) => chaveOrdem(b) - chaveOrdem(a));
  return semDuplicados;
}

// Data (YYYY-MM-DD, Brasília) do evento, para exibição/compare.
export function dataDoEvento(e) {
  const v = ts(e);
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return dataSP(v);
}

// Último contato EFETIVO: maior data entre os atendimentos classificados como
// 'efetivo' e a coluna "Data Último Contato" (que o CRM só carimba por contato
// efetivo ou por edição manual explícita). Tentativa, nota interna, abertura de
// WhatsApp, edição cadastral e visualização de proposta não entram.
export function ultimoContatoEfetivo(eventos, colunaData) {
  let melhor = null;
  for (const e of eventos || []) {
    if (e.categoria !== 'efetivo') continue;
    const d = dataDoEvento(e);
    if (d && (!melhor || d > melhor.data)) melhor = { data: d, fonte: 'historico', canal: e.canal || null, autor: e.autor || null };
  }
  const c = colunaData ? String(colunaData).slice(0, 10) : null;
  if (c && /^\d{4}-\d{2}-\d{2}$/.test(c) && (!melhor || c > melhor.data)) {
    melhor = { data: c, fonte: 'coluna', canal: null, autor: null };
  }
  return melhor;
}

// Última atividade: o evento mais recente que representa trabalho comercial
// (atendimento, tentativa, nota). Estágio/arquivos/propostas não contam.
export function ultimaAtividade(eventos) {
  for (const e of eventos || []) {
    if (e.tipo === 'atendimento' || e.tipo === 'nota') {
      return { data: dataDoEvento(e), tipo: e.tipo, categoria: e.categoria, canal: e.canal || null, autor: e.autor || null };
    }
  }
  return null;
}

// Pendência: oportunidade ativa sem próximo passo agendado após o último
// atendimento — a tela sinaliza, nunca "conclui" nada em silêncio.
export function atendimentoSemProximoPasso(eventos) {
  const at = (eventos || []).find((e) => e.tipo === 'atendimento');
  if (!at) return false;
  return /Próximo passo: nenhum agendado\./.test(at.conteudo || '');
}
