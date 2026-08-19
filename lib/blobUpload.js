'use client';

import { upload } from '@vercel/blob/client';

// Envio direto pro Vercel Blob, com detecção de trava + novas tentativas
// automáticas, além de um cancelamento manual (para quando nada disso for
// suficiente e a pessoa simplesmente precisar desistir sem travar a tela).
//
// Sem isso, quando a rede trava perto do fim do envio (visto em pelo menos um
// computador/rede do time comercial — a barra ficava parada em "99,8x%" sem
// nunca terminar nem dar erro), o suplemento/painel ficava esperando pra
// sempre. A biblioteca do Vercel Blob não tem timeout embutido pro envio em
// si — quem trava é o PUT do arquivo, preso numa conexão que parece viva mas
// não termina, sem gerar nenhum erro sozinho.
//
// Duas rodadas de ajuste aqui: a primeira usava um tempo-limite fixo (minutos)
// por tentativa — na prática, esperar minutos parado numa trava que já tinha
// acontecido nos primeiros segundos. A segunda trocou isso por um vigia de
// progresso (aborta se não houver avanço real por STALL_TIMEOUT_MS) — mas
// mesmo assim ficou relatado como "travado, sem erro". Diante disso, esta
// versão soma um "pulso" (onStatus chamado a cada segundo com o tempo
// decorrido, mesmo sem progresso novo) — serve como prova de vida: se o
// tempo decorrido também parar de subir na tela, o problema não está aqui
// (é o próprio navegador/processo que travou, não esta lógica) — e um botão
// de cancelar manual (ver `cancel()` devolvido), pra nunca depender só da
// detecção automática.
const STALL_TIMEOUT_MS = 25_000; // sem nenhum progresso novo em 25s = travado
const MAX_ATTEMPT_MS = 8 * 60 * 1000; // teto de segurança por tentativa (envio ativo, só muito lento)
export const MAX_UPLOAD_ATTEMPTS = 4;

export async function uploadWithRetry(fileName, fileBlob, { handleUploadUrl, contentType, onStatus, externalSignal }) {
  let lastErr;

  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
    if (externalSignal?.aborted) {
      throw new Error('envio cancelado.');
    }

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort);

    const attemptStart = Date.now();
    const hardTimer = setTimeout(() => controller.abort(), MAX_ATTEMPT_MS);
    let stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    let bestPercentage = -1;
    const bumpStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    };
    // "Pulso" de 1s — prova de vida independente de progresso real, pra dar
    // pra distinguir "está tentando, só que devagar" de "isto aqui travou de
    // verdade" (nesse segundo caso, o número de segundos também para de subir).
    const tick = setInterval(() => {
      onStatus?.({
        percentage: Math.max(bestPercentage, 0),
        attempt,
        retrying: false,
        elapsedSeconds: Math.round((Date.now() - attemptStart) / 1000),
      });
    }, 1000);

    const cleanup = () => {
      clearTimeout(stallTimer);
      clearTimeout(hardTimer);
      clearInterval(tick);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    };

    try {
      const result = await upload(fileName, fileBlob, {
        // O Blob Store do projeto foi criado como "Private" na Vercel — o
        // modo é fixado na criação do Store e não dá pra mudar depois. Um
        // upload pedindo "public" contra um Store privado é uma
        // incompatibilidade real (confirmada na documentação oficial da
        // Vercel) e é a suspeita mais forte para o travamento constante perto
        // do fim do envio. Isso muda a URL resultante para o formato
        // "https://<store>.private.blob.vercel-storage.com/..." — que exige
        // um cabeçalho Authorization pra ser lida depois (ver finalize/route.js
        // e items/[id]/files/route.js).
        access: 'private',
        handleUploadUrl,
        contentType,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => {
          // Só reseta o vigia de trava se o envio realmente avançou. Sem essa
          // checagem, um envio travado que fica reemitindo o mesmo percentual
          // nunca seria detectado como travado — qualquer evento, mesmo
          // repetindo o mesmo valor, resetaria o prazo.
          if (percentage > bestPercentage) {
            bestPercentage = percentage;
            bumpStallTimer();
          }
          onStatus?.({
            percentage,
            attempt,
            retrying: false,
            elapsedSeconds: Math.round((Date.now() - attemptStart) / 1000),
          });
        },
      });
      cleanup();
      return result;
    } catch (err) {
      cleanup();
      lastErr = err;
      if (externalSignal?.aborted) {
        throw new Error('envio cancelado.');
      }
      if (attempt < MAX_UPLOAD_ATTEMPTS) {
        onStatus?.({ percentage: 0, attempt: attempt + 1, retrying: true });
        continue;
      }
    }
  }

  throw new Error(
    `não foi possível concluir o envio depois de ${MAX_UPLOAD_ATTEMPTS} tentativas (${lastErr?.message || 'conexão instável'}). ` +
      'Isso costuma ser a rede/conexão deste computador (proxy, antivírus ou wi-fi instável travando o fim do envio) — ' +
      'tente por outra rede (ex: dados do celular, ou um cabo em vez do wi-fi), ou teste abrindo o mesmo link do CRM ' +
      'direto num navegador comum (Edge/Chrome) em vez do painel dentro do Word, pra saber se o problema é específico ' +
      'do Word.'
  );
}
