import { FERRAMENTAS } from '../../lib/ferramentas';

export const metadata = {
  title: 'Ferramentas — Agostini',
  description: 'Ponto de partida único para as ferramentas internas da Agostini.',
};

const BADGE_LABEL = {
  internet: 'Acessível de qualquer lugar',
  'rede-local': 'Só na rede da fábrica (ou VPN)',
};

export default function FerramentasPage() {
  return (
    <div className="ferramentas-page">
      <div className="ferramentas-header">
        <div className="ferramentas-brand">
          <img className="brand-logo" src="/logo.png" alt="Agostini" />
          <h1>Ferramentas Agostini</h1>
        </div>
        <a className="btn-link" href="/">
          ← Voltar ao CRM
        </a>
      </div>

      <p className="ferramentas-intro">
        Ponto de partida único para as ferramentas internas da empresa. Conforme novas ferramentas forem
        desenvolvidas, elas aparecem aqui.
      </p>

      <div className="ferramentas-grid">
        {FERRAMENTAS.map((f) => (
          <a key={f.nome} className="ferramenta-card" href={f.url} target="_blank" rel="noreferrer">
            <div className="ferramenta-nome">{f.nome}</div>
            <div className="ferramenta-desc">{f.descricao}</div>
            <span className={`ferramenta-badge badge-${f.onde}`}>{BADGE_LABEL[f.onde] || f.onde}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
