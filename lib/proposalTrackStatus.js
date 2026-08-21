// Classifica o status de leitura de uma proposta rastreada, a partir dos
// registros salvos em rastreioPropostas (ver lib/proposalTracking.js, que
// cria/atualiza esses registros no backend). Este arquivo é puro — sem
// dependência de Node — pra poder ser importado tanto em rotas de servidor
// quanto em componentes de cliente (Dashboard, LeadDrawer), mantendo os dois
// lugares com a mesma régua de cores.
//
// Limiar de "leitura longa" definido com o Tiago em 21/08/2026: abaixo de
// 4 minutos de tempo total de tela conta como "lida rapidamente" (laranja);
// a partir de 4 minutos conta como leitura completa (verde). Continua valendo
// a ressalva de sempre: é uma estimativa de engajamento (tempo de aba em
// primeiro plano), não confirmação de leitura atenta.

export const LEITURA_LONGA_MS = 4 * 60 * 1000;

export const STATUS_LEITURA = {
  NAO_LIDA: 'nao-lida',
  LIDA_POUCO: 'lida-pouco',
  LIDA_BASTANTE: 'lida-bastante',
};

export const STATUS_LEITURA_LABEL = {
  [STATUS_LEITURA.NAO_LIDA]: 'Ainda não visualizada',
  [STATUS_LEITURA.LIDA_POUCO]: 'Visualizada — pouco tempo de leitura (menos de 4min)',
  [STATUS_LEITURA.LIDA_BASTANTE]: 'Visualizada — leitura completa (4min ou mais)',
};

export const STATUS_LEITURA_COR = {
  [STATUS_LEITURA.NAO_LIDA]: 'var(--danger)',
  [STATUS_LEITURA.LIDA_POUCO]: '#c47d00',
  [STATUS_LEITURA.LIDA_BASTANTE]: 'var(--good)',
};

// Classifica um único registro de envio (uma linha de rastreioPropostas).
export function statusLeituraRegistro(registro) {
  if (!registro) return null;
  if (!registro.firstViewedAt) return STATUS_LEITURA.NAO_LIDA;
  return (registro.totalViewMs || 0) < LEITURA_LONGA_MS
    ? STATUS_LEITURA.LIDA_POUCO
    : STATUS_LEITURA.LIDA_BASTANTE;
}

// Envio mais recente de uma lista de registros (por data de envio).
export function ultimoEnvio(rastreioPropostas) {
  if (!rastreioPropostas || rastreioPropostas.length === 0) return null;
  return [...rastreioPropostas].sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))[0];
}

// Status "resumo" de um lead pra exibição compacta (ex.: card do Kanban) —
// reflete o envio mais recente. Retorna null quando não há nenhuma proposta
// enviada com rastreio ainda (não mostrar nenhum indicador nesse caso).
export function statusLeituraProposta(rastreioPropostas) {
  return statusLeituraRegistro(ultimoEnvio(rastreioPropostas));
}
