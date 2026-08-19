import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Checagem rápida antes de tentar subir o arquivo — sem isso, quando o
// Vercel Blob não está configurado (BLOB_READ_WRITE_TOKEN ausente ou
// incorreto), a biblioteca @vercel/blob no navegador só mostra "Failed to
// retrieve the client token", uma mensagem genérica que não diz o que
// realmente houve. Essa rota é protegida pelo middleware normalmente (exige
// sessão) — não há dado sensível na resposta, só um booleano.
export async function GET() {
  return NextResponse.json(
    { configured: Boolean(process.env.BLOB_READ_WRITE_TOKEN) },
    // Sem isso, o WebView2 do Word pode continuar servindo uma resposta
    // antiga em cache mesmo depois da variável de ambiente ter sido
    // corrigida no servidor (já vimos exatamente esse tipo de cache dar
    // problema aqui antes).
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  );
}
