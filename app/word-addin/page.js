'use client';

import { useEffect, useRef, useState } from 'react';
import { uploadWithRetry } from '../../lib/blobUpload';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Se o servidor responder algo que não é JSON (ex: erro de infraestrutura,
// gateway fora do ar, timeout) — em vez de deixar o `res.json()` estourar um
// "Unexpected token..." ilegível pro vendedor, mostra uma mensagem decente
// com o começo da resposta crua, pra dar pista do que houve.
async function parseJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Resposta inesperada do servidor (${res.status}): ${text.slice(0, 200) || 'vazia'}`);
  }
}

const FIELD_LABELS = [
  { key: 'name', label: 'Nome do contato' },
  { key: 'empresa', label: 'Empresa' },
  { key: 'telefone', label: 'Telefone' },
  { key: 'produtoInteresse', label: 'Produto/Serviço de interesse' },
  { key: 'valorEstimado', label: 'Valor estimado' },
  { key: 'segmento', label: 'Segmento' },
  { key: 'cargoDecisor', label: 'Cargo do decisor' },
];

// Pega o .docx inteiro que está aberto no Word (bytes crus, comprimido) e
// devolve como Blob — já os bytes puros, sem passar por base64 (que só
// inflaria o tamanho em ~33% à toa, e o suplemento manda o arquivo direto
// pro Vercel Blob, não mais pro nosso backend, ver handleFinalize). O
// Office.js não tem um jeito de "exportar como PDF" o documento aberto, por
// isso a conversão pra PDF acontece do lado do servidor, a partir deste
// mesmo .docx.
function getDocumentAsBlob() {
  return new Promise((resolve, reject) => {
    if (!window.Office || !window.Office.context?.document) {
      reject(new Error('Suplemento não está rodando dentro do Word.'));
      return;
    }
    window.Office.context.document.getFileAsync(
      window.Office.FileType.Compressed,
      { sliceSize: 65536 },
      (result) => {
        if (result.status !== window.Office.AsyncResultStatus.Succeeded) {
          reject(new Error(result.error?.message || 'Falha ao acessar o documento.'));
          return;
        }
        const file = result.value;
        if (file.sliceCount === 0) {
          file.closeAsync();
          resolve(new Blob([], { type: DOCX_MIME }));
          return;
        }
        const slices = [];
        let received = 0;
        function getSlice(index) {
          file.getSliceAsync(index, (sliceResult) => {
            if (sliceResult.status !== window.Office.AsyncResultStatus.Succeeded) {
              file.closeAsync();
              reject(new Error(sliceResult.error?.message || 'Falha ao ler o documento.'));
              return;
            }
            slices[index] = sliceResult.value.data;
            received += 1;
            if (received === file.sliceCount) {
              file.closeAsync();
              resolve(new Blob(slices.map((s) => new Uint8Array(s)), { type: DOCX_MIME }));
            } else {
              getSlice(index + 1);
            }
          });
        }
        getSlice(0);
      }
    );
  });
}

function insertAtCursor(text, onError) {
  if (!window.Word) {
    onError('Suplemento não está rodando dentro do Word.');
    return;
  }
  window.Word.run(async (context) => {
    const range = context.document.getSelection();
    range.insertText(String(text ?? ''), window.Word.InsertLocation.replace);
    await context.sync();
  }).catch((err) => onError(err.message || 'Erro ao inserir no documento.'));
}

export default function WordAddinPage() {
  const [officeReady, setOfficeReady] = useState(false);
  const [officeError, setOfficeError] = useState('');
  const [userName, setUserName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const debounceRef = useRef(null);
  const cancelControllerRef = useRef(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setUserName(data.name))
      .catch(() => {});

    if (window.Office) {
      window.Office.onReady(() => setOfficeReady(true));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://appsforoffice.microsoft.com/lib/1/hosted/office.js';
    script.onload = () => window.Office.onReady(() => setOfficeReady(true));
    script.onerror = () =>
      setOfficeError('Não foi possível carregar o Office.js — abra esta página de dentro do Word.');
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/word-addin/search?q=${encodeURIComponent(query.trim())}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        setResults(res.ok ? data.items || [] : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  function handleCancelUpload() {
    cancelControllerRef.current?.abort();
  }

  async function handleFinalize() {
    if (!selected) return;
    setFinalizing(true);
    setStatus('Lendo o documento...');
    const cancelController = new AbortController();
    cancelControllerRef.current = cancelController;
    try {
      // Checa antes de tentar subir: se o Vercel Blob não estiver configurado
      // no servidor, a biblioteca de upload só devolve um erro genérico
      // ("Failed to retrieve the client token") que não ajuda ninguém a
      // resolver — aqui a gente já avisa o que realmente falta.
      const statusRes = await fetch(`/api/word-addin/blob-status?t=${Date.now()}`, { cache: 'no-store' });
      const statusData = await parseJsonResponse(statusRes).catch(() => ({ configured: true }));
      if (statusRes.ok && statusData.configured === false) {
        throw new Error(
          'O envio de propostas ainda não está configurado neste servidor. Peça para quem administra o painel criar o Blob Store na Vercel (Storage → Create Database → Blob) e reimplantar o projeto.'
        );
      }

      const fileBlob = await getDocumentAsBlob();
      const fileName = `Proposta - ${selected.name || 'Cliente'}.docx`;
      const fileSizeMb = fileBlob.size / (1024 * 1024);

      // Sobe o arquivo direto pro Vercel Blob (bypassa nosso backend) — uma
      // proposta técnica com fotos/desenhos passa fácil dos 4.5MB que uma
      // função da Vercel aceita num POST só, então só a URL do resultado
      // (bem pequena) é que vai pro /finalize.
      setStatus(`Enviando o arquivo (${fileSizeMb.toFixed(1)}MB)... 0%`);
      let blobResult;
      try {
        blobResult = await uploadWithRetry(fileName, fileBlob, {
          handleUploadUrl: '/api/word-addin/blob-upload',
          contentType: DOCX_MIME,
          externalSignal: cancelController.signal,
          onStatus: ({ percentage, attempt, retrying, elapsedSeconds }) => {
            if (retrying) {
              setStatus(`Conexão travou perto do fim do envio. Tentando de novo (tentativa ${attempt}/4)...`);
            } else {
              setStatus(
                `Enviando o arquivo (${fileSizeMb.toFixed(1)}MB)... ${percentage}%` +
                  (attempt > 1 ? ` (tentativa ${attempt}/4)` : '') +
                  (elapsedSeconds != null ? ` — ${elapsedSeconds}s` : '')
              );
            }
          },
        });
      } catch (err) {
        // A biblioteca do Vercel Blob esconde o motivo real por trás de uma
        // mensagem genérica ("Failed to retrieve the client token") em caso de
        // erro de sessão/configuração — como já checamos a configuração acima,
        // se chegou aqui é provável que seja a sessão (tente sair e entrar de
        // novo no suplemento). uploadWithRetry já tenta de novo sozinho antes
        // de desistir (ver lib/blobUpload.js).
        throw new Error(
          err.message === 'envio cancelado.'
            ? 'envio cancelado.'
            : `Falha ao enviar o arquivo: ${err.message}. Se persistir, feche este painel e abra de novo para renovar o login.`
        );
      }

      setStatus('Vinculando ao CRM...');
      const res = await fetch('/api/word-addin/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: selected.id,
          blobUrl: blobResult.url,
          fileName,
        }),
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data.error || 'Falha ao vincular.');
      setStatus('✅ Word anexado ao lead no monday.com.');
    } catch (err) {
      setStatus(`❌ ${err.message}`);
    } finally {
      setFinalizing(false);
      cancelControllerRef.current = null;
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <img src="/logo.png" alt="Agostini" style={styles.brandLogo} />
        <strong style={styles.brand}>CRM Agostini</strong>
        <span style={styles.subBrand}>Suplemento do Word</span>
        {userName && <span style={styles.userChip}>{userName}</span>}
      </header>

      {officeError && <div style={styles.warn}>{officeError}</div>}
      {!officeReady && !officeError && <div style={styles.info}>Carregando...</div>}

      {officeReady && (
        <div style={styles.body}>
          {!selected ? (
            <>
              <label style={styles.label}>Buscar cliente/lead</label>
              <input
                style={styles.input}
                type="text"
                placeholder="Nome ou empresa..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              {searching && <div style={styles.info}>Buscando...</div>}
              {!searching && query.trim().length >= 2 && results.length === 0 && (
                <div style={styles.info}>Nenhum lead encontrado.</div>
              )}
              <div style={styles.results}>
                {results.map((item) => (
                  <button key={item.id} style={styles.resultItem} onClick={() => setSelected(item)}>
                    <div style={styles.resultName}>{item.name}</div>
                    {item.empresa && <div style={styles.resultSub}>{item.empresa}</div>}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={styles.selectedBox}>
                <div>
                  <div style={styles.resultName}>{selected.name}</div>
                  {selected.empresa && <div style={styles.resultSub}>{selected.empresa}</div>}
                </div>
                <button
                  style={styles.linkBtn}
                  onClick={() => {
                    setSelected(null);
                    setStatus('');
                    setQuery('');
                  }}
                >
                  Trocar cliente
                </button>
              </div>

              <div style={styles.sectionTitle}>Inserir dados no texto</div>
              <div style={styles.fieldList}>
                {FIELD_LABELS.map(({ key, label }) => {
                  const value = selected[key];
                  if (!value) return null;
                  return (
                    <div key={key} style={styles.fieldRow}>
                      <div style={styles.fieldText}>
                        <div style={styles.fieldLabel}>{label}</div>
                        <div style={styles.fieldValue}>{value}</div>
                      </div>
                      <button
                        style={styles.insertBtn}
                        onClick={() => insertAtCursor(value, (msg) => setStatus(`❌ ${msg}`))}
                      >
                        Inserir
                      </button>
                    </div>
                  );
                })}
              </div>

              <div style={styles.sectionTitle}>Finalizar</div>
              <button style={styles.primaryBtn} disabled={finalizing} onClick={handleFinalize}>
                {finalizing ? 'Enviando...' : 'Vincular proposta ao CRM'}
              </button>
              {finalizing && (
                <button
                  type="button"
                  style={{ ...styles.linkBtn, display: 'block', margin: '8px auto 0' }}
                  onClick={handleCancelUpload}
                >
                  Cancelar envio
                </button>
              )}
              <p style={styles.hint}>
                Isso anexa o arquivo do Word direto no card deste cliente no monday.com — pode fazer
                isso quantas vezes quiser conforme for editando a proposta; a versão mais recente
                sempre fica registrada.
              </p>
            </>
          )}

          {status && <div style={styles.status}>{status}</div>}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    fontFamily: '-apple-system, Segoe UI, Roboto, sans-serif',
    fontSize: 13,
    color: '#16212c',
    padding: '12px 14px',
    height: '100vh',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderBottom: '2px solid #0B5D42',
    paddingBottom: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  brandLogo: { width: 20, height: 20, flexShrink: 0 },
  brand: { color: '#0B5D42', fontSize: 15 },
  subBrand: { color: '#56636f', fontSize: 12 },
  userChip: {
    marginLeft: 'auto',
    background: '#E8F4F0',
    color: '#0B5D42',
    borderRadius: 999,
    padding: '2px 10px',
    fontSize: 11,
  },
  body: { flex: 1, overflowY: 'auto' },
  label: { display: 'block', fontSize: 12, color: '#56636f', marginBottom: 4 },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid #d5dbe0',
    fontSize: 13,
    marginBottom: 8,
  },
  info: { color: '#56636f', fontSize: 12, padding: '6px 0' },
  warn: { color: '#b3261e', fontSize: 12, padding: '8px', background: '#fbeceb', borderRadius: 6, marginBottom: 8 },
  results: { display: 'flex', flexDirection: 'column', gap: 6 },
  resultItem: {
    textAlign: 'left',
    border: '1px solid #e2e6e9',
    background: '#fff',
    borderRadius: 8,
    padding: '8px 10px',
    cursor: 'pointer',
  },
  resultName: { fontWeight: 600 },
  resultSub: { color: '#56636f', fontSize: 12 },
  selectedBox: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: '#F5F8F7',
    border: '1px solid #d5e6e0',
    borderRadius: 8,
    padding: '8px 10px',
    marginBottom: 14,
  },
  linkBtn: { background: 'none', border: 'none', color: '#0B5D42', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' },
  sectionTitle: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#56636f', margin: '14px 0 8px' },
  fieldList: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    border: '1px solid #e2e6e9',
    borderRadius: 8,
    padding: '6px 10px',
  },
  fieldText: { minWidth: 0 },
  fieldLabel: { fontSize: 11, color: '#56636f' },
  fieldValue: { fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  insertBtn: {
    flexShrink: 0,
    background: '#fff',
    border: '1px solid #0B5D42',
    color: '#0B5D42',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
  },
  primaryBtn: {
    width: '100%',
    background: '#0B5D42',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  hint: { fontSize: 11, color: '#56636f', marginTop: 8, lineHeight: 1.4 },
  status: { marginTop: 14, fontSize: 12, padding: '8px 10px', background: '#F5F8F7', borderRadius: 8 },
};
