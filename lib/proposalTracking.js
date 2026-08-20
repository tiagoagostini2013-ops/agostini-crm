// Helpers do rastreio de leitura de propostas (Fase pedida pelo Tiago em
// 20/08/2026, inspirada num CRM de mercado que avisa quando a proposta é
// aberta). Compartilhado entre app/api/word-addin/finalize (cria o registro
// ao gerar o PDF) e app/api/track/[token] (atualiza o registro a cada ping
// do visualizador público) — pra não duplicar o parse/stringify do JSON
// guardado na coluna "Rastreio de Propostas" (long_text) em dois lugares.
//
// Cada registro: { sendId, fileName, assetId, sentAt, sentBy, firstViewedAt,
// lastViewedAt, viewCount, totalViewMs }. Não guardamos o log de cada ping
// individual (só os agregados) — mantém a coluna pequena e a leitura simples
// tanto pelo LeadDrawer quanto por quem olhar direto no monday.com.
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
  };
}

// Aplica um evento de visualização (vindo do beacon do visualizador público)
// a um registro existente, devolvendo uma cópia atualizada. Não muta o
// array recebido — quem chama decide como reescrever a coluna.
export function applyTrackingEvent(record, event, durationMs) {
  const now = new Date().toISOString();
  const updated = { ...record };
  if (event === 'open') {
    if (!updated.firstViewedAt) updated.firstViewedAt = now;
    updated.viewCount = (updated.viewCount || 0) + 1;
  } else {
    updated.totalViewMs = (updated.totalViewMs || 0) + Math.max(0, durationMs || 0);
  }
  updated.lastViewedAt = now;
  return updated;
}
