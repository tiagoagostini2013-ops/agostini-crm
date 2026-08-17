'use client';

import { useState } from 'react';

// Formulário de criação manual de lead — usa o mesmo endpoint POST /api/items
// que já existia no backend (pensado para leads que chegam por telefone e não
// passam pela extensão do Chrome). O lead sempre entra no estágio "Lead".
export default function NewLeadModal({ meta, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [telefone, setTelefone] = useState('');
  const [produtoInteresse, setProdutoInteresse] = useState('');
  const [segmento, setSegmento] = useState('');
  const [canalOrigem, setCanalOrigem] = useState('');
  const [responsavelIds, setResponsavelIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleResponsavel(idStr) {
    setResponsavelIds((prev) => (prev.includes(idStr) ? prev.filter((x) => x !== idStr) : [...prev, idStr]));
  }

  async function submit() {
    const leadName = name.trim() || empresa.trim();
    if (!leadName) {
      setError('Informe ao menos o nome do lead ou a empresa.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const fields = {};
      if (empresa.trim()) fields.empresa = empresa.trim();
      if (telefone.trim()) fields.telefone = telefone.trim();
      if (produtoInteresse.trim()) fields.produtoInteresse = produtoInteresse.trim();
      if (segmento) fields.segmento = segmento;
      if (canalOrigem) fields.canalOrigem = canalOrigem;
      if (responsavelIds.length) fields.responsavelIds = responsavelIds;

      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: leadName, fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar lead.');
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div>
            <h2>Novo lead</h2>
            <div className="empresa">Entra direto no estágio "Lead"</div>
          </div>
          <button className="close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <div className="drawer-section">
          <div className="field">
            <label>Nome do lead *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: João Pedro - Fábrica X"
              autoFocus
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Empresa</label>
              <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
            </div>
            <div className="field">
              <label>Telefone</label>
              <input value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Produto / aplicação de interesse</label>
            <input value={produtoInteresse} onChange={(e) => setProdutoInteresse(e.target.value)} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Segmento</label>
              <select value={segmento} onChange={(e) => setSegmento(e.target.value)}>
                <option value="">—</option>
                {meta.segmentos.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Canal de origem</label>
              <select value={canalOrigem} onChange={(e) => setCanalOrigem(e.target.value)}>
                <option value="">—</option>
                {meta.canais.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
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

          <button className="btn btn-primary" disabled={saving} onClick={submit}>
            {saving ? 'Criando...' : 'Criar lead'}
          </button>
        </div>
      </div>
    </>
  );
}
