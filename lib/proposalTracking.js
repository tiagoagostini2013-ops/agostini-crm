// Helpers do rastreio de leitura de propostas (Fase pedida pelo Tiago em
// 20/08/2026, inspirada num CRM de mercado que avisa quando a proposta é
// aberta). Compartilhado entre app/api/word-addin/finalize (cria o registro
// ao gerar o PDF) e app/api/track/[token] (atualiza o registro a cada ping
// do visualizador público) — pra não duplicar o parse/stringify do JSON
// guardado na coluna "Rastreio de Propostas" (long_text) em dois lugares.
//
// Cada registro: { sendId, fileName, assetId, sentAt, sentBy, firstViewedAt,
// lastViewedAt, viewCount, totalViewMs, firstDownloadedAt, lastDownloadedAt,
// downloadCount }. Não guardamos o log de cada ping individual (só os
// agregados) — mantém a coluna pequena e a leitura simples tanto pelo
// LeadDrawer quanto por quem olhar direto no monday.com.
//
// "Download" aqui significa especificamente: o cliente clicou no botão
// "Baixar PDF" da nossa própria página (ver app/api/proposal-download-file/
// [token]/route.js). NÃO cobre quem salva o arquivo pelo visualizador nativo
// do navegador (ícone de salvar do próprio Chrome/Edge etc.) — essa ação
// acontece inteiramente do lado do cliente, sem nenhuma requisição nova pro
// nosso servidor, então não tem como ser vista daqui. É um sinal de "clicou
// pra baixar pelo nosso link", não uma contagem exaustiva de todo download
// possível.
export function parseTrackingList(rawText) {
  if (!rawText) return [];
  try {
    const parsed = JSON.parse(rawText);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createTrackingRecord({ sendId, fileName, assetId, sentBy }) {
  return {
    sendId,
    fileName,
    assetId: String(assetId),
    sentAt: new Date().toISOString(),
    sentBy: sentBy || null,
    firstViewedAt: null,
    lastViewedAt: null,
    viewCount: 0,
    totalViewMs: 0,
    firstDownloadedAt: null,
    lastDownloadedAt: null,
    downloadCount: 0,
  };
}

// Aplica um evento (vindo do beacon do visualizador público ou da rota de
// download) a um registro existente, devolvendo uma cópia atualizada. Não
// muta o array recebido — quem chama decide como reescrever a coluna.
export function applyTrackingEvent(record, event, durationMs) {
  const now = new Date().toISOString();
  const updated = { ...record };
  if (event === 'open') {
    if (!updated.firstViewedAt) updated.firstViewedAt = now;
    updated.viewCount = (updated.viewCount || 0) + 1;
    updated.lastViewedAt = now;
  } else if (event === 'download') {
    if (!updated.firstDownloadedAt) updated.firstDownloadedAt = now;
    updated.downloadCount = (updated.downloadCount || 0) + 1;
    updated.lastDownloadedAt = now;
  } else {
    updated.totalViewMs = (updated.totalViewMs || 0) + Math.max(0, durationMs || 0);
    updated.lastViewedAt = now;
  }
  return updated;
}

// Leitura TOLERANTE do rastreio: o monday corta uma coluna long_text em 2.000
// caracteres, então um JSON com muitos envios pode chegar truncado (já
// aconteceu em produção). Em vez de descartar tudo (parseTrackingList → []),
// recupera os registros que chegaram INTEIROS e avisa que houve truncamento.
// Não reescreve nada: só lê. Quem grava continua usando a lista completa.
export function parseTrackingListTolerante(rawText) {
  if (!rawText) return { lista: [], truncado: false };
  try {
    const parsed = JSON.parse(rawText);
    return { lista: Array.isArray(parsed) ? parsed : [], truncado: false };
  } catch {
    // Varre o texto procurando objetos { ... } de nível 1 completos.
    const lista = [];
    let depth = 0;
    let inStr = false;
    let esc = false;
    let ini = -1;
    for (let i = 0; i < rawText.length; i++) {
      const ch = rawText[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') {
        if (depth === 0) ini = i;
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0 && ini >= 0) {
          try {
            const o = JSON.parse(rawText.slice(ini, i + 1));
            if (o && typeof o === 'object' && o.sendId) lista.push(o);
          } catch {
            /* objeto incompleto/ilegível: ignora */
          }
          ini = -1;
        }
      }
    }
    return { lista, truncado: true };
  }
}
