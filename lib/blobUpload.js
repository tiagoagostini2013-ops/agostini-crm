'use client';

import { upload } from '@vercel/blob/client';

// Envio direto pro Vercel Blob, com timeout + novas tentativas automáticas.
//
// Sem isso, quando a rede trava perto do fim do envio (visto em pelo menos um
// computador/rede do time comercial — a barra ficava parada em "99,84%" sem
// nunca terminar nem dar erro), o suplemento/painel ficava esperando pra
// sempre, sem jeito de saber se ainda ia terminar. A biblioteca do Vercel
// Blob não tem timeout embutido pro envio em si (só reforça o pedido do
// token, que é rápido) — quem trava é o PUT do arquivo, que pode ficar preso
// numa conexão TCP zumbi sem erro nenhum.
//
// O timeout cresce com o tamanho do arquivo (arquivo grande em rede lenta
// legitimamente demora mais) e cada tentativa nova abre uma conexão do zero,
// o que já resolve a maioria das travas (a antiga simplesmente não morria
// nunca sozinha).
const BASE_TIMEOUT_MS = 60_000; // 60s de piso, mesmo pra arquivo pequeno
const PER_MB_TIMEOUT_MS = 20_000; // +20s por MB — folga generosa pra conexão ruim
const MAX_TIMEOUT_MS = 10 * 60 * 1000; // nunca mais que 10min numa tentativa só
const MAX_ATTEMPTS = 3;

export async function uploadWithRetry(fileName, fileBlob, { handleUploadUrl, contentType, onStatus }) {
  const fileSizeMb = fileBlob.size / (1024 * 1024);
  const timeoutMs = Math.min(BASE_TIMEOUT_MS + fileSizeMb * PER_MB_TIMEOUT_MS, MAX_TIMEOUT_MS);

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await upload(fileName, fileBlob, {
        access: 'public',
        handleUploadUrl,
        contentType,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => {
          onStatus?.({ percentage, attempt, retrying: false });
        },
      });
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
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
      'tente por outra rede (ex: dados do celular) ou repita em alguns instantes.'
  );
}
