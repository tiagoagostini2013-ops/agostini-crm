'use client';

import { useState } from 'react';

// Modal obrigatório de handoff de entrega — aberto quando o vendedor muda o
// estágio do lead para "Fechado". Trava o fechamento até o vendedor
// principal registrar o vendedor secundário e o contexto da venda, conforme
// o processo comercial descrito em "Processo Comercial - Fábrica de
// Vendas": o secundário é ADICIONADO como responsável (não substitui o
// principal), e o contexto (o que foi vendido, combinados feitos,
// particularidades do cliente) fica registrado como anotação no CRM.
export default function HandoffModal({ item, meta, currentResponsavelIds, onConfirm, onCancel, saving, error }) {
  const [secondaryId, setSecondaryId] = useState('');
  const [note, setNote] = useState('');

  // A pessoa já responsável não precisa aparecer como opção de "secundário"
  // — na prática quase sempre vai ser alguém novo entrando na entrega, mas
  // não bloqueamos escolher alguém que já esteja na lista, pra não travar em
  // casos legítimos (ex: reafirmar quem já está e só trocar o contexto).
  const users = meta.users || [];
  const canConfirm = Boolean(secondaryId) && note.trim().length > 0 && !saving;

  function handleConfirmClick() {
    if (!canConfirm) return;
    onConfirm({ secondaryId, note: note.trim() });
  }

  return (
    <div className="proposal-viewer-backdrop" onClick={saving ? undefined : onCancel}>
      <div
        className="proposal-viewer-modal"
        style={{ width: 'min(520px, 100%)', height: 'auto', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="proposal-viewer-header">
          <span>🤝 Handoff de entrega — {item.name}</span>
          <div className="proposal-viewer-actions">
            <button className="close" onClick={onCancel} disabled={saving} aria-label="Fechar">
              ×
            </button>
          </div>
        </div>

        <div className="proposal-viewer-body" style={{ overflowY: 'auto' }}>
          <div className="drawer-section" style={{ borderBottom: 'none' }}>
            <div className="banner banner-warning" style={{ marginBottom: 14, borderRadius: 8 }}>
              Fechar este lead exige registrar a troca de responsável com o time de pós-venda. O vendedor
              secundário é adicionado junto com você — o combinado com o cliente fica anotado no histórico do
              CRM.
            </div>

            {error && <div className="banner banner-error" style={{ marginBottom: 14, borderRadius: 8 }}>{error}</div>}

            <div className="field">
              <label>Vendedor secundário (recebe a entrega) *</label>
              <select value={secondaryId} onChange={(e) => setSecondaryId(e.target.value)} disabled={saving}>
                <option value="">Selecione...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {currentResponsavelIds?.includes(String(u.id)) ? ' (já responsável)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Contexto da venda (o que foi vendido, combinados feitos, particularidades do cliente) *</label>
              <textarea
                className="note-textarea"
                style={{ minHeight: 100 }}
                placeholder="Ex: vendida a forma modelo X com entrega em 30 dias; cliente pediu treinamento na instalação; combinado desconto de 5% na próxima compra..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={saving}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
              <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleConfirmClick} disabled={!canConfirm}>
                {saving ? 'Registrando...' : 'Confirmar entrega'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
