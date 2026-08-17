import './globals.css';

export const metadata = {
  title: 'CRM Agostini — Painel',
  description: 'Painel de visualização e gestão do funil de vendas Agostini, integrado ao monday.com.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
