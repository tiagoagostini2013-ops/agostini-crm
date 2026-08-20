import { getSessionPayload } from '../../../lib/auth';
import ProposalTrackViewer from '../../../components/ProposalTrackViewer';

export const dynamic = 'force-dynamic';

// Página pública (sem login — ver middleware.js) que o CLIENTE abre pra ver
// a proposta. O token assinado (ver criação em
// app/api/word-addin/finalize/route.js) já carrega tudo que essa página
// precisa — item, envio e arquivo — então não faz nenhuma chamada ao
// monday.com aqui; só decodifica e confia na assinatura.
export default async function ProposalTrackPage({ params }) {
  const payload = await getSessionPayload(params.token);

  if (!payload || payload.purpose !== 'proposal-track') {
    return (
      <div style={styles.page}>
        <div style={styles.box}>
          <h1 style={styles.title}>Link indisponível</h1>
          <p style={styles.text}>Este link de proposta não é válido ou expirou. Peça um novo ao vendedor responsável.</p>
        </div>
      </div>
    );
  }

  return <ProposalTrackViewer token={params.token} fileName={payload.fileName} />;
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f4f6f8',
    fontFamily: '-apple-system, Segoe UI, Roboto, sans-serif',
    padding: 20,
  },
  box: {
    background: '#fff',
    border: '1px solid #e1e6ea',
    borderRadius: 10,
    padding: '24px 28px',
    maxWidth: 420,
    textAlign: 'center',
  },
  title: { fontSize: 18, color: '#16212c', margin: '0 0 8px' },
  text: { fontSize: 14, color: '#56636f', margin: 0, lineHeight: 1.5 },
};
