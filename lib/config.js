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
  propostas: 'file_mm6b4t4x', // Propostas — file (usado pelo suplemento do Word)
  contatosDecisao: 'long_text_mm6cw2yn', // Contatos e Decisores — long_text (JSON: [{name, role, phone}])
  // Datas de transição de estágio — preenchidas automaticamente pelo servidor
  // (ver app/api/items/[id]/route.js) sempre que um PATCH muda o estágio para
  // o valor correspondente. Usadas pelo Dashboard Gerencial (admins) pra
  // calcular novos leads / qualificados / fechados / perdidos por período.
  // Histórico anterior a 16/04/2026 foi parcialmente reconstruído em
  // 20/08/2026 via log de atividades do monday.com (cobertura incompleta —
  // ver nota no board de Configurações e no documento de projeto).
  dataQualificacao: 'date_mm6dn31x', // Data Qualificação — date
  dataFechamento: 'date_mm6dz65r', // Data Fechamento — date
  dataPerda: 'date_mm6dnttm', // Data Perda — date
  // Colunas da Fase 7 (velocidade e qualidade do funil) — mesmo princípio das
  // três acima: carimbadas automaticamente pelo servidor, nunca preenchidas
  // manualmente. Criadas em 20/08/2026, então só têm dado confiável a partir
  // dessa data pra frente (ver caveats na aba Métricas e no Dashboard
  // Gerencial) — não foi feita reconstrução via log de atividades pra estas,
  // diferente das três de cima, porque a tentativa anterior (ver Dashboard
  // Gerencial) recuperou uma fração pequena e desigual dos casos, e essas
  // datas de estágio intermediário são ainda mais prováveis de nunca terem
  // gerado um evento de log recuperável.
  dataPrimeiroContato: 'date_mm6dbktn', // Data Primeiro Contato — date
  dataPropostaEnviada: 'date_mm6ds0qd', // Data Proposta Enviada — date
  dataNegociacao: 'date_mm6dddbc', // Data Início Negociação — date
  // Rastreio de leitura de propostas em PDF — criada em 20/08/2026 a pedido
  // do Tiago (inspirado no que ele viu em outro CRM de mercado). Guarda um
  // JSON (uso interno, não pra edição manual no monday.com) com um registro
  // por envio: quando foi mandada, se/quando foi aberta, quantas vezes e
  // quanto tempo total de visualização — ver lib/proposalTracking.js e
  // app/api/word-addin/finalize/route.js (onde os registros são criados) e
  // app/api/track/[token]/route.js (onde são atualizados).
  rastreioPropostas: 'long_text_mm6d8nak', // Rastreio de Propostas — long_text (JSON)
};

// Campos de data disponíveis pro filtro de conferência por período (ver
// Dashboard.jsx) — cobre criação do lead + todas as datas de transição de
// estágio. "createdAt" vem do monday em ISO completo (com hora); as demais
// vêm como texto "YYYY-MM-DD" da própria coluna de data — o filtro compara
// só os 10 primeiros caracteres de qualquer um dos dois, então a comparação
// lexicográfica funciona igual pros dois casos.
export const DATE_FIELDS = [
  { value: 'createdAt', label: 'Data de criação do lead' },
  { value: 'dataPrimeiroContato', label: 'Data de primeiro contato' },
  { value: 'dataQualificacao', label: 'Data de qualificação' },
  { value: 'dataPropostaEnviada', label: 'Data de proposta enviada' },
  { value: 'dataNegociacao', label: 'Data de início de negociação' },
  { value: 'dataFechamento', label: 'Data de fechamento' },
  { value: 'dataPerda', label: 'Data de perda' },
];

