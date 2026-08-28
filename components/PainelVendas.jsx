'use client';

import { useEffect, useMemo, useState } from 'react';
import { TEMPERATURAS_PAINEL_VENDAS } from '../lib/config';

// Painel de Vendas semanal (pedido do Tiago em 28/08/2026) — reproduz dentro
// do CRM o resumo manual que ele já fazia num caderno: uma lista de negócios
// em andamento (nome, valor, status "ok", "temperatura" Frio/Morno/Quente/
// Fechado) e um fechamento da semana com quatro categorias narrativas,
// digitadas livremente (Apalavreamentos, Evoluções, Surgidos, Perdidas).
// Tudo manual, sem vínculo com os leads do funil principal — ver nota em
// lib/config.js sobre o board separado que guarda isso (um item por semana).

function blankNegocio() {
  return { nome: '', valor: '', ok: false, temperatura: 'Morno' };
}

function todayStr() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function fmtMoney(v) {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function fmtDatePt(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function blankForm() {
  return {
    inicioSemana: '',
    fimSemana: '',
    negocios: [blankNegocio()],
    apalavreamentos: '',
    evolucoes: '',
    surgidos: '',
    perdidas: '',
  };
}

export default function PainelVendas() {
  const [semanas, setSemanas] = useState(null);
  const [selectedId, setSelectedId] = useState(null); // null = nova semana não salva
  const [form, setForm] = useState(blankForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/painel-vendas');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar o painel de vendas.');
      setSemanas(data.semanas);
      if (data.semanas.length > 0) {
        selectSemana(data.semanas[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectSemana(s) {
    setSelectedId(s.id);
    setForm({
      inicioSemana: s.inicioSemana || '',
      fimSemana: s.fimSemana || '',
      negocios: s.negocios.length > 0 ? s.negocios.map((n) => ({ ...n })) : [blankNegocio()],
      apalavreamentos: s.apalavreamentos || '',
      evolucoes: s.evolucoes || '',
      surgidos: s.surgidos || '',
      perdidas: s.perdidas || '',
    });
    setError('');
  }

  function novaSemana(duplicarNegocios) {
    setSelectedId(null);
    const negociosBase =
      duplicarNegocios && semanas && semanas.length > 0
        ? semanas[0].negocios.map((n) => ({ ...n }))
        : [blankNegocio()];
    setForm({ ...blankForm(), inicioSemana: todayStr(), negocios: negociosBase });
    setError('');
  }

  function updateNegocio(index, patch) {
    setForm((f) => ({
      ...f,
      negocios: f.negocios.map((n, i) => (i === index ? { ...n, ...patch } : n)),
    }));
  }

  function addNegocio() {
    setForm((f) => ({ ...f, negocios: [...f.negocios, blankNegocio()] }));
  }

  function removeNegocio(index) {
    setForm((f) => ({ ...f, negocios: f.negocios.filter((_, i) => i !== index) }));
  }

  const total = useMemo(
    () => form.negocios.reduce((acc, n) => acc + (Number(n.valor) || 0), 0),
    [form.negocios]
  );

  async function salvar() {
    if (!form.inicioSemana || !form.fimSemana) {
      setError('Preencha início e fim da semana antes de salvar.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // Não manda linhas de negócio totalmente em branco (linha extra deixada
      // sem preencher) — só o que tem nome ou valor.
      const negocios = form.negocios.filter((n) => n.nome.trim() || n.valor);
      const payload = { ...form, negocios };

      const isNew = selectedId === null;
      const res = await fetch(isNew ? '/api/painel-vendas' : `/api/painel-vendas/${selectedId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar.');
      await load();
      if (isNew && data.id) setSelectedId(data.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function excluir() {
    if (selectedId === null) return;
    if (!confirm('Excluir esta semana do painel de vendas? Não dá pra desfazer.')) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/painel-vendas/${selectedId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro ao excluir.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="metrics-section">Carregando painel de vendas...</div>;

  return (
    <div className="painel-vendas">
      {error && <div className="banner banner-error">{error}</div>}

      <div className="painel-vendas-layout">
        <div className="metrics-section painel-vendas-sidebar">
          <h3>Semanas</h3>
          <button className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }} onClick={() => novaSemana(true)}>
            + Nova semana
          </button>
          {semanas.length === 0 && <div className="agenda-empty">Nenhuma semana registrada ainda.</div>}
          <div className="painel-vendas-semana-list">
            {semanas.map((s) => (
              <button
                key={s.id}
                className={`painel-vendas-semana-item${selectedId === s.id ? ' active' : ''}`}
                onClick={() => selectSemana(s)}
              >
                {fmtDatePt(s.inicioSemana)} – {fmtDatePt(s.fimSemana)}
              </button>
            ))}
          </div>
        </div>

        <div className="painel-vendas-main">
          <div className="metrics-section">
            <h3>Período da semana</h3>
            <div className="field-row">
              <div className="field">
                <label>Início</label>
                <input
                  type="date"
                  value={form.inicioSemana}
                  onChange={(e) => setForm((f) => ({ ...f, inicioSemana: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Fim</label>
                <input
                  type="date"
                  value={form.fimSemana}
                  onChange={(e) => setForm((f) => ({ ...f, fimSemana: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="metrics-section">
            <h3>Negócios da semana</h3>
            <div className="painel-vendas-negocios">
              <div className="painel-vendas-negocio-row painel-vendas-negocio-header">
                <span>OK</span>
                <span>Negócio</span>
                <span>Valor</span>
                <span>Temperatura</span>
                <span></span>
              </div>
              {form.negocios.map((n, i) => (
                <div className="painel-vendas-negocio-row" key={i}>
                  <input type="checkbox" checked={!!n.ok} onChange={(e) => updateNegocio(i, { ok: e.target.checked })} />
                  <input
                    type="text"
                    placeholder="Nome do negócio"
                    value={n.nome}
                    onChange={(e) => updateNegocio(i, { nome: e.target.value })}
                  />
                  <input
                    type="number"
                    placeholder="0"
                    value={n.valor}
                    onChange={(e) => updateNegocio(i, { valor: e.target.value })}
                  />
                  <select value={n.temperatura} onChange={(e) => updateNegocio(i, { temperatura: e.target.value })}>
                    {TEMPERATURAS_PAINEL_VENDAS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button className="painel-vendas-remove" title="Remover" onClick={() => removeNegocio(i)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={addNegocio}>
              + Adicionar negócio
            </button>
            {total > 0 && (
              <div className="painel-vendas-total">
                Total: <strong>{fmtMoney(total)}</strong>
              </div>
            )}
          </div>

          <div className="metrics-section">
            <h3>Fechamento da semana</h3>
            <div className="field">
              <label>1) Apalavreamentos</label>
              <textarea
                placeholder="Ex: Inka, Imi, Peretto, Rotary, Lucas + Minera — R$ 2.488.000,00 + R$ 500.000,00"
                value={form.apalavreamentos}
                onChange={(e) => setForm((f) => ({ ...f, apalavreamentos: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>2) Evoluções</label>
              <textarea
                placeholder="Ex: Minera, Sapata, Renan — R$ 1.570.000,00"
                value={form.evolucoes}
                onChange={(e) => setForm((f) => ({ ...f, evolucoes: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>3) Surgidos</label>
              <textarea
                placeholder="Ex: Tratre, Pré-lajes, Frank — R$ 560.000,00"
                value={form.surgidos}
                onChange={(e) => setForm((f) => ({ ...f, surgidos: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>4) Perdidas</label>
              <textarea
                placeholder="—"
                value={form.perdidas}
                onChange={(e) => setForm((f) => ({ ...f, perdidas: e.target.value }))}
              />
            </div>
          </div>

          <div className="painel-vendas-actions">
            <button className="btn btn-primary" onClick={salvar} disabled={saving}>
              {saving ? 'Salvando...' : selectedId === null ? 'Salvar semana' : 'Salvar alterações'}
            </button>
            {selectedId !== null && (
              <button className="btn btn-secondary" onClick={excluir} disabled={saving}>
                Excluir semana
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
