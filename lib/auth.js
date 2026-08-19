// Login individual por pessoa (nome + senha), com a lista de contas guardada
// no board separado "CRM Agostini - Usuários do Painel" (lib/users.js). O
// token de sessão é assinado (HMAC) e carrega quem está logado (uid, name,
// admin) — não é só um "sim/não autenticado" como na v1 de senha única.
//
// Usa Web Crypto (funciona tanto no middleware/edge quanto em rotas node).

export const SESSION_COOKIE = 'agostini_crm_session';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET não está configurado.');
  }
  return secret;
}

function toBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(sig));
}

// Assina qualquer payload com uma validade custom — usado tanto pro cookie
// de sessão (30 dias, via createSessionToken abaixo) quanto por links
// avulsos de curta duração (ex: prévia de proposta, ver
// app/api/proposals/[assetId]/link).
export async function createSignedToken(data = {}, ttlMs = THIRTY_DAYS_MS) {
  const payload = JSON.stringify({ ...data, exp: Date.now() + ttlMs });
  const encodedPayload = toBase64Url(new TextEncoder().encode(payload));
  const signature = await hmac(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function createSessionToken(data = {}) {
  return createSignedToken(data, THIRTY_DAYS_MS);
}

// Verifica a assinatura e devolve o payload decodificado ({uid, name, admin,
// exp}), ou null se o token for inválido/expirado. Use isto quando precisar
// saber QUEM está logado (ex: rotas de admin, /api/auth/me).
export async function getSessionPayload(token) {
  if (!token || !token.includes('.')) return null;
  const [encodedPayload, signature] = token.split('.');
  const expected = await hmac(encodedPayload);
  if (expected !== signature) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Só checa se a sessão é válida (usado pelo middleware, que não precisa saber
// quem é a pessoa — só se pode passar).
export async function verifySessionToken(token) {
  return (await getSessionPayload(token)) !== null;
}
