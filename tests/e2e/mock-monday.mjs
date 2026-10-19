// monday.com SIMULADO para testes — dados 100% FICTÍCIOS, em memória.
// Sobe um servidor HTTP que responde ao subconjunto de GraphQL que o CRM usa,
// pra testar o app de ponta a ponta SEM tocar no board de produção.
//
// Uso:  node tests/e2e/mock-monday.mjs [porta]      (padrão 4010)
//       e rode o app com MONDAY_API_URL=http://localhost:4010/v2
// Endpoints extras de teste (não existem no monday real):
//   GET  /__state            → estado atual dos itens (para asserções)
//   POST /__reset            → volta aos dados iniciais
import http from 'node:http';

const PORT = Number(process.argv[2] || 4010);
const BOARD_LEADS = '18404435549';
const BOARD_USERS = '18427048692';
export const BOARD_EMPRESAS = '18500000001';
export const BOARD_CONTATOS = '18500000002';

// Ids das colunas (os mesmos de lib/config.js + ids FICTÍCIOS das colunas novas,
// que o teste passa ao app via MONDAY_COL_*).
export const COL = {
  pessoas: 'multiple_person_mm2c5rqr',
  ultimoContato: 'date_mm1j1bax',
  estagio: 'color_mm1jbh2m',
  produtoInteresse: 'text_mm1jsc1v',
  valorEstimado: 'numeric_mm1jxa3w',
  empresa: 'text_mm2cg4h9',
  telefone: 'text_mm1jth8',
  proximoFollowUp: 'date_mm2cs7cs',
  cargoDecisor: 'color_mm2c4bpt',
  segmento: 'color_mm2ccywt',
  canalOrigem: 'color_mm2csmt4',
  motivoPerda: 'color_mm2c4bsc',
  rastreioPropostas: 'long_text_mm6d8nak',
  dataPerda: 'date_mm6dnttm',
  dataFechamento: 'date_mm6dz65r',
  dataPrimeiroContato: 'date_mm6dbktn',
  vendedorPosVenda: 'multiple_person_mm6t5nnt',
  estagioPosVenda: 'color_mm6txvjr',
  // novas (fictícias):
  prazoCompra: 'date_test_prazo',
  dataReativacao: 'date_test_reativ',
  proximoContatoPosVenda: 'date_test_posv',
  principalImpedimento: 'text_test_imped',
  planoAcao: 'long_text_test_plano',
  // v2 (fictícias):
  empresaId: 'text_test_empresaid',
  oportunidade: 'long_text_test_opp',
  propostasRegistro: 'long_text_test_propreg',
  propostas: 'file_mm6b4t4x',
  contatosDecisao: 'long_text_mm6cw2yn',
  dataQualificacao: 'date_mm6dn31x',
  dataPropostaEnviada: 'date_mm6ds0qd',
  dataNegociacao: 'date_mm6dddbc',
};
export const LONG_TEXT_LIMIT = 2000; // limite REAL do monday (confirmado em produção)
const LONG_TEXT_COLS = new Set([COL.rastreioPropostas, COL.planoAcao, COL.oportunidade, COL.propostasRegistro, COL.contatosDecisao]);

const USERS = [
  { id: '101', name: 'Ana Teste' },
  { id: '102', name: 'Bruno Teste' },
  { id: '103', name: 'Carla Teste' },
];

const isoDay = (offset) => {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + offset * 86400000);
  return d.toISOString().slice(0, 10);
};
const isoTs = (offsetDays, hour = 12) => new Date(Date.now() + offsetDays * 86400000 + hour * 3600000).toISOString();