// Mapa estágio → coluna de data que deve ser carimbada com a data de hoje
// sempre que um lead ENTRA nesse estágio (ver PATCH /api/items/[id]).
export const STAGE_DATE_COLUMNS = {
  Qualificado: 'dataQualificacao',
  'Proposta Enviada': 'dataPropostaEnviada',
  'Em Negociação': 'dataNegociacao',
  Fechado: 'dataFechamento',
  Perdido: 'dataPerda',
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

// Estágios considerados "funil aberto" para fins de forecast ponderado
// (Fase 5) — Fechado e Perdido já são resultado (100%/0%), não previsão, e
// por isso ficam de fora tanto do cálculo quanto da tela de edição de
// probabilidades.
export const FORECAST_STAGES = STAGES.filter((s) => s.value !== 'Fechado' && s.value !== 'Perdido').map(
  (s) => s.value
);

// Probabilidades padrão de fechamento por estágio, usadas no forecast
// ponderado até o Tiago ajustar (ver board de Configurações abaixo). São só
// uma estimativa de mercado — editáveis na tela de Métricas.
export const DEFAULT_FORECAST_PROBABILITIES = {
  Lead: 10,
  Qualificado: 25,
  'Proposta Enviada': 50,
  'Em Negociação': 75,
};

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
  // ID do vendedor no monday.com — text (guarda o ID numérico da pessoa como
  // texto). Usamos texto, não uma coluna de "pessoas": a API do monday.com
  // recusa vincular contas convidadas (guest) — a maioria do time comercial
  // aqui — a colunas de pessoas em boards privados que elas não acessam.
  mondayUserId: 'text_mm6bxbjh',
};

// Board separado "CRM Agostini - Configurações" — guarda parâmetros do
// painel que não são leads nem usuários (hoje, só as probabilidades de
// fechamento por estágio usadas no forecast ponderado da Fase 5). Cada
// parâmetro é um item nesse board, com o valor serializado em JSON numa
// coluna long_text — mesmo padrão já usado em "Contatos e Decisores".
export const SETTINGS_BOARD_ID = Number(process.env.MONDAY_SETTINGS_BOARD_ID || 18427364423);
export const FORECAST_SETTINGS_ITEM_ID = Number(process.env.MONDAY_FORECAST_SETTINGS_ITEM_ID || 12850026547);

export const SETTINGS_COLUMNS = {
  valorJson: 'long_text_mm6d7vvm', // Valor (JSON) — long_text
};

// Painel de Vendas semanal (pedido do Tiago em 28/08/2026) — reproduz dentro
// do CRM o resumo manual que ele já fazia à mão num caderno: uma lista de
// negócios em andamento (nome, valor, status, "temperatura") e um fechamento
// da semana com quatro categorias narrativas (apalavreamentos, evoluções,
// surgidos, perdidas). É inserção 100% manual, sem vínculo com os leads do
// funil principal — cada item deste board é uma semana. Board separado do CRM
// Agostini porque não é um funil de vendas, é um registro/ritual à parte.
export const PAINEL_VENDAS_BOARD_ID = Number(process.env.MONDAY_PAINEL_VENDAS_BOARD_ID || 18428631967);

export const PAINEL_VENDAS_COLUMNS = {
  inicioSemana: 'date_mm6nczh8', // Início da Semana — date
  fimSemana: 'date_mm6n619t', // Fim da Semana — date
  negociosJson: 'long_text_mm6nr0sz', // Negócios (JSON) — long_text
  apalavreamentos: 'long_text_mm6ntsx3', // Apalavreamentos — long_text
  evolucoes: 'long_text_mm6ntxcp', // Evoluções — long_text
  surgidos: 'long_text_mm6nqdm2', // Surgidos — long_text
  perdidas: 'long_text_mm6n661k', // Perdidas — long_text
};

// "Temperatura" do negócio no Painel de Vendas — rótulo livre igual ao
// caderno, independente do Estágio formal do funil principal. "Apalavreado"
// adicionado em 28/08/2026 (pedido do Tiago) — fica entre "Quente" e
// "Fechado", representando um acordo verbal ainda não formalizado. A tela
// agrupa os negócios por essa lista, nesta ordem (ver seção "Negócios por
// status" em PainelVendas.jsx) — mudar a ordem aqui muda a ordem dos grupos.
export const TEMPERATURAS_PAINEL_VENDAS = ['Frio', 'Morno', 'Quente', 'Apalavreado', 'Fechado'];

// Cores por status, validadas contra contraste/daltonismo (script da skill de
// dataviz) — usadas tanto nos grupos por status quanto no gráfico de evolução
// semanal, pra bater a mesma cor nos dois lugares.
export const TEMPERATURA_CORES = {
  Frio: '#2a78d6',
  Morno: '#eda100',
  Quente: '#e34948',
  Apalavreado: '#4a3aa7',
  Fechado: '#0ca30c',
};

