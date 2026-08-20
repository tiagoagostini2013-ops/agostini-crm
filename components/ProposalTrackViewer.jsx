'use client';

import { useEffect, useRef } from 'react';

// Manda o tempo acumulado de tela em primeiro plano a cada 15s — não a cada
// segundo, pra não gerar uma requisição por segundo enquanto o cliente olha
// a proposta.
const HEARTBEAT_MS = 15000;

// Visualizador público da proposta (ver app/p/[token]/page.js) — quem abre
// isso é o CLIENTE, fora do painel, sem login. Faz duas coisas: mostra o PDF
// e avisa o CRM quando isso acontece de verdade.
//
// O pulo do gato pra não contar a prévia que o WhatsApp gera ao colar o link
// (o app dele busca a página pra montar aquele cartão com título/imagem,
// ANTES do cliente clicar) é que esse aviso só sai daqui — de um <script>
// que só roda depois que uma página carrega DENTRO de um navegador de
// verdade. O robô do WhatsApp (e de scanners de link parecidos) só lê o
// HTML/meta tags pra montar a prévia, não executa JavaScript — então nunca
// chega a disparar isso. (Ressalva que vale registrar: alguns scanners de
// segurança corporativos, normalmente ligados a e-mail, rodam um navegador
// de verdade e SIM executam JavaScript — um risco residual pequeno e fora do
// caminho principal, que é WhatsApp.)
export default function ProposalTrackViewer({ token, fileName }) {
  const accumulatedRef = useRef(0);
  const visibleSinceRef = useRef(null);

  useEffect(() => {
    function send(event, durationMs) {
      const payload = JSON.stringify({ event, durationMs: durationMs || 0 });
      const url = `/api/track/${token}`;
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(
          () => {}
        );
      }
    }

    function flush() {
      if (visibleSinceRef.current != null) {
        const now = performance.now();
        accumulatedRef.current += now - visibleSinceRef.current;
        visibleSinceRef.current = document.visibilityState === 'visible' ? now : null;
      }
      if (accumulatedRef.current >= 1000) {
        send('heartbeat', Math.round(accumulatedRef.current));
        accumulatedRef.current = 0;
      }
    }

    // Pequeno atraso antes do primeiro aviso — não muda o mecanismo de
    // defesa contra o robô do WhatsApp (que já não executaria isso de
    // qualquer forma), é só uma folga extra pra garantir que a página
    // realmente terminou de montar antes de contar como "aberta".
    const openTimer = setTimeout(() => {
      send('open', 0);
      if (document.visibilityState === 'visible') visibleSinceRef.current = performance.now();
    }, 300);

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        visibleSinceRef.current = performance.now();
      } else {
        flush();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    const heartbeatTimer = setInterval(() => {
      if (document.visibilityState === 'visible') flush();
    }, HEARTBEAT_MS);

    function onPageHide() {
      flush();
    }
    window.addEventListener('pagehide', onPageHide);

    return () => {
      clearTimeout(openTimer);
      clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      flush();
    };
  }, [token]);

  const fileUrl = `/api/proposal-track-file/${token}`;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <img src="/logo.png" alt="Agostini" style={styles.logo} />
        <span style={styles.title}>{fileName || 'Proposta comercial'}</span>
      </header>
      <div style={styles.viewerWrap}>
        <embed src={fileUrl} type="application/pdf" style={styles.embed} />
      </div>
      <p style={styles.fallback}>
        Não conseguiu ver o documento acima?{' '}
        <a href={fileUrl} target="_blank" rel="noreferrer" style={styles.link}>
          Toque aqui para abrir o PDF
        </a>
        .
      </p>
    </div>
  );
}

const styles = {
  page: {
    fontFamily: '-apple-system, Segoe UI, Roboto, sans-serif',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#f4f6f8',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    background: '#fff',
    borderBottom: '1px solid #e1e6ea',
  },
  logo: { width: 28, height: 28 },
  title: { fontWeight: 600, color: '#16212c', fontSize: 15 },
  viewerWrap: { flex: 1, minHeight: '70vh', padding: 12 },
  embed: { width: '100%', height: '100%', minHeight: '70vh', border: 'none', borderRadius: 8, background: '#fff' },
  fallback: { textAlign: 'center', fontSize: 13, color: '#56636f', padding: '0 16px 20px' },
  link: { color: '#007eb5', fontWeight: 600 },
};