function seedLeads() {
  const L = [];
  let n = 1000;
  const add = (name, cols, createdOffset = -20) => {
    L.push({ id: String(++n), name, created_at: isoTs(createdOffset), updated_at: isoTs(-1), group: { id: 'g1', title: 'Leads' }, cols, updates: [] });
  };
  const plano = (o) => JSON.stringify({ v: 1, ...o });
  add('Silo de Teste Alfa', {
    estagio: 'Em Negociação', valorEstimado: '600000', empresa: 'Alfa Concreto Fictícia', proximoFollowUp: isoDay(-1),
    pessoas: ['101'], prazoCompra: isoDay(20), ultimoContato: isoDay(-2), segmento: 'Central de Concreto',
    produtoInteresse: 'Central dosadora 60 m³/h', empresaId: '7001',
    oportunidade: JSON.stringify({ v: 1, r: 1, n: 'Central dosadora 60 m³/h', c: ['7101', '7102'] }),
    planoAcao: plano({ vendas: { acao: 'Apresentar condições ao decisor', responsavelId: '101', compromissoCliente: true, rev: 2 } }),
    rastreioPropostas: JSON.stringify([{ sendId: 's1', fileName: 'Proposta 2026-045 rev A.pdf', assetId: '5002', sentAt: isoTs(-6), firstViewedAt: isoTs(-1), lastViewedAt: isoTs(-1), viewCount: 2, totalViewMs: 300000, downloadCount: 1, lastDownloadedAt: isoTs(-1) }]),
  });
  add('Moldes Beta Teste', {
    estagio: 'Proposta Enviada', valorEstimado: '150000', empresa: 'Beta Pré-moldados Fictícia', proximoFollowUp: isoDay(0),
    pessoas: ['102'], ultimoContato: isoDay(-3), segmento: 'Formas p/ Pré-moldados',
    planoAcao: plano({ vendas: { acao: 'Validar financiamento', responsavelId: '102', rev: 1 } }),
  });
  add('Gama Pavimentos Teste', { estagio: 'Qualificado', empresa: 'Gama Fictícia', pessoas: ['101'], ultimoContato: isoDay(-10) });
  add('Delta Lead Novo Teste', { estagio: 'Lead', empresa: 'Delta Fictícia', pessoas: ['103'] }, -3);
  add('Épsilon Perdido Antigo', {
    estagio: 'Perdido', motivoPerda: 'Preço', empresa: 'Épsilon Fictícia', proximoFollowUp: isoDay(-40), pessoas: ['101'], dataPerda: isoDay(-45),
  });
  add('Zeta Perdido Reativar', {
    estagio: 'Perdido', motivoPerda: 'Sem Urgência / Adiou', empresa: 'Zeta Fictícia', dataReativacao: isoDay(-5), pessoas: ['102'], dataPerda: isoDay(-60),
    planoAcao: plano({ reativacao: { acao: 'Retomar contato quando a obra reabrir', responsavelId: '102', rev: 1 } }),
  });
  add('Eta Fechado Pós-venda', {
    estagio: 'Fechado', empresa: 'Eta Fictícia', pessoas: ['101', '102'], vendedorPosVenda: ['102'], estagioPosVenda: 'Em Acompanhamento',
    proximoContatoPosVenda: isoDay(-3), dataFechamento: isoDay(-30), valorEstimado: '200000',
    planoAcao: plano({ posVenda: { acao: 'Checar satisfação após a entrega', responsavelId: '102', rev: 1 } }),
  });
  add('Theta Fechado Follow-up Antigo', { estagio: 'Fechado', empresa: 'Theta Fictícia', pessoas: ['101'], proximoFollowUp: isoDay(-90), dataFechamento: isoDay(-100) });
  add('Iota Alto Valor Sem Compromisso', {
    estagio: 'Em Negociação', valorEstimado: '5000000', empresa: 'Iota Fictícia', proximoFollowUp: isoDay(30), pessoas: ['101'], ultimoContato: isoDay(-1),
    planoAcao: plano({ vendas: { acao: 'Aguardar retorno do conselho', responsavelId: '101', rev: 1 } }),
  });
  add('Kappa Pequeno Combinado', {
    estagio: 'Qualificado', valorEstimado: '8000', empresa: 'Kappa Fictícia', proximoFollowUp: isoDay(0), pessoas: ['102'], ultimoContato: isoDay(-1),
    planoAcao: plano({ vendas: { acao: 'Enviar a condição combinada por escrito', responsavelId: '102', compromissoCliente: true, rev: 1 } }),
  });
  const silo = L[0];
  silo.files = [
    { assetId: '5001', name: 'Proposta 2026-045 rev A.docx' },
    { assetId: '5002', name: 'Proposta 2026-045 rev A.pdf' },
    { assetId: '5003', name: 'Proposta 2026-045 rev B.docx' },
    { assetId: '5004', name: 'Proposta 2026-045 rev B.pdf' },
    { assetId: '5005', name: 'Layout do cliente.pdf' },
  ];
  const up = (it, id, text, ts) => it.updates.push({ id, text, created_at: ts });
  up(silo, 'u-h1', 'Contato via feira, pediu catálogo', isoTs(-15));
  up(silo, 'u-h2', 'Ana Teste: Cliente pediu desconto de 5%', isoTs(-12));
  up(silo, 'u-h3', 'Bruno Teste (anotação interna): conferir prazo de entrega com produção', isoTs(-8));
  up(silo, 'u-h4', '✅ Atividade registrada por Ana Teste — Vendas ativas\nCanal: Ligação · Contato efetivo com o cliente: sim\nResultado: alinhamos condições de pagamento', isoTs(-4));
  up(silo, 'u-h5', '📄 PDF gerado e link de rastreio criado por Ana Teste — avisa quando o cliente abrir.', new Date(new Date(isoTs(-6)).getTime() + 20000).toISOString());
  // 2ª oportunidade da MESMA empresa (independente da central)
  add('Formas Alfa Teste', {
    estagio: 'Qualificado', valorEstimado: '90000', empresa: 'Alfa Concreto Fictícia', empresaId: '7001', proximoFollowUp: isoDay(5),
    pessoas: ['101', '103'], ultimoContato: isoDay(-6), segmento: 'Formas p/ Pré-moldados', produtoInteresse: 'Conjunto de formas para tubos',
    oportunidade: JSON.stringify({ v: 1, r: 1, n: 'Conjunto de formas para tubos', c: ['7101'] }),
    planoAcao: plano({ vendas: { acao: 'Enviar orçamento das formas', responsavelId: '101', rev: 1 } }),
  });
  // lead sem empresa identificada e sem CNPJ/e-mail
  add('Lead Sem Empresa Teste', { estagio: 'Lead', telefone: '(47) 98888-7777', pessoas: ['103'] }, -1);
  // rastreio truncado em 2000 caracteres (como já ocorreu em produção)
  const env = (n) => ({ sendId: `t${n}`, fileName: `Proposta Truncada ${n}.pdf`, assetId: String(6000 + n), sentAt: isoTs(-n), sentBy: 'Ana Teste', firstViewedAt: null, lastViewedAt: null, viewCount: 0, totalViewMs: 0, downloadCount: 0 });
  const cheio = JSON.stringify(Array.from({ length: 14 }, (_, i) => env(i + 1)));
  add('Truncado Rastreio Teste', { estagio: 'Proposta Enviada', empresa: 'Truncada Fictícia', pessoas: ['101'], rastreioPropostas: cheio.slice(0, LONG_TEXT_LIMIT) });
  return L;
}

