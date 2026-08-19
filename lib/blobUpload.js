'use client';

import { upload } from '@vercel/blob/client';

// Envio direto pro Vercel Blob, com detecção de trava + novas tentativas
// automáticas.
//
// Sem isso, quando a rede trava perto do fim do envio (visto em pelo menos um
// computador/rede do time comercial — a barra ficava parada em "99,8x%" sem
// nunca terminar nem dar erro), o suplemento/painel ficava esperando pra
// sempre. A biblioteca do Vercel Blob não tem timeout embutido pro envio em
// si — quem trava é o PUT do arquivo, preso numa conexão TCP zumbi sem gerar
// nenhum erro sozinho.
//
// A primeira versão disto usava um tempo-limite fixo por tentativa (proporcional
// ao tamanho do arquivo — minutos inteiros para dar folga a redes lentas). Na
// prática isso significava esperar minutos parado numa trava que já tinha
// acontecido nos primeiros segundos, só pra "confirmar" o óbvio. Agora, em vez
// de um relógio total, cada tentativa tem um vigia de progresso: se nenhum
// avanço no envio acontecer por STALL_TIMEOUT_MS, já considera travado e
// cancela + tenta de novo na hora — uma trava perto do fim é detectada em
// segundos, não minutos. Um teto de segurança por tentativa continua existindo
// só para o caso (bem mais raro) de um envio genuíno e ativo, mas
// absurdamente lento, não ficar reiniciando pra sempre.
const STALL_TIMEOUT_MS = 25_000; // sem nenhum progresso novo em 25s = travado
const MAX_ATTEMPT_MS = 8 * 60 * 1000; // teto de segurança por tentativa (envio ativo, só muito lento)
const MAX_ATTEMPTS = 4;

export async function uploadWithRetry(fileName, fileBlob, { handleUploadUrl, contentType, onStatus }) {
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const hardTimer = setTimeout(() => controller.abort(), MAX_ATTEMPT_MS);
    let stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    let bestPercentage = -1;
    const bumpStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    };

    try {
      const result = await upload(fileName, fileBlob, {
        access: 'public',
        handleUploadUrl,
        contentType,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => {
          // Só reseta o vigia de trava se o envio realmente avançou. Sem essa
          // checagem, um envio travado que fica reemitindo o mesmo percentual
          // (visto em alguns navegadores/redes perto do fim do envio, quando a
          // conexão fica "meio viva") nunca seria detectado como travado —
          // qualquer evento, mesmo repetindo o mesmo valor, resetaria o prazo.
          if (percentage > bestPercentage) {
            bestPercentage = percentage;
            bumpStallTimer();
          }
          onStatus?.({ percentage, attempt, retrying: false });
        },
      });
      clearTimeout(stallTimer);
      clearTimeout(hardTimer);
      return result;
    } catch (err) {
      clearTimeout(stallTimer);
      clearTimeout(hardTimer);
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        onStatus?.({ percentage: 0, attempt: attempt + 1, retrying: true });
        continue;
      }
    }
  }

  throw new Error(
    `não foi possível concluir o envio depois de ${MAX_ATTEMPTS} tentativas (${lastErr?.message || 'conexão instável'}). ` +
      'Isso costuma ser a rede/conexão deste computador (proxy, antivírus ou wi-fi instável travando o fim do envio) — ' +
      'tente por outra rede (ex: dados do celular, ou um cabo em vez do wi-fi) ou repita em alguns instantes.'
  );
}
