'use client';

import { useEffect, useRef, useState } from 'react';
import { MONDAY_ACCOUNT_URL, BOARD_ID_PUBLIC } from '../lib/publicConfig';
import { uploadWithRetry } from '../lib/blobUpload';
import ProposalViewerModal from './ProposalViewerModal';

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('pt-BR');
  } catch {
    return d;
  }
}

const QUALIFY_FIELDS = [
  { key: 'produtoInteresse', label: 'Aplicação / produto de interesse' },
  { key: 'cargoDecisor', label: 'Decisor identificado' },
  { key: 'segmento', label: 'Fit (segmento)' },
  { key: 'valorEstimado', label: 'Investimento estimado' },
  { key: 'proximoFollowUp', label: 'Urgência (próximo follow-up)' },
];

export default function LeadDrawer({ item, meta, currentUser, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...item }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [viewingProposal, setViewingProposal] = useState(null);
  const [arquivos, setArquivos] = useState(item.propostas || []);
  const [uploadingFile, setUploadingFile] = useState(null); // { name, status } | null
  const [deletingAssetId, setDeletingAssetId] = useState(null);
  const [fileError, setFileError] = useState('');
  const fileInputRef = useRef(null);
  const cancelUploadControllerRef = useRef(null);

  useEffect(() => {
    setForm({ ...item });
    setError('');
    setArquivos(item.propostas || []);
  }, [item]);

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    fetch(`/api/items/${item.id}/notes`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setNotes(data.notes || []);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function diff() {
    const changed = {};
    for (const key of Object.keys(form)) {
      if (JSON.stringify(form[key]) !== JSON.stringify(item[key])) {
        changed[key] = form[key];
      }
    }
    return changed;
  }

  async function save(extra) {
    const changed = { ...diff(), ...(extra || {}) };
    if (Object.keys(changed).length === 0) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changed),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar.');
      onSaved(item.id, { ...form, ...extra });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    // O monday.com sempre registra a atualização como vindo da conta dona do
    // token de API — então, pra saber de verdade quem escreveu, colocamos o
    // nome de quem está logado no próprio texto da anotação.
    const authorName = currentUser?.name;
    const fullText = authorName ? `${authorName}: ${noteText.trim()}` : noteText.trim();
    setAddingNote(true);
    setError('');
    try {
      const res = await fetch(`/api/items/${item.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fullText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar anotação.');
      setNotes((prev) => [
        { id: `tmp-${Date.now()}`, text: fullText, author: authorName || 'Você', createdAt: new Date().toISOString() },
        ...(prev || []),
      ]);
      setNoteText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingNote(false);
    }
  }

  async function handleFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo depois
    if (!file) return;

    setFileError('');
    const fileSizeMb = file.size / (1024 * 1024);
    setUploadingFile({ name: file.name, status: `Enviando (${fileSizeMb.toFixed(1)}MB)... 0%` });
    const cancelController = new AbortController();
    cancelUploadControllerRef.current = cancelController;

    try {
      // Mesma checagem do suplemento do Word: sem isso, se o Vercel Blob não
      // estiver configurado no servidor, o erro que aparece é um genérico
      // "Failed to retrieve the client token" que não ajuda ninguém.
      const statusRes = await fetch(`/api/word-addin/blob-status?t=${Date.now()}`, { cache: 'no-store' });
      const statusData = await statusRes.json().catch(() => ({ configured: true }));
      if (statusRes.ok && statusData.configured === false) {
        throw new Error(
          'O envio de arquivos ainda não está configurado neste servidor (peça para o administrador do painel criar o Blob Store na Vercel).'
        );
      }

      const blobResult = await uploadWithRetry(file.name, file, {
        handleUploadUrl: '/api/files/blob-upload',
        contentType: file.type || 'application/octet-stream',
        externalSignal: cancelController.signal,
        onStatus: ({ percentage, attempt, retrying, elapsedSeconds }) => {
          setUploadingFile({
            name: file.name,
            status: retrying
              ? `Conexão travou perto do fim. Tentando de novo (tentativa ${attempt}/4)...`
              : `Enviando (${fileSizeMb.toFixed(1)}MB)... ${percentage}%${attempt > 1 ? ` (tentativa ${attempt}/4)` : ''}` +
                (elapsedSeconds != null ? ` — ${elapsedSeconds}s` : ''),
          });
        },
      });

      setUploadingFile({ name: file.name, status: 'Vinculando ao lead...' });
      const res = await fetch(`/api/items/${item.id}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blobUrl: blobResult.url, fileName: file.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao anexar o arquivo.');
      setArquivos(data.arquivos || []);
    } catch (err) {
      setFileError(`Falha ao enviar "${file.name}": ${err.message}`);
    } finally {
      setUploadingFile(null);
      cancelUploadControllerRef.current = null;
    }
  }

  function handleCancelFileUpload() {
    cancelUploadControllerRef.current?.abort();
  }

  async function handleDeleteFile(file) {
    if (!window.confirm(`Remover "${file.name}" deste lead? Essa ação não pode ser desfeita.`)) return;
    setFileError('');
    setDeletingAssetId(file.assetId);
    try {
      const res = await fetch(`/api/items/${item.id}/files/${file.assetId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao remover o arquivo.');
      setArquivos(data.arquivos || []);
    } catch (err) {
      setFileError(`Falha ao remover "${file.name}": ${err.message}`);
    } finally {
      setDeletingAssetId(null);
    }
  }

  const qualifyCount = QUALIFY_FIELDS.filter((f) => form[f.key]).length;
  const isDirty = Object.keys(diff()).length > 0;
  const responsavelIds = form.responsavelIds || [];

  function toggleResponsavel(idStr) {
    const set = new Set(responsavelIds);
    if (set.has(idStr)) set.delete(idStr);
    else set.add(idStr);
    update('responsavelIds', Array.from(set));
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div>
            <h2>{item.name}</h2>
            <div className="empresa">{item.empresa || 'Sem empresa cadastrada'}</div>
          </div>
          <button className="close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <div className="drawer-section">
          <h3>Contato</h3>
          <div className="field">
            <label>Empresa</label>
            <input value={form.empresa || ''} onChange={(e) => update('empresa', e.target.value)} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Telefone</label>
              <input value={form.telefone || ''} onChange={(e) => update('telefone', e.target.value)} />
            </div>
            <div className="field">
              <label>Tipo de contato</label>
              <select value={form.tipoContato || ''} onChange={(e) => update('tipoContato', e.target.value)}>
                <option value="">—</option>
                {meta.tipos.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {item.whatsappUrl && (
            <a className="wa-link" href={item.whatsappUrl} target="_blank" rel="noreferrer">
              💬 Abrir WhatsApp
            </a>
          )}
          <a
            className="btn-link"
            style={{ display: 'block', marginTop: 10 }}
            href={`${MONDAY_ACCOUNT_URL}/boards/${BOARD_ID_PUBLIC}/pulses/${item.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Abrir no monday.com ↗
          </a>
        </div>

        <div className="drawer-section">
          <h3>Arquivos</h3>
          {fileError && <div className="banner banner-error">{fileError}</div>}
          {arquivos.length === 0 && !uploadingFile && (
            <div style={{ color: '#8a97a3', fontSize: '0.85rem', marginBottom: 8 }}>
              Nenhum arquivo vinculado ainda. Anexe propostas, orçamentos de frete, layouts do cliente etc.
            </div>
          )}
          {arquivos.length > 0 && (
            <div className="propostas-list">
              {arquivos.map((f) => (
                <div key={f.assetId} className="proposta-item-row">
                  <button type="button" className="proposta-item" onClick={() => setViewingProposal(f)}>
                    📄 {f.name}
                  </button>
                  <button
                    type="button"
                    className="proposta-delete-btn"
                    title="Remover arquivo"
                    disabled={deletingAssetId === f.assetId}
                    onClick={() => handleDeleteFile(f)}
                  >
                    {deletingAssetId === f.assetId ? '...' : '🗑️'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {uploadingFile && (
            <div style={{ color: '#037f4c', fontSize: '0.85rem', margin: '4px 0 8px' }}>
              {uploadingFile.name}: {uploadingFile.status}{' '}
              <button
                type="button"
                className="btn-link"
                style={{ fontSize: '0.85rem' }}
                onClick={handleCancelFileUpload}
              >
                Cancelar envio
              </button>
            </div>
          )}
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileSelected}
            disabled={Boolean(uploadingFile)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={Boolean(uploadingFile)}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadingFile ? 'Enviando...' : '+ Adicionar arquivo'}
          </button>
        </div>

        <div className="drawer-section">
          <h3>Qualificação do lead</h3>
          <div className="qualify-panel">
            <h4>
              {qualifyCount}/5 critérios preenchidos
            </h4>
            <div className="qualify-grid">
              {QUALIFY_FIELDS.map((f) => (
                <div key={f.key} className={form[f.key] ? 'yes' : 'missing'}>
                  {form[f.key] ? '✅' : '⬜'} {f.label}
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Produto / aplicação de interesse</label>
            <input
              value={form.produtoInteresse || ''}
              onChange={(e) => update('produtoInteresse', e.target.value)}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Segmento</label>
              <select value={form.segmento || ''} onChange={(e) => update('segmento', e.target.value)}>
                <option value="">—</option>
                {meta.segmentos.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Cargo do decisor</label>
              <select value={form.cargoDecisor || ''} onChange={(e) => update('cargoDecisor', e.target.value)}>
                <option value="">—</option>
                {meta.cargos.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Canal de origem</label>
              <select value={form.canalOrigem || ''} onChange={(e) => update('canalOrigem', e.target.value)}>
                <option value="">—</option>
                {meta.canais.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Valor estimado (R$)</label>
              <input
                type="number"
                value={form.valorEstimado || ''}
                onChange={(e) => update('valorEstimado', e.target.value)}
              />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Próximo follow-up</label>
              <input
                type="date"
                value={form.proximoFollowUp ? isoDateOnly(form.proximoFollowUp) : ''}
                onChange={(e) => update('proximoFollowUp', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Último contato</label>
              <input
                type="date"
                value={form.ultimoContato ? isoDateOnly(form.ultimoContato) : ''}
                onChange={(e) => update('ultimoContato', e.target.value)}
              />
            </div>
          </div>

          {qualifyCount >= 4 && form.estagio === 'Lead' && (
            <button
              className="btn btn-primary"
              style={{ marginBottom: 8 }}
              disabled={saving}
              onClick={() => save({ estagio: 'Qualificado' })}
            >
              ✅ Marcar como Qualificado e distribuir
            </button>
          )}
        </div>

        <div className="drawer-section">
          <h3>Estágio &amp; responsável</h3>
          <div className="field-row">
            <div className="field">
              <label>Estágio de vendas</label>
              <select value={form.estagio || ''} onChange={(e) => update('estagio', e.target.value)}>
                <option value="">—</option>
                {meta.stages.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.value}
                  </option>
                ))}
              </select>
            </div>
            {form.estagio === 'Perdido' && (
              <div className="field">
                <label>Motivo da perda</label>
                <select value={form.motivoPerda || ''} onChange={(e) => update('motivoPerda', e.target.value)}>
                  <option value="">—</option>
                  {meta.motivos.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="field">
            <label>Responsável(is)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {meta.users.map((u) => (
                <label
                  key={u.id}
                  className="chip"
                  style={{
                    cursor: 'pointer',
                    background: responsavelIds.includes(String(u.id)) ? '#007eb5' : '#eef2f5',
                    color: responsavelIds.includes(String(u.id)) ? '#fff' : 'inherit',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ display: 'none' }}
                    checked={responsavelIds.includes(String(u.id))}
                    onChange={() => toggleResponsavel(String(u.id))}
                  />
                  {u.name}
                </label>
              ))}
            </div>
          </div>

          <button className="btn btn-primary" disabled={!isDirty || saving} onClick={() => save()}>
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>

        <div className="drawer-section">
          <h3>Anotações</h3>
          <textarea
            className="note-textarea"
            placeholder="Registrar uma ligação, um combinado com o cliente..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <div className="note-actions">
            <button
              className="btn btn-secondary"
              disabled={addingNote || !noteText.trim()}
              onClick={addNote}
            >
              {addingNote ? 'Salvando...' : 'Adicionar anotação'}
            </button>
          </div>

          <div className="notes-list">
            {notes === null && <div style={{ color: '#8a97a3', fontSize: '0.85rem' }}>Carregando...</div>}
            {notes && notes.length === 0 && (
              <div style={{ color: '#8a97a3', fontSize: '0.85rem' }}>Nenhuma anotação ainda.</div>
            )}
            {notes &&
              notes.map((n) => (
                <div className="note-item" key={n.id}>
                  <div className="note-meta">
                    {n.author} — {fmtDate(n.createdAt)}
                  </div>
                  <div className="note-body">{n.text}</div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {viewingProposal && (
        <ProposalViewerModal
          proposal={viewingProposal}
          fallbackUrl={`${MONDAY_ACCOUNT_URL}/boards/${BOARD_ID_PUBLIC}/pulses/${item.id}`}
          onClose={() => setViewingProposal(null)}
        />
      )}
    </>
  );
}

function isoDateOnly(value) {
  // aceita "2026-08-20" ou "2026-08-20 10:00:00" vindos do monday
  return String(value).slice(0, 10);
}