function seedEmpresas() {
  const mk = (id, name, extra) => ({ id, name, created_at: isoTs(-60), updated_at: isoTs(-5), group: null, cols: {}, extra, updates: [] });
  return [
    mk('7001', 'Alfa Concreto Fictícia', { text_test_emp_cnpj: '12345678000190', text_test_emp_cidade: 'Joinville/SC' }),
    mk('7002', 'Gama Pavimentos Fictícia Ltda', {}),
  ];
}
function seedContatos() {
  const mk = (id, name, extra) => ({ id, name, created_at: isoTs(-50), updated_at: isoTs(-5), group: null, cols: {}, extra, updates: [] });
  return [
    mk('7101', 'Carlos Alfa', { text_test_ct_tel: '(47) 99912-3456', text_test_ct_email: 'carlos@alfa.example', text_test_ct_papel: 'Decisor', text_test_ct_emp: '7001' }),
    mk('7102', 'Diana Alfa', { text_test_ct_tel: '(47) 99777-1122', text_test_ct_papel: 'Compras', text_test_ct_emp: '7001' }),
    mk('7103', 'Contato Solto Teste', { text_test_ct_tel: '(11) 97777-0000' }),
  ];
}

function seedUsers() {
  return USERS.map((u, i) => ({
    id: String(9001 + i), name: u.name, created_at: isoTs(-100), updated_at: isoTs(-1), group: null, updates: [],
    // senha NÃO é usada (os testes injetam o cookie de sessão direto)
    cols: { senhaHash: 'x', admin: i === 0, ativo: true, mondayUserId: u.id },
  }));
}