// Fase 8 (Vendas × Produção) — Parte A: painel agregado de capacidade,
// lendo direto de dois boards do monday.com que já existiam ANTES do CRM e
// são mantidos pela produção/PCP, não pelo painel. Só leitura — nada aqui é
// escrito de volta nesses boards. Não há (ainda) nenhum vínculo formal entre
// um lead do CRM Agostini e um Pedido específico (ver Roadmap, Fase 8 Parte
// B, não implementada) — por isso este painel é agregado/estatístico, não
// por lead.
export const PEDIDOS_BOARD_ID = Number(process.env.MONDAY_PEDIDOS_BOARD_ID || 167539662);
export const PRODUCAO_BOARD_ID = Number(process.env.MONDAY_PRODUCAO_BOARD_ID || 284137555);

export const PEDIDOS_COLUMNS = {
  numeroPedido: 'pedido', // Pedido — text
  prazoEntrega: 'date', // Prazo Entr. — date
  prevProducao: 'date7', // Prev. Produção — date
  tipo: 'status', // Tipo (Máquina/Central, Molde, Peça Reposição, Garantia, Formas Pré-Moldados etc.) — status
  total: 'numbers', // Total (R$) — numbers
  receber: 'numbers2', // Receber (R$) — numbers
  finalizadoEm: 'date73', // Finalizado em — date
  atrasado: 'formula0', // "ATRASADO" | "NO PRAZO" — formula já calculada pela própria PEDIDOS
};

// Grupo "Finalizados" — excluído das contagens de "em aberto".
export const PEDIDOS_GROUP_FINALIZADOS = 'new_group';

export const PRODUCAO_COLUMNS = {
  cliente: 'text9', // Cliente — text
  numeroPedido: 'pedido0', // Pedido — text (cross-referência com PEDIDOS.pedido)
  prazoEntrega: 'date4', // Prazo Entrega — date
  statusPed: 'status_18', // StatusPed — status (etapa fina: Projetos, Solda, Usinagem, Pintura...)
  status: 'status34', // Status geral — status (Em Andamento, Finalizado, Falta material...)
  finalizadaEm: 'data8', // Finalizada em — date
};

// Grupos do board PRODUÇÃO, na ordem real do processo de fabricação — usado
// pra mostrar a distribuição de OPs em aberto na ordem certa do pipeline, em
// vez de ordem alfabética ou de criação. "Finalizadas" fica de fora (só
// interessa o que está em aberto).
export const PRODUCAO_GRUPOS_ORDEM = [
  { id: 'novo_grupo64791', titulo: 'Comercial' },
  { id: 'novo_grupo90366', titulo: 'Projetos Mecânicos' },
  { id: 'novo_grupo39787', titulo: 'Projetos Elétricos' },
  { id: 'novo_grupo98047', titulo: 'Impressão/Engenharia' },
  { id: 'new_group28679', titulo: "Avaliação Reformas (OS's de Equipamentos)" },
  { id: 'novo_grupo35543', titulo: 'PCP' },
  { id: 'novo_grupo28842', titulo: 'Área de Apoio' },
  { id: 'novo_grupo49916', titulo: 'Aguardando Material' },
  { id: 'novo_grupo77265', titulo: 'Programação/Levantamento de Material (chapas)' },
  { id: 'novo_grupo97568', titulo: 'Finalizando Corte' },
  { id: 'new_group__1', titulo: 'Aguardando Soldador' },
  { id: 'new_group45', titulo: 'Solda' },
  { id: 'novo_grupo54467', titulo: 'Usinagem' },
  { id: 'novo_grupo38648', titulo: 'Lavação' },
  { id: 'novo_grupo18708', titulo: 'Pintura' },
  { id: 'new_group6946', titulo: 'Processo terceirizado' },
  { id: 'novo_grupo', titulo: 'Montagem' },
  { id: 'new_group84', titulo: 'Elétrica' },
  { id: 'group_mkqepr1s', titulo: 'Aguardando Teste Elétrica' },
  { id: 'new_group31236', titulo: 'Conferência de Equipamento' },
];

export const PRODUCAO_GROUP_FINALIZADAS = 'duplicate_of_aguardando_inicio';
