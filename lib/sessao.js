// Quem está logado (servidor): o autor de qualquer registro vem da SESSÃO, nunca
// de um campo livre do corpo da requisição — o monday sempre registra o dono do
// token da API como criador, então o nome da sessão é a única fonte confiável.
import { SESSION_COOKIE, getSessionPayload } from './auth';

export async function getSessao(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return getSessionPayload(token);
}
