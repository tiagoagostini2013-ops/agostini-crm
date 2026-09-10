'use client';

import { useState } from 'react';

// Botão "+ Novo Pós-venda" — pedido do Tiago em 10/09/2026: muito cliente já
// comprava da Agostini antes do CRM existir, e hoje não tem como lançar uma
// venda de peça de reposição pra esses clientes porque eles nunca tiveram um
// card no board (a seção "Vendas adicionais" do LeadDrawer só funciona em
// cima de um item que já existe). Este modal resolve isso num passo só:
// cadastra o cliente direto como "Fechado" (pulando o funil de vendas
// inteiro — não é um lead novo, é um cliente que já existe) e, se a peça já
// foi vendida na hora, registra a primeira venda adicional junto.
//
// Mantido de propósito bem enxuto (só nome + vendedor responsável são
// obrigatórios) — o Tiago confirmou que são MUITOS clientes nessa situação,
// então o formulário precisa ser rápido de preencher em série, não completo.
export default function NovoPosVendaModal({ meta, currentUser, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [telefone, setTelefone] = useState('');
  const [segmento, setSegmento] = useState('');
  // Se quem está logado tem um usuário do monday vinculado, já vem
  // pré-selecionado como vendedor pós-venda — é o caso mais comum (o próprio
  // vendedor de pós-venda lançando o cliente dele).
  const [vendedorPosVenda, setVendedorPosVenda] = useState(
    currentUser?.mondayUserId ? String(currentUser.mondayUserId) : ''
  );
  // Venda adicional opcional, registrada junto na criação (o motivo real de
  // existir este botão: lançar a peça de reposição já vendida).
  const [vendaDescricao, setVendaDescricao] = useState('');
  const [vendaValor, setVendaValor] = useState('');
  const [vendaData, setVendaData] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const nomeCliente = name.trim() || empresa.trim();
    if (!nomeCliente) {
      setError('Informe ao menos o nome do cliente ou a empresa.');
      return;
    }
    if (!vendedorPosVenda) {
      setError('Escolha quem vai ficar responsável pelo pós-venda deste cliente.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const fields = {
        // Pula o funil inteiro de propósito — não é um lead em prospecção,
        // é um cliente que já existe. Ver nota em lib/config.js.
        estagio: 'Fechado',
        estagioPosVenda: 'Em Acompanhamento',
        vendedorPosVenda,
        responsavelIds: [vendedorPosVenda],
        clienteHistorico: true,
      };
      if (empresa.trim()) fields.empresa = empresa.trim();
      if (telefone.trim()) fields.telefone = telefone.trim();
      if (segmento) fields.segmento = segmento;

      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nomeCliente, fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar o cliente.');

      // Se a venda já foi preenchida, registra ela junto — mesma rota
      // dedicada usada pelo LeadDrawer (leitura-modificação-escrita).
      const descricaoLimpa = vendaDescricao.trim();
      if (descricaoLimpa) {
        const vendaRes = await fetch(`/api/items/${data.item.id}/vendas-adicionais`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            descricao: descricaoLimpa,
            valor: vendaValor,
            data: vendaData,
            registradoPor: currentUser?.name,
          }),
        });
        if (!vendaRes.ok) {
          const vendaData_ = await vendaRes.json().catch(() => ({}));
          // O cliente já foi criado com sucesso — não perdemos isso, só
          // avisamos que a venda em si não entrou, pra registrar de novo
          // depois pelo card do cliente.
          throw new Error(
            `Cliente cadastrado, mas a venda não foi registrada: ${vendaData_.error || 'erro desconhecido'}. Abra o card do cliente e registre de novo pela aba Pós-venda.`
          );
        }
      }

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
            <h2>Novo Pós-venda</h2>
            <div className="empresa">
              Pra cliente que já comprou antes do CRM existir — entra direto como "Fechado", sem passar pelo funil.
            </div>
          </div>
          <button className="close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <div className="drawer-section">
          <h3>Cliente</h3>
          <div className="field">
            <label>Nome do cliente *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Lucas Andrade"
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
              <label>Vendedor pós-venda responsável *</label>
              <select value={vendedorPosVenda} onChange={(e) => setVendedorPosVenda(e.target.value)}>
                <option value="">—</option>
                {meta.users.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Já registrar uma venda agora (opcional)</h3>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: -6, marginBottom: 12 }}>
            Se este cadastro já é pra lançar uma peça de reposição vendida, preencha aqui — fica registrado direto no
            cliente. Se preferir só cadastrar o cliente por enquanto, deixe em branco.
          </p>
          <div className="field-row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ maxWidth: 150, marginBottom: 0 }}>
              <label>Data</label>
              <input type="date" value={vendaData} onChange={(e) => setVendaData(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 2, marginBottom: 0 }}>
              <label>O que foi vendido</label>
              <input
                placeholder="Ex: kit de peças de reposição"
                value={vendaDescricao}
                onChange={(e) => setVendaDescricao(e.target.value)}
              />
            </div>
            <div className="field" style={{ maxWidth: 130, marginBottom: 0 }}>
              <label>Valor (R$)</label>
              <input type="number" value={vendaValor} onChange={(e) => setVendaValor(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="drawer-section">
          <button className="btn btn-primary" disabled={saving} onClick={submit}>
            {saving ? 'Salvando...' : 'Cadastrar cliente'}
          </button>
        </div>
      </div>
    </>
  );
}
