// Proteção simples por senha compartilhada (não é multiusuário/login por
// pessoa — é só uma trava para a página não ficar aberta pra qualquer um na
// internet, já que ela tem permissão de escrever no CRM de vocês).
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

export async function createSessionToken() {
  const payload = JSON.stringify({ exp: Date.now() + THIRTY_DAYS_MS });
  const encodedPayload = toBase64Url(new TextEncoder().encode(payload));
  const signature = await hmac(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token) {
  if (!token || !token.includes('.')) return false;
  const [encodedPayload, signature] = token.split('.');
  const expected = await hmac(encodedPayload);
  if (expected !== signature) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch {
    return false;
  }
}
