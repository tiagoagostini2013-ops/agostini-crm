'use client';

// Modal com visualizador embutido de uma proposta anexada (docx/pdf/etc.),
// aberto direto no CRM em vez de redirecionar para o monday.com.
//
// PDF: o próprio navegador sabe renderizar dentro de um iframe.
// docx/xlsx/pptx: usamos o visualizador público da Microsoft (Office Online
// Viewer), que só precisa de uma URL do arquivo acessível pela internet —
// exatamente o que a public_url do monday.com fornece. Essa URL tem validade
// curta (a documentação do monday indica ~1h), então a prévia pode parar de
// funcionar se o card ficar aberto por muito tempo; nesse caso basta fechar
// e reabrir o card para pegar uma URL nova.

const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

function getExtension(name) {
  if (!name || !name.includes('.')) return '';
  return name.split('.').pop().toLowerCase();
}

export default function ProposalViewerModal({ proposal, fallbackUrl, onClose }) {
  const ext = getExtension(proposal.name);
  const hasUrl = Boolean(proposal.url);

  let body;
  if (!hasUrl) {
    body = (
      <div className="proposal-viewer-fallback">
        Não foi possível carregar a prévia deste arquivo agora (a URL pode ter expirado).
        <br />
        <a href={fallbackUrl} target="_blank" rel="noreferrer">
          Abrir o lead no monday.com ↗
        </a>
      </div>
    );
  } else if (ext === 'pdf') {
    body = <iframe key={proposal.url} src={proposal.url} title={proposal.name} className="proposal-viewer-frame" />;
  } else if (IMAGE_EXTENSIONS.has(ext)) {
    body = <img src={proposal.url} alt={proposal.name} className="proposal-viewer-image" />;
  } else if (OFFICE_EXTENSIONS.has(ext)) {
    const embedUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(proposal.url)}`;
    body = <iframe key={embedUrl} src={embedUrl} title={proposal.name} className="proposal-viewer-frame" />;
  } else {
    body = (
      <div className="proposal-viewer-fallback">
        Prévia não disponível para este tipo de arquivo.
        <br />
        <a href={proposal.url} target="_blank" rel="noreferrer">
          Abrir arquivo em nova aba ↗
        </a>
      </div>
    );
  }

  return (
    <div className="proposal-viewer-backdrop" onClick={onClose}>
      <div className="proposal-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="proposal-viewer-header">
          <span title={proposal.name}>📄 {proposal.name}</span>
          <div className="proposal-viewer-actions">
            {hasUrl && (
              <a href={proposal.url} target="_blank" rel="noreferrer" className="btn-link">
                Abrir em nova aba ↗
              </a>
            )}
            <button className="close" onClick={onClose} aria-label="Fechar">
              ×
            </button>
          </div>
        </div>
        <div className="proposal-viewer-body">{body}</div>
      </div>
    </div>
  );
}
