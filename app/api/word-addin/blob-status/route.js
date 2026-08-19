import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Checagem rápida antes de tentar subir o arquivo — sem isso, quando o
// Vercel Blob não está configurado (BLOB_READ_WRITE_TOKEN ausente), a
// biblioteca @vercel/blob no navegador só mostra "Failed to retrieve the
// client token", uma mensagem genérica que não diz o que realmente houve.
// Essa rota é protegida pelo middleware normalmente (exige sessão) — não há
// dado sensível na resposta, só um booleano.
// DEBUG TEMPORÁRIO (19/08/2026): BLOB_READ_WRITE_TOKEN está confirmado
// presente em Settings > Environment Variables (Production + Preview), mas
// process.env continua vazio mesmo em deploys feitos depois de salvar a
// variável. Pra descobrir se é algo específico dela ou se é um problema
// geral de todas as env vars nesse projeto, comparamos com outras que já
// sabemos que funcionam em produção (CLOUDCONVERT_API_KEY — usada na
// conversão de PDF que já rodou de verdade — e MONDAY_API_TOKEN, sem o qual
// o painel inteiro não funcionaria). Reverter pra versão simples assim que
// resolver:
//   return NextResponse.json({ configured: Boolean(process.env.BLOB_READ_WRITE_TOKEN) }, ...)
// Só presença + tamanho — nunca o valor nem um trecho dele, mesmo sendo uma
// rota que já exige login (defesa em profundidade).
function tokenDebugInfo(value) {
  if (!value) return { present: false };
  return { present: true, length: value.length };
}

export async function GET() {
  return NextResponse.json(
    {
      configured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      debug: {
        BLOB_READ_WRITE_TOKEN: tokenDebugInfo(process.env.BLOB_READ_WRITE_TOKEN),
        BLOB_STORE_ID: tokenDebugInfo(process.env.BLOB_STORE_ID),
        CLOUDCONVERT_API_KEY: tokenDebugInfo(process.env.CLOUDCONVERT_API_KEY),
        MONDAY_API_TOKEN: tokenDebugInfo(process.env.MONDAY_API_TOKEN),
        SESSION_SECRET: tokenDebugInfo(process.env.SESSION_SECRET),
        VERCEL_ENV: process.env.VERCEL_ENV || null,
      },
    },
    // Sem isso, o WebView2 do Word (já vimos esse cache dar problema antes,
    // ver o erro de sideload) pode continuar servindo uma resposta antiga em
    // cache mesmo depois da variável de ambiente ter sido corrigida no
    // servidor.
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  );
}
