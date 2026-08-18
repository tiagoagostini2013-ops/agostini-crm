// Conversão .docx -> PDF via CloudConvert (https://cloudconvert.com), usada
// pelo suplemento do Word ao "vincular" uma proposta — o próprio Word não
// oferece um jeito de um add-in exportar o documento aberto como PDF, então
// mandamos os bytes pro CloudConvert converter e devolvemos o PDF pronto.
//
// Opcional: se CLOUDCONVERT_API_KEY não estiver configurado, as chamadas daqui
// simplesmente não são feitas (ver app/api/word-addin/finalize/route.js) — o
// .docx ainda é anexado normalmente, só sem o PDF automático.

const CLOUDCONVERT_API = 'https://api.cloudconvert.com/v2';

async function cloudConvertRequest(path, options = {}) {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) {
    throw new Error('CLOUDCONVERT_API_KEY não está configurado.');
  }
  const res = await fetch(`${CLOUDCONVERT_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json?.message || res.statusText;
    throw new Error(`CloudConvert respondeu ${res.status}: ${message}`);
  }
  return json;
}

// Cria o job de conversão (import do base64 -> convert para pdf -> export por
// url) e devolve o id do job para acompanhar.
async function createConversionJob(base64, filename) {
  const body = {
    tasks: {
      'import-1': { operation: 'import/base64', file: base64, filename },
      'convert-1': { operation: 'convert', input: 'import-1', output_format: 'pdf' },
      'export-1': { operation: 'export/url', input: 'convert-1' },
    },
  };
  const json = await cloudConvertRequest('/jobs', { method: 'POST', body: JSON.stringify(body) });
  return json.data.id;
}

async function getJob(jobId) {
  const json = await cloudConvertRequest(`/jobs/${jobId}`);
  return json.data;
}

// Converte um .docx (Buffer) em PDF (Buffer). Faz polling do job por até
// `maxWaitMs` (funções serverless têm timeout curto — ver nota no route.js).
// Lança erro se não terminar a tempo ou se o CloudConvert reportar falha.
export async function convertDocxToPdf(buffer, filename, { maxWaitMs = 8000, pollMs = 1000 } = {}) {
  const base64 = buffer.toString('base64');
  const jobId = await createConversionJob(base64, filename);

  const deadline = Date.now() + maxWaitMs;
  let job = await getJob(jobId);

  while (job.status !== 'finished' && job.status !== 'error' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    job = await getJob(jobId);
  }

  if (job.status === 'error') {
    const failedTask = (job.tasks || []).find((t) => t.status === 'error');
    throw new Error(`CloudConvert falhou: ${failedTask?.message || 'erro desconhecido'}`);
  }
  if (job.status !== 'finished') {
    throw new Error('TIMEOUT');
  }

  const exportTask = (job.tasks || []).find((t) => t.name === 'export-1');
  const fileUrl = exportTask?.result?.files?.[0]?.url;
  if (!fileUrl) {
    throw new Error('CloudConvert terminou mas não devolveu a URL do arquivo.');
  }

  const pdfRes = await fetch(fileUrl);
  if (!pdfRes.ok) {
    throw new Error(`Falha ao baixar PDF convertido: ${pdfRes.status}`);
  }
  const arrayBuffer = await pdfRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
