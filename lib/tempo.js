// Datas e horários COMERCIAIS no fuso America/Sao_Paulo.
//
// O servidor da Vercel roda em UTC e o navegador pode estar em qualquer fuso;
// "hoje", "dia útil" e "quando aconteceu" precisam significar sempre o dia/hora
// de Brasília. Puro (sem imports) pra rodar no servidor, no navegador e nos
// testes.
//
// Observação: o Brasil não tem horário de verão desde 2019, mas usamos
// Intl com o fuso nomeado (e não um deslocamento fixo) para continuar
// correto caso a regra mude.

export const FUSO = 'America/Sao_Paulo';

const fmtPartes = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partes(date) {
  const o = {};
  for (const p of fmtPartes.formatToParts(date)) o[p.type] = p.value;
  return o;
}

// "YYYY-MM-DD" de hoje (ou do instante informado) em Brasília.
export function hojeSP(agora = new Date()) {
  const p = partes(agora);
  return `${p.year}-${p.month}-${p.day}`;
}

// "YYYY-MM-DDTHH:mm" no relógio de Brasília (sem fuso na string).
export function agoraLocalSP(agora = new Date()) {
  const p = partes(agora);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// Converte um instante (ISO com Z, ou Date) na data "YYYY-MM-DD" de Brasília.
export function dataSP(iso) {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return hojeSP(d);
}

// "dd/mm/aaaa HH:mm" no relógio de Brasília.
export function fmtDataHoraSP(iso) {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = partes(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

export function fmtDataSP(iso) {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = partes(d);
  return `${p.day}/${p.month}/${p.year}`;
}

// "YYYY-MM-DDTHH:mm" (relógio de Brasília) → instante ISO UTC. Brasília é
// UTC-3 o ano todo (sem horário de verão desde 2019). Se o fuso voltar a ter
// horário de verão, trocar por uma conversão baseada em Intl.
export function localSPParaISO(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || ''));
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const ms = Date.UTC(y, mo - 1, d, h + 3, mi);
  const date = new Date(ms);
  // valida dia existente
  if (date.getUTCMonth() !== mo - 1) return null;
  return date.toISOString();
}

// ---------------------------------------------------------------------
// Dias úteis (seg-sex, sem feriados nacionais)
// ---------------------------------------------------------------------

function pad(n) {
  return String(n).padStart(2, '0');
}

function dataUTC(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function strUTC(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// Domingo de Páscoa (algoritmo anônimo gregoriano) — base dos feriados móveis.
function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const cacheFeriados = new Map();

// Feriados NACIONAIS do ano (fixos + Carnaval, Sexta-feira Santa e Corpus
// Christi). Feriados estaduais/municipais NÃO entram: se a equipe quiser, é
// só somar datas em FERIADOS_EXTRAS abaixo.
export const FERIADOS_EXTRAS = []; // ex.: ['2026-12-08'] (formato AAAA-MM-DD)

export function feriadosNacionais(ano) {
  if (cacheFeriados.has(ano)) return cacheFeriados.get(ano);
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map((s) => `${ano}-${s}`);
  const p = pascoa(ano);
  const somaDias = (n) => strUTC(new Date(p.getTime() + n * 86400000));
  const moveis = [somaDias(-48), somaDias(-47), somaDias(-2), somaDias(60)]; // segunda/terça de Carnaval, Sexta Santa, Corpus Christi
  const set = new Set([...fixos, ...moveis]);
  cacheFeriados.set(ano, set);
  return set;
}

export function ehFeriado(str) {
  if (!str) return false;
  const ano = Number(str.slice(0, 4));
  return feriadosNacionais(ano).has(str) || FERIADOS_EXTRAS.includes(str);
}

export function ehDiaUtil(str) {
  const dow = dataUTC(str).getUTCDay();
  return dow !== 0 && dow !== 6 && !ehFeriado(str);
}

// Próximo dia útil estritamente DEPOIS de `str` (n=1) ou n dias úteis à frente.
export function somaDiasUteis(str, n) {
  let dt = dataUTC(str);
  let restante = Math.max(0, Math.floor(n));
  while (restante > 0) {
    dt = new Date(dt.getTime() + 86400000);
    if (ehDiaUtil(strUTC(dt))) restante -= 1;
  }
  return strUTC(dt);
}

// Se a data cair em fim de semana/feriado devolve o próximo dia útil; se já
// for útil, devolve a própria data.
export function proximoDiaUtilOuIgual(str) {
  let dt = dataUTC(str);
  while (!ehDiaUtil(strUTC(dt))) dt = new Date(dt.getTime() + 86400000);
  return strUTC(dt);
}
