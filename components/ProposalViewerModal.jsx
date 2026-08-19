'use client';

import { useEffect, useState } from 'react';

// Modal com visualizador embutido de uma proposta anexada (docx/pdf/etc.),
// aberto direto no CRM em vez de redirecionar para o monday.com.
//
// A URL "crua" que o monday.com dá pro arquivo (public_url) expira em 1h e
// vem com Content-Disposition: attachment, que faz o navegador tentar
// baixar o arquivo em vez de mostrar dentro do iframe. Por isso, antes de
// exibir qualquer coisa, pedimos pro nosso próprio backend um link de
// prévia (/api/proposals/[assetId]/link) — ele devolve uma URL do nosso
// domínio, sempre fresca, que serve o arquivo com "inline".
//
// PDF: o navegador sabe renderizar sozinho dentro de um iframe.
// docx/xlsx/pptx: usamos o Office Online Viewer da Microsoft, que só
// precisa de uma URL pública do arquivo (a nossa, com token assinado) para
// buscar o conteúdo e renderizar — por isso a rota de prévia precisa ser
// acessível sem cookie de sessão (o token já garante que só serve por um
// tempo curto e só aquele arquivo específico).

const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

function getExtension(name) {
  if (!name || !name.includes('.')) return '';
  return name.split('.').pop().toLowerCase();
}

export default function ProposalViewerModal({ proposal, fallbackUrl, onClose }) {
  const [absoluteUrl, setAbsoluteUrl] = useState(null);
  const [loadError, setLoadError] = useState('');
  const ext = getExtension(proposal.name);

  useEffect(() => {
    let cancelled = false;
    setAbsoluteUrl(null);
    setLoadError('');
    fetch(`/api/proposals/${encodeURIComponent(proposal.assetId)}/link`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.viewUrl) throw new Error('Resposta inesperada ao gerar o link de prévia.');
        setAbsoluteUrl(`${window.location.origin}${data.viewUrl}`);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || 'Não foi possível preparar a prévia.');
      });
    return () => {
      cancelled = true;
    };
  }, [proposal.assetId]);

  let body;
  if (loadError) {
    body = (
      <div className="proposal-viewer-fallback">
        {loadError}
        <br />
        <a href={fallbackUrl} target="_blank" rel="noreferrer">
          Abrir o lead no monday.com ↗
        </a>
      </div>
    );
  } else if (!absoluteUrl) {
    body = <div className="proposal-viewer-fallback">Carregando prévia...</div>;
  } else if (ext === 'pdf') {
    body = <iframe key={absoluteUrl} src={absoluteUrl} title={proposal.name} className="proposal-viewer-frame" />;
  } else if (IMAGE_EXTENSIONS.has(ext)) {
    body = <img src={absoluteUrl} alt={proposal.name} className="proposal-viewer-image" />;
  } else if (OFFICE_EXTENSIONS.has(ext)) {
    const embedUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteUrl)}`;
    body = <iframe key={embedUrl} src={embedUrl} title={proposal.name} className="proposal-viewer-frame" />;
  } else {
    body = (
      <div className="proposal-viewer-fallback">
        Prévia não disponível para este tipo de arquivo.
        <br />
        <a href={absoluteUrl} target="_blank" rel="noreferrer">
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
            {absoluteUrl && (
              <a href={absoluteUrl} target="_blank" rel="noreferrer" className="btn-link">
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
