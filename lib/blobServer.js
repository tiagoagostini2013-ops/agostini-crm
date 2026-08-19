// Helper de servidor para ler de volta o conteúdo de um blob que acabou de
// ser enviado direto pro Vercel Blob pelo navegador (ver lib/blobUpload.js).
//
// O Blob Store deste projeto foi criado como "Private" na Vercel — modo que
// não dá pra mudar depois de criado. Blobs privados não são acessíveis por
// URL direta sem autenticação (diferente de um Store "Public"): é preciso
// mandar um cabeçalho Authorization com o BLOB_READ_WRITE_TOKEN. Sem isso, um
// `fetch(blobUrl)` simples falha (ou, no caso de incompatibilidade entre o
// modo pedido no upload e o modo real do Store, pode nem chegar a falhar
// direito — foi essa a causa mais provável de um travamento observado no
// envio de arquivos antes desta correção).
export async function fetchBlobContent(blobUrl) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN não está configurado — não é possível ler o arquivo do Vercel Blob.');
  }
  const res = await fetch(blobUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Não foi possível ler o arquivo recém enviado (Vercel Blob respondeu ${res.status}).`);
  }
  return res;
}
