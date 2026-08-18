// Mapeamento único entre os campos do app e as colunas reais do board
// "CRM Agostini" no monday.com (id 18404435549).
//
// Se alguém renomear/adicionar colunas no monday, ajuste aqui.

export const BOARD_ID = Number(process.env.MONDAY_BOARD_ID || 18404435549);

export const COLUMNS = {
  pessoas: 'multiple_person_mm2c5rqr', // Responsável (vendedor) — people
  ultimoContato: 'date_mm1j1bax', // Data Último Contato — date
  estagio: 'color_mm1jbh2m', // Estágio de Vendas — status
  produtoInteresse: 'text_mm1jsc1v', // Produto/Serviço de Interesse — text
  tipoContato: 'color_mm1jw01q', // Tipo de Contato — status
  valorEstimado: 'numeric_mm1jxa3w', // Valor Estimado — numbers
  telefone: 'text_mm1jth8', // Telefone — text
  whatsapp: 'link_mm1jhrmq', // WhatsApp — link
  empresa: 'text_mm2cg4h9', // Empresa — text
  proximoFollowUp: 'date_mm2cs7cs', // Data Próximo Follow-up — date
  cargoDecisor: 'color_mm2c4bpt', // Cargo do Decisor — status
  segmento: 'color_mm2ccywt', // Segmento — status
  canalOrigem: 'color_mm2csmt4', // Canal de Origem — status
  motivoPerda: 'color_mm2c4bsc', // Motivo de Perda — status
};

// Ordem das colunas do Kanban = estágios reais do funil no monday.
// A cor é só para a UI; não precisa bater com a cor exata do monday.
export const STAGES = [
  { value: 'Lead', color: '#fdab3d', textColor: '#3a2a05' },
  { value: 'Qualificado', color: '#9cd326', textColor: '#233900' },
  { value: 'Proposta Enviada', color: '#037f4c', textColor: '#ffffff' },
  { value: 'Em Negociação', color: '#df2f4a', textColor: '#ffffff' },
  { value: 'Fechado', color: '#007eb5', textColor: '#ffffff' },
  { value: 'Perdido', color: '#9d50dd', textColor: '#ffffff' },
];

export const STAGE_VALUES = STAGES.map((s) => s.value);

// Listas de opções — copiadas dos labels reais configurados no board
// (excluindo os placeholders internos "" e "NÃO MEXER").
export const SEGMENTOS = [
  'Formas p/ Pré-moldados',
  'Máquinas Blocos/Pavimentos',
  'Central de Concreto',
  'Triturador de Concreto',
  'Casas de Concreto',
];

export const CARGOS_DECISOR = [
  'Dono / Sócio',
  'Diretor / Gerente Industrial',
  'Compras / Suprimentos',
  'Engenheiro / Técnico',
];

export const CANAIS_ORIGEM = [
  'WhatsApp / Telefone',
  'Facebook',
  'Indicação / Networking',
  'Visita Espontânea',
  'Instagram',
  'Meta Business',
  'Outros Anuncios',
];

export const MOTIVOS_PERDA = [
  'Preço',
  'Escolheu Concorrente',
  'Sem Urgência / Adiou',
  'Sem Orçamento',
  'Necessita outra solução',
  'Sem Retorno / Outro',
];

export const TIPOS_CONTATO = ['Cliente', 'Fornecedor', 'Parceiro'];

// Board separado "CRM Agostini - Usuários do Painel" — usado só para guardar
// quem pode entrar no painel (login individual). Não é o funil de vendas.
export const USERS_BOARD_ID = Number(process.env.MONDAY_USERS_BOARD_ID || 18427048692);

export const USER_COLUMNS = {
  senhaHash: 'long_text_mm6bfy4a', // Senha (hash) — long_text, guarda hash bcrypt
  admin: 'boolean_mm6b7e6n', // Admin — checkbox
  ativo: 'boolean_mm6bbhw9', // Ativo — checkbox
  mondayUserId: 'multiple_person_mm6beb13', // Vendedor no monday.com — people (1 pessoa), liga a conta do painel a um usuário real do monday.com
};
