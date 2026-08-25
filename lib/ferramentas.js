// Lista de ferramentas internas da Agostini, mostrada em /ferramentas.
//
// Para adicionar uma nova ferramenta no futuro, basta acrescentar um item
// neste array — nada mais precisa mudar (a página /ferramentas é
// data-driven a partir daqui).
//
// `onde` controla o selo mostrado no card:
//   'internet'   -> "Acessível de qualquer lugar" (ex.: apps na Vercel)
//   'rede-local' -> "Só na rede da fábrica (ou VPN)" (ex.: apps que dependem
//                    do ERP local, como o APS)

export const FERRAMENTAS = [
  {
    nome: 'CRM Comercial',
    descricao: 'Funil de vendas, métricas, gestão comercial e propostas — integrado ao monday.com.',
    url: '/',
    onde: 'internet',
  },
  {
    nome: 'Produção (APS)',
    descricao:
      'Planejamento e controle de produção: liberação de OPs, sequenciamento de capacidade finita, apontamento de fábrica e Andon.',
    // Defina NEXT_PUBLIC_APS_URL nas variáveis de ambiente da Vercel assim que
    // o IP fixo/reservado do PC do APS estiver definido (ver
    // instalar-servico.ps1 no projeto agostini-production-control).
    url: process.env.NEXT_PUBLIC_APS_URL || 'http://SEU-IP-AQUI:3001',
    onde: 'rede-local',
  },
];
