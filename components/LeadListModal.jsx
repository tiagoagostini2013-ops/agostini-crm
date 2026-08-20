'use client';

// Modal genérico de "drill-down": abre a lista real de leads por trás de um
// número agregado (KPI, barra de funil, linha de tabela...). Pedido do
// Tiago em 20/08/2026 — a aba Métricas (e o Gerencial, admin-only) mostrava
// só números, sem nenhum jeito de ver ou abrir os leads que os compõem.
// Reaproveitado nas duas telas em vez de duplicar a lógica de modal.
//
// `sections` é uma lista de { label?, leads } — a maioria dos casos usa uma
// seção só (sem cabeçalho próprio, já que o título do modal já diz do que se
// trata); a evolução semanal do Gerencial usa 3 seções (novos/qualificados/
// fechados da mesma semana) num modal só.
function formatMoney(v) {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function LeadsTable({ leads, usersById, onSelectLead }) {
  if (!leads.length) {
    return <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem', padding: '4px 0 12px' }}>Nenhum lead encontrado.</div>;
  }
  return (
    <table className="metrics-table" style={{ marginBottom: 16 }}>
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Segmento</th>
          <th>Estágio</th>
          <th>Responsável(is)</th>
          <th>Valor</th>
        </tr>
      </thead>
      <tbody>
        {leads.map((it) => (
          <tr key={it.id} className="row-clickable" onClick={() => onSelectLead(it.id)} title="Abrir lead">
            <td>
              <strong>{it.name}</strong>
              {it.empresa && <div style={{ color: 'var(--ink-soft)', fontSize: '0.78rem' }}>{it.empresa}</div>}
            </td>
            <td>{it.segmento || '—'}</td>
            <td>{it.estagio || '—'}</td>
            <td>
              {(it.responsavelIds || []).map((id) => usersById?.[id]?.name).filter(Boolean).join(', ') ||
                'Sem responsável'}
            </td>
            <td>{formatMoney(it.valorEstimado) || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function LeadListModal({ title, subtitle, sections, usersById, onSelectLead, onClose }) {
  const list = sections && sections.length ? sections : [{ leads: [] }];
  return (
    <div className="proposal-viewer-backdrop" onClick={onClose}>
      <div
        className="proposal-viewer-modal"
        style={{ width: 'min(760px, 100%)', height: 'auto', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="proposal-viewer-header">
          <span>{title}</span>
          <div className="proposal-viewer-actions">
            <button className="close" onClick={onClose} aria-label="Fechar">
              ×
            </button>
          </div>
        </div>
        <div className="proposal-viewer-body" style={{ overflowY: 'auto', padding: 16 }}>
          {subtitle && (
            <p style={{ color: 'var(--ink-soft)', fontSize: '0.82rem', marginTop: 0, marginBottom: 14 }}>{subtitle}</p>
          )}
          {list.map((section, i) => (
            <div key={section.label || i}>
              {list.length > 1 && (
                <h4 style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-soft)', margin: '0 0 8px' }}>
                  {section.label} ({section.leads.length})
                </h4>
              )}
              <LeadsTable leads={section.leads} usersById={usersById} onSelectLead={onSelectLead} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
