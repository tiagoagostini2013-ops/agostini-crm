'use client';

import { useEffect, useMemo, useRef } from 'react';

// Comemoração de negócio fechado (pedido do Tiago em 31/08/2026): "algo
// chamativo pra deixar o vendedor feliz de fato" quando um lead vira
// "Fechado" — seja arrastando o card no Kanban, seja confirmando o handoff
// obrigatório no drawer. Confeti em CSS puro (sem lib nova) + um efeitinho
// sonoro curto sintetizado na hora (sem arquivo de áudio) — ver
// CONFETTI_CORES abaixo, é a mesma paleta categórica validada usada no
// resto do painel (dataviz skill), só que aqui é decoração, não codificação
// de dado, então não precisa reservar cor por entidade.
const CONFETTI_CORES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const CONFETTI_COUNT = 70;
const AUTO_CLOSE_MS = 7000;

const FRASES = [
  'Mandou muito bem! 🚀',
  'Show de bola! 🔥',
  'Fechou com chave de ouro! 🔑',
  'Isso que é vender! 💪',
  'Mais um pra conta! 📈',
  'Excelente trabalho! 👏',
];

function fmtMoney(v) {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

// Toca um "tcharam" de 3 notas ascendentes sintetizado via Web Audio — sem
// precisar embutir nenhum arquivo de som. Falha em silêncio se o navegador
// bloquear (ex: sem interação do usuário ainda, embora aqui sempre haja uma
// — arrastar o card ou confirmar o handoff).
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notas = [523.25, 659.25, 783.99]; // dó-mi-sol
    notas.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch {
    // som é só um extra — se o navegador não deixar, segue sem ele
  }
}

export default function CelebrationOverlay({ empresa, valorEstimado, vendedorNome, onClose }) {
  const closedRef = useRef(false);

  const frase = useMemo(() => FRASES[Math.floor(Math.random() * FRASES.length)], []);
  const confetti = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 2.6 + Math.random() * 1.6,
        color: CONFETTI_CORES[i % CONFETTI_CORES.length],
        size: 6 + Math.random() * 6,
        drift: (Math.random() - 0.5) * 120,
        spin: 360 * (Math.random() > 0.5 ? 1 : -1),
      })),
    []
  );

  useEffect(() => {
    playChime();
    const t = setTimeout(() => handleClose(), AUTO_CLOSE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClose() {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  }

  const valorFmt = fmtMoney(valorEstimado);

  return (
    <div className="celebration-overlay" onClick={handleClose} role="dialog" aria-live="polite" aria-label="Negócio fechado">
      <div className="celebration-confetti" aria-hidden="true">
        {confetti.map((c, i) => (
          <span
            key={i}
            className="celebration-confetti-piece"
            style={{
              left: `${c.left}%`,
              width: c.size,
              height: c.size * 0.4,
              background: c.color,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.duration}s`,
              '--drift': `${c.drift}px`,
              '--spin': `${c.spin}deg`,
            }}
          />
        ))}
      </div>

      <div className="celebration-card" onClick={(e) => e.stopPropagation()}>
        <button className="celebration-close" onClick={handleClose} aria-label="Fechar">
          ×
        </button>
        <div className="celebration-emoji">🎉</div>
        <div className="celebration-title">Parabéns{vendedorNome ? `, ${vendedorNome}` : ''}!</div>
        <div className="celebration-subtitle">{frase}</div>
        <div className="celebration-deal">
          <div className="celebration-deal-empresa">Negócio fechado: {empresa || 'sem nome'}</div>
          {valorFmt && <div className="celebration-deal-valor">{valorFmt}</div>}
        </div>
        <button className="btn btn-primary celebration-continue" onClick={handleClose}>
          Continuar vendendo 💪
        </button>
      </div>
    </div>
  );
}