let leads = seedLeads();
let appUsers = seedUsers();
let empresas = seedEmpresas();
let contatos = seedContatos();
let nextId = 3000;
let falhas = []; // injeção de falha: [{match, n}]
let columnsMeta = null; // para create_column
let quadrosCriados = {}; // quadros criados pelo script de estrutura (teste)

const USER_COL = { senhaHash: 'long_text_mm6bfy4a', admin: 'boolean_mm6b7e6n', ativo: 'boolean_mm6bbhw9', mondayUserId: 'text_mm6bxbjh' };

const nameOfUser = (id) => USERS.find((u) => u.id === String(id))?.name || String(id);
const DATE_COLS = new Set([COL.ultimoContato, COL.proximoFollowUp, COL.dataPerda, COL.dataFechamento, COL.dataPrimeiroContato, COL.prazoCompra, COL.dataReativacao, COL.proximoContatoPosVenda, 'date_mm6dn31x', 'date_mm6ds0qd', 'date_mm6dddbc', 'date_mm6we43n']);

// Converte o estado interno de um item em column_values no formato do monday.
function leadColumnValues(item, ids) {
  const out = [];
  for (const id of ids) {
    const raw = item.rawCols?.[id];
    const key = Object.keys(COL).find((k) => COL[k] === id);
    const v = key !== undefined ? item.cols[key] : item.extra?.[id];
    let text = null, value = null, type = 'text';
    if (id === COL.pessoas || id === COL.vendedorPosVenda) {
      const arr = v || [];
      type = 'people';
      text = arr.map(nameOfUser).join(', ') || null;
      value = arr.length ? JSON.stringify({ personsAndTeams: arr.map((x) => ({ id: Number(x), kind: 'person' })) }) : null;
    } else if (DATE_COLS.has(id)) {
      type = 'date';
      text = v || null;
      value = v ? JSON.stringify({ date: v }) : null;
    } else if (id === COL.propostas) {
      type = 'file';
      const arr = item.files || [];
      text = arr.map((f) => f.name).join(', ') || null;
      value = arr.length ? JSON.stringify({ files: arr.map((f) => ({ fileType: 'ASSET', assetId: f.assetId, name: f.name })) }) : null;
    } else if (LONG_TEXT_COLS.has(id)) {
      type = 'long_text';
      text = v || null;
      value = v ? JSON.stringify({ text: v }) : null;
    } else if (v !== undefined && v !== null) {
      text = String(v);
      value = JSON.stringify(text);
    }
    void raw;
    out.push({ id, type, text, value });
  }
  return out;
}

function userColumnValues(item, ids) {
  return ids.map((id) => {
    if (id === USER_COL.admin) return { id, type: 'checkbox', text: item.cols.admin ? 'v' : '', value: JSON.stringify({ checked: !!item.cols.admin }) };
    if (id === USER_COL.ativo) return { id, type: 'checkbox', text: item.cols.ativo ? 'v' : '', value: JSON.stringify({ checked: !!item.cols.ativo }) };
    if (id === USER_COL.mondayUserId) return { id, type: 'text', text: item.cols.mondayUserId, value: JSON.stringify(item.cols.mondayUserId) };
    if (id === USER_COL.senhaHash) return { id, type: 'long_text', text: item.cols.senhaHash, value: JSON.stringify({ text: item.cols.senhaHash }) };
    return { id, type: 'text', text: null, value: null };
  });
}

