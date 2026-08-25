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
    // IP fixo/reservado do PC do APS na rede da fábrica, definido em
    // 25/08/2026 (ver instalar-servico.ps1 no projeto
    // agostini-production-control). Se esse IP mudar no futuro (troca de
    // computador, reconfiguração de rede etc.), basta atualizar o valor
    // abaixo — não precisa nada na Vercel.
    url: process.env.NEXT_PUBLIC_APS_URL || 'http://192.168.2.35:3001',
    onde: 'rede-local',
  },
];
