// Gera um cookie de sessão de TESTE (assinado com SESSION_SECRET=segredo-de-teste).
// Uso: node tests/e2e/gerar-token.mjs [nome] [admin:1|0]   → imprime o token.
// Só serve para o app de teste ligado ao monday simulado; nunca use com o segredo real.
import { createHmac } from 'node:crypto';
const nome = process.argv[2] || 'Ana Teste';
const admin = (process.argv[3] ?? '1') === '1';
const uid = nome === 'Ana Teste' ? 9001 : nome === 'Bruno Teste' ? 9002 : 9003;
const b64 = (b) => Buffer.from(b).toString('base64url');
const payload = b64(JSON.stringify({ uid, name: nome, admin, exp: Date.now() + 7 * 86400000 }));
const sig = createHmac('sha256', process.env.SESSION_SECRET || 'segredo-de-teste').update(payload).digest('base64url');
console.log(`${payload}.${sig}`);