function applyColumnValues(item, cv) {
  for (const [id, val] of Object.entries(cv)) {
    const key = Object.keys(COL).find((k) => COL[k] === id);
    if (!key) { item.extra = item.extra || {}; item.extra[id] = val; continue; }
    if (key === 'pessoas' || key === 'vendedorPosVenda') {
      item.cols[key] = (val?.personsAndTeams || []).map((p) => String(p.id));
    } else if (DATE_COLS.has(id)) {
      item.cols[key] = val && val.date ? val.date : null;
    } else if (key === 'estagio' || key === 'estagioPosVenda' || key === 'segmento' || key === 'cargoDecisor' || key === 'canalOrigem' || key === 'motivoPerda') {
      item.cols[key] = val && val.label ? val.label : null;
    } else {
      let t = val === '' || val === null ? null : String(val);
      if (t !== null && LONG_TEXT_COLS.has(id)) t = t.slice(0, LONG_TEXT_LIMIT); // o monday corta aqui, em silêncio
      item.cols[key] = t;
    }
  }
  item.updated_at = new Date().toISOString();
}

const todosItens = () => [...leads, ...appUsers, ...empresas, ...contatos];
const achar = (id) => todosItens().find((l) => l.id === String(id));
const boardDe = (boardId) => {
  const b = String(boardId);
  if (b === BOARD_USERS) return appUsers;
  if (b === BOARD_EMPRESAS) return empresas;
  if (b === BOARD_CONTATOS) return contatos;
  return leads;
};

function consumirFalha(query) {
  const i = falhas.findIndex((f) => f.match === '*' || query.includes(f.match));
  if (i < 0) return;
  falhas[i].n -= 1;
  if (falhas[i].n <= 0) falhas.splice(i, 1);
  throw new Error('Falha simulada do monday.com (teste)');
}

