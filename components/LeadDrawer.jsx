'use client';

import { useEffect, useRef, useState } from 'react';
import { MONDAY_ACCOUNT_URL, BOARD_ID_PUBLIC } from '../lib/publicConfig';
import { uploadWithRetry } from '../lib/blobUpload';
import ProposalViewerModal from './ProposalViewerModal';
import HandoffModal from './HandoffModal';
import { statusLeituraRegistro, STATUS_LEITURA, STATUS_LEITURA_COR } from '../lib/proposalTrackStatus';

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('pt-BR');
  } catch {
    return d;
  }
}

// Formata milissegundos acumulados de visualização como "Xmin" (ou "Xs" se
// menos de 1 minuto) — não precisa de mais precisão que isso pra uma
// estimativa de tempo de leitura.
function fmtDuration(ms) {
  if (!ms || ms < 1000) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  return `${Math.round(totalSec / 60)}min`;
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
  const [pendingCloseChanges, setPendingCloseChanges] = useState(null); // mudanças pendentes até confirmar o handoff
  const [handoffSaving, setHandoffSaving] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  // Rastreio de leitura de propostas (PDF gerado pelo suplemento do Word) —
  // só leitura aqui, o registro em si é criado em
  // app/api/word-addin/finalize/route.js. `copyingSendId` controla o botão
  // "copiar link de novo" de cada envio individualmente.
  const rastreioPropostas = item.rastreioPropostas || [];
  const [copyingSendId, setCopyingSendId] = useState(null);
  const [copiedSendId, setCopiedSendId] = useState(null);

  async function handleCopyTrackLink(sendId) {
    setCopyingSendId(sendId);
    try {
      const res = await fetch(`/api/proposals/track/${item.id}/${sendId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível gerar o link.');
      await navigator.clipboard.writeText(data.url);
      setCopiedSendId(sendId);
      setTimeout(() => setCopiedSendId((cur) => (cur === sendId ? null : cur)), 2000);
    } catch (err) {
      setFileError(err.message);
    } finally {
      setCopyingSendId(null);
    }
  }

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

  // Devolve true/false pra quem chamou saber se salvou de verdade — o fluxo
  // de handoff obrigatório (ver handleConfirmHandoff) só deve registrar a
  // anotação de entrega depois de confirmar que a troca de responsável e o
  // estágio "Fechado" foram salvos com sucesso no monday.com.
  async function save(extra, opts) {
    const changed = { ...diff(), ...(extra || {}) };
    if (Object.keys(changed).length === 0) return true;
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
      return true;
    } catch (err) {
      setError(err.message);
      return opts?.returnErrorMessage ? err.message : false;
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

  const contatos = form.contatos || [];

  function updateContato(index, key, value) {
    const next = contatos.map((c, i) => (i === index ? { ...c, [key]: value } : c));
    update('contatos', next);
  }

  function addContato() {
    update('contatos', [...contatos, { name: '', role: '', phone: '' }]);
  }

  function removeContato(index) {
    update('contatos', contatos.filter((_, i) => i !== index));
  }

  // Intercepta o clique de "Salvar alterações": se a mudança envolve virar o
  // lead para "Fechado", não salva direto — abre o handoff obrigatório (ver
  // Processo Comercial - Fábrica de Vendas: toda entrega exige adicionar o
  // vendedor secundário como responsável + registrar o contexto da venda).
  function handleSaveClick() {
    const changed = diff();
    if (changed.estagio === 'Fechado' && item.estagio !== 'Fechado') {
      setHandoffError('');
      setPendingCloseChanges(changed);
      return;
    }
    save();
  }

  async function handleConfirmHandoff({ secondaryId, note }) {
    setHandoffError('');
    setHandoffSaving(true);
    try {
      const mergedIds = Array.from(new Set([...responsavelIds, String(secondaryId)]));
      const result = await save({ ...pendingCloseChanges, responsavelIds: mergedIds }, { returnErrorMessage: true });
      if (result !== true) {
        // refletimos o erro no próprio modal, pra não obrigar a pessoa a
        // fechar o modal só pra ver o motivo da falha.
        setHandoffError(result || 'Não foi possível salvar. Tente novamente.');
        return;
      }

      const secondaryUser = (meta.users || []).find((u) => String(u.id) === String(secondaryId));
      const authorName = currentUser?.name || 'Vendedor';
      const noteBody = `🤝 Handoff de entrega registrado por ${authorName}. Vendedor secundário: ${
        secondaryUser?.name || secondaryId
      }. Contexto: ${note}`;

      try {
        const res = await fetch(`/api/items/${item.id}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: noteBody }),
        });
        const data = await res.json();
        if (res.ok) {
          setNotes((prev) => [
            { id: `tmp-${Date.now()}`, text: noteBody, author: authorName, createdAt: new Date().toISOString() },
            ...(prev || []),
          ]);
        }
      } catch {
        // A entrega já foi salva com sucesso — se só a anotação falhar, não
        // travamos o fluxo por isso (mesma lógica de addNote/handleFileSelected).
      }

      setPendingCloseChanges(null);
    } finally {
      setHandoffSaving(false);
    }
  }

  function handleCancelHandoff() {
    // Desfaz a escolha de "Fechado" no formulário — sem o handoff confirmado,
    // o estágio não muda.
    update('estagio', item.estagio);
    setPendingCloseChanges(null);
    setHandoffError('');
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
          <h3>Contatos e papéis de decisão</h3>
          {contatos.length === 0 && (
            <div style={{ color: '#8a97a3', fontSize: '0.85rem', marginBottom: 8 }}>
              Nenhum contato cadastrado. Registre quem aprova orçamento, quem exige especificação técnica etc.
            </div>
          )}
          {contatos.map((c, i) => (
            <div key={i} className="field-row" style={{ alignItems: 'flex-end', marginBottom: 8 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Nome</label>
                <input value={c.name || ''} onChange={(e) => updateContato(i, 'name', e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Papel na decisão</label>
                <input
                  value={c.role || ''}
                  placeholder="Ex: aprova orçamento, exige spec técnica..."
                  onChange={(e) => updateContato(i, 'role', e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 0, maxWidth: 130 }}>
                <label>Telefone</label>
                <input value={c.phone || ''} onChange={(e) => updateContato(i, 'phone', e.target.value)} />
              </div>
              <button
                type="button"
                className="proposta-delete-btn"
                title="Remover contato"
                style={{ marginBottom: 0 }}
                onClick={() => removeContato(i)}
              >
                🗑️
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={addContato}>
            + Adicionar contato
          </button>
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
          <h3>Rastreio de propostas enviadas</h3>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: -6, marginBottom: 12 }}>
            "Visualizada" só conta quando o link é aberto de verdade num navegador — colar num grupo/conversa do
            WhatsApp não conta, só o clique do cliente. Ainda assim é uma estimativa, não uma confirmação de leitura
            atenta: o tempo somado só conta enquanto a aba fica em primeiro plano, e reabrir o mesmo link soma no
            mesmo registro. 🔴 não visualizada · 🟠 visualizada com pouco tempo de leitura (menos de 4min) · ✅
            leitura completa (4min ou mais) — a mesma cor aparece no card do lead no Kanban, referente ao envio mais
            recente. "Baixada" conta cliques no botão "⬇ Baixar PDF" da própria página — não cobre quem salva pelo
            visualizador nativo do navegador, isso não gera nenhum aviso pra gente.
          </p>
          {rastreioPropostas.length === 0 ? (
            <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>
              Nenhuma proposta em PDF enviada com rastreio ainda — gere uma pelo suplemento do Word ("Vincular
              proposta ao CRM").
            </div>
          ) : (
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Enviada</th>
                  <th>Status</th>
                  <th>Tempo total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...rastreioPropostas]
                  .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
                  .map((r) => (
                    <tr key={r.sendId}>
                      <td>
                        {r.fileName}
                        {r.sentBy && <div style={{ color: 'var(--ink-soft)', fontSize: '0.78rem' }}>por {r.sentBy}</div>}
                      </td>
                      <td>{fmtDate(r.sentAt)}</td>
                      <td>
                        {(() => {
                          const status = statusLeituraRegistro(r);
                          if (status === STATUS_LEITURA.NAO_LIDA) {
                            return <span style={{ color: STATUS_LEITURA_COR[status] }}>🔴 Ainda não visualizada</span>;
                          }
                          const icone = status === STATUS_LEITURA.LIDA_BASTANTE ? '✅' : '🟠';
                          return (
                            <span style={{ color: STATUS_LEITURA_COR[status] }}>
                              {icone} Visualizada em {fmtDate(r.firstViewedAt)} ({r.viewCount}x)
                            </span>
                          );
                        })()}
                        {r.downloadCount > 0 && (
                          <div style={{ color: 'var(--ink-soft)', fontSize: '0.78rem', marginTop: 2 }}>
                            ⬇ Baixada {r.downloadCount}x pelo botão da página (última em {fmtDate(r.lastDownloadedAt)})
                          </div>
                        )}
                      </td>
                      <td>{fmtDuration(r.totalViewMs)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-link"
                          style={{ fontSize: '0.8rem' }}
                          disabled={copyingSendId === r.sendId}
                          onClick={() => handleCopyTrackLink(r.sendId)}
                        >
                          {copiedSendId === r.sendId ? '✅ Copiado' : copyingSendId === r.sendId ? '...' : '📋 Copiar link'}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
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

          <button className="btn btn-primary" disabled={!isDirty || saving} onClick={handleSaveClick}>
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

      {pendingCloseChanges && (
        <HandoffModal
          item={item}
          meta={meta}
          currentResponsavelIds={responsavelIds}
          saving={handoffSaving}
          error={handoffError}
          onConfirm={handleConfirmHandoff}
          onCancel={handleCancelHandoff}
        />
      )}
    </>
  );
}

function isoDateOnly(value) {
  // aceita "2026-08-20" ou "2026-08-20 10:00:00" vindos do monday
  return String(value).slice(0, 10);
}
