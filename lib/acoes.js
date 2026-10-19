// Apoio das rotas de "próxima ação" e "atividade realizada" (servidor).
// A lógica de negócio pura (revisão/conflito, trilhas, pendências) está em
// lib/agenda.js e é testada à parte — aqui só ficam validação de entrada e o
// acesso ao monday.
import { fetchItemColumnTexts } from './monday';
import { COLUMNS } from './config';
import { hojeSP } from './tempo.js';
import { TRILHAS, TRILHA_CAMPO_DATA, parsePlanoAcao, dateOnly } from './agenda.js';

const TRILHAS_VALIDAS = Object.values(TRILHAS);

export function validarTrilha(trilha) {
  return TRILHAS_VALIDAS.includes(trilha) ? trilha : null;
}

// "YYYY-MM-DD" válido (incluindo dia existente no calendário) ou null.
export function dataValida(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = dateOnly(v);
  if (!d) return undefined; // formato inválido
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) return undefined;
  return d;
}

export function hojeISO() {
  // "Hoje" sempre no fuso de Brasília (lib/tempo.js) — o servidor roda em UTC e
  // entre 21h e 00h o toISOString() já viraria o dia seguinte.
  return hojeSP();
}

// Coluna nativa do monday que guarda a data da trilha (null se ainda não
// configurada neste ambiente).
export function colunaDataDaTrilha(trilha) {
  return COLUMNS[TRILHA_CAMPO_DATA[trilha]] || null;
}

export function mensagemColunaAusente(titulos) {
  return `Falta criar no monday.com deste ambiente: ${titulos.join(', ')}. Rode o script scripts/criar-colunas-monday.mjs e configure as variáveis MONDAY_COL_* (ver README).`;
}

// Lê, numa só consulta, o plano de ação e o "último contato" do lead.
export async function lerEstadoDoLead(itemId) {
  const texts = await fetchItemColumnTexts(itemId, [COLUMNS.planoAcao, COLUMNS.ultimoContato]);
  return {
    plano: parsePlanoAcao(COLUMNS.planoAcao ? texts[COLUMNS.planoAcao] : null),
    ultimoContatoTexto: COLUMNS.ultimoContato ? texts[COLUMNS.ultimoContato] : null,
  };
}

// Normaliza o bloco "ação" vindo do front (próxima ação ou próximo passo).
// Devolve { erro } ou { acao: {...} | null } (null = nada informado).
export function lerAcaoDoCorpo(raw) {
  if (!raw) return { acao: null, data: null };
  const texto = String(raw.acao || '').replace(/\s+/g, ' ').trim();
  const data = dataValida(raw.data);
  if (data === undefined) return { erro: 'Data inválida (use o formato AAAA-MM-DD).' };
  const responsavelId = raw.responsavelId ? String(raw.responsavelId).replace(/\D/g, '') || null : null;
  const compromissoCliente = !!raw.compromissoCliente;
  if (!texto && !data && !responsavelId && !compromissoCliente) return { acao: null, data: null };
  return { acao: { acao: texto, responsavelId, compromissoCliente }, data };
}