function handleGraphQL(query, variables) {
  const ehEscrita = query.includes('mutation');
  if (ehEscrita) consumirFalha(query);
  // ---- criação de quadro/coluna e listagem de colunas (scripts de setup)
  if (query.includes('create_board')) {
    const id = String(18600000000 + Object.keys(quadrosCriados).length + 1);
    quadrosCriados[id] = { name: variables.name, columns: [] };
    return { create_board: { id } };
  }
  if (query.includes('boards(limit') && !query.includes('items_page')) {
    return { boards: Object.entries(quadrosCriados).map(([id, b]) => ({ id, name: b.name })) };
  }
  if (query.includes('board_kind')) return { boards: [{ board_kind: 'private', workspace: { id: '1' } }] };
  if (query.includes('create_column')) {
    const { boardId, title, columnType } = variables;
    if (quadrosCriados[String(boardId)]) {
      const q = quadrosCriados[String(boardId)];
      const id = `${columnType}_q${boardId}_${q.columns.length + 1}`;
      q.columns.push({ id, title, type: columnType });
      return { create_column: { id, title, type: columnType } };
    }
    columnsMeta = columnsMeta || [];
    const id = `${columnType}_mock_${columnsMeta.length + 1}`;
    columnsMeta.push({ id, title, type: columnType });
    return { create_column: { id, title, type: columnType } };
  }
  if ((query.includes('columns {') || query.includes('columns{')) && variables?.ids && quadrosCriados[String(variables.ids[0])]) {
    return { boards: [{ columns: quadrosCriados[String(variables.ids[0])].columns }] };
  }
  if (query.includes('columns {') || query.includes('columns{')) {
    const base = [
      { id: COL.proximoFollowUp, title: 'Data Próximo Follow-up', type: 'date' },
      { id: COL.estagio, title: 'Estágio de Vendas', type: 'status' },
    ];
    return { boards: [{ columns: [...base, ...(columnsMeta || [])] }] };
  }
  // ---- usuários do monday
  if (query.includes('users(limit')) {
    return { users: USERS.map((u) => ({ id: u.id, name: u.name, photo_thumb_small: null, enabled: true })) };
  }
  // ---- listagem de qualquer board
  if (query.includes('items_page')) {
    const bid = String(variables.boardId);
    const isUsers = bid === BOARD_USERS;
    const ids = variables.columnIds || [];
    const src = boardDe(bid);
    return {
      boards: [{
        items_page: {
          cursor: null,
          items: src.map((it) => ({
            id: it.id, name: it.name, created_at: it.created_at, updated_at: it.updated_at, group: it.group,
            column_values: isUsers ? userColumnValues(it, ids) : leadColumnValues(it, ids),
          })),
        },
      }],
    };
  }
  // ---- foto do item (histórico)
  if (query.includes('GetSnapshot')) {
    const it = achar(variables.itemId[0]);
    if (!it) return { items: [] };
    return { items: [{ id: it.id, name: it.name, created_at: it.created_at, column_values: leadColumnValues(it, variables.columnIds || []).map((c) => ({ id: c.id, text: c.text })) }] };
  }
  // ---- atualizações (updates) de um item — mais recentes primeiro, paginadas
  if (query.includes('updates(limit')) {
    const it = achar(variables.itemId[0]);
    if (!it) return { items: [] };
    const todas = [...it.updates].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const limit = variables.limit || 100;
    const page = variables.page || 1;
    const fatia = variables.limit ? todas.slice((page - 1) * limit, page * limit) : todas.slice(0, 100);
    return { items: [{ updates: fatia.map((u) => ({ id: u.id, text_body: u.text, created_at: u.created_at, creator: { id: '1', name: 'Conta do Token', photo_thumb_small: null } })) }] };
  }
  if (query.includes('create_update')) {
    const it = achar(variables.itemId);
    const u = { id: `u${Date.now()}${Math.random().toString(36).slice(2, 5)}`, text: variables.body, created_at: new Date().toISOString() };
    it.updates.push(u);
    return { create_update: { id: u.id } };
  }
  // ---- escrita de colunas
  if (query.includes('change_multiple_column_values')) {
    const it = achar(variables.itemId);
    if (it.archived) throw new Error('Cannot change column value for inactive items');
    applyColumnValues(it, JSON.parse(variables.columnValues));
    return { change_multiple_column_values: { id: it.id } };
  }
  if (query.includes('change_simple_column_value')) {
    const it = achar(variables.itemId);
    it.name = variables.value;
    return { change_simple_column_value: { id: it.id } };
  }
  if (query.includes('create_item')) {
    const id = String(++nextId);
    const it = { id, name: variables.itemName, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), group: { id: 'g1', title: 'Leads' }, cols: {}, extra: {}, updates: [] };
    if (variables.columnValues) applyColumnValues(it, JSON.parse(variables.columnValues));
    boardDe(variables.boardId).push(it);
    return { create_item: { id } };
  }
  // ---- leitura de colunas de UM item (texto/valor)
  if (query.includes('column_values(ids: $columnIds)') || query.includes('column_values(ids: $columnId)')) {
    const it = achar(variables.itemId[0]);
    const ids = variables.columnIds || variables.columnId || [];
    return { items: it ? [{ column_values: leadColumnValues(it, ids).map((c) => ({ id: c.id, text: c.text, value: c.value })) }] : [] };
  }
  throw new Error('Consulta não suportada pelo mock: ' + query.slice(0, 120));
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/__state') return res.end(JSON.stringify(leads));
    if (req.url === '/__boards') return res.end(JSON.stringify({ empresas, contatos }));
    if (req.url === '/__reset') { leads = seedLeads(); appUsers = seedUsers(); empresas = seedEmpresas(); contatos = seedContatos(); columnsMeta = null; quadrosCriados = {}; falhas = []; nextId = 3000; return res.end('{"ok":true}'); }
    // Injeção de falha: POST /__fail {"match":"create_update","n":1} faz as próximas n mutações que casam falharem.
    if (req.url === '/__fail') { const f = JSON.parse(body || '{}'); falhas = f.n ? [{ match: f.match || '*', n: f.n }] : []; return res.end('{"ok":true}'); }
    try {
      const { query, variables } = JSON.parse(body || '{}');
      res.end(JSON.stringify({ data: handleGraphQL(query, variables || {}) }));
    } catch (err) {
      res.statusCode = 200;
      res.end(JSON.stringify({ errors: [{ message: err.message }] }));
    }
  });
});
server.listen(PORT, () => console.log(`mock monday em http://localhost:${PORT}/v2`));
