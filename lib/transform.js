import { COLUMNS } from './config';

// Extrai a lista de arquivos anexados (proposta, orçamento de frete, layout
// do cliente etc. — a coluna aceita qualquer tipo) a partir do valor bruto
// (JSON) de uma coluna de arquivos do monday.com. Compartilhado entre
// flattenItem (GET /api/items) e as rotas de anexar/remover arquivo, pra não
// duplicar essa lógica em três lugares.
export function mapFileColumnFiles(raw) {
  const files = raw && Array.isArray(raw.files) ? raw.files : [];
  return files
    // Arquivos linkados externamente (fileType "LINK", raros aqui) não têm
    // assetId no monday.com — só mostramos os que foram de fato enviados.
    .filter((f) => f.fileType === 'ASSET' && f.assetId)
    .map((f) => ({
      // Chave real do arquivo no monday.com é "assetId", não "fileId" (nome
      // que foi usado por engano antes — o value bruto da coluna nunca teve
      // "fileId", por isso a URL nunca resolvia).
      assetId: String(f.assetId),
      name: f.name,
    }));
}

// Achata o objeto columns (indexado por id de coluna do monday) num formato
// simples e estável para o front-end, para ele não precisar conhecer os ids
// crus das colunas do board.
export function flattenItem(item) {
  const c = item.columns || {};
  const get = (key) => (c[COLUMNS[key]] ? c[COLUMNS[key]].text : null) || null;
  const getRaw = (key) => (c[COLUMNS[key]] ? c[COLUMNS[key]].value : null);

  const pessoasRaw = getRaw('pessoas');
  const responsaveis =
    pessoasRaw && pessoasRaw.personsAndTeams
      ? pessoasRaw.personsAndTeams.map((p) => p.id).filter((id) => typeof id === 'number' || typeof id === 'string')
      : [];

  const whatsappRaw = getRaw('whatsapp');

  const propostas = mapFileColumnFiles(getRaw('propostas'));

  // Contatos e papéis de decisão do lead (quem aprova orçamento, quem exige
  // especificação técnica etc.) — guardado como JSON dentro de uma coluna
  // long_text. O "texto" dessa coluna já É o JSON puro (confirmado direto na
  // API: o value bruto da coluna é {"text": "<json>", "changed_at": ...} e o
  // campo "text" devolve exatamente a string que escrevemos).
  let contatos = [];
  const contatosText = get('contatosDecisao');
  if (contatosText) {
    try {
      const parsed = JSON.parse(contatosText);
      if (Array.isArray(parsed)) contatos = parsed;
    } catch {
      contatos = [];
    }
  }

  return {
    id: item.id,
    name: item.name,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    group: item.group,
    empresa: get('empresa'),
    telefone: get('telefone'),
    whatsappUrl: whatsappRaw && whatsappRaw.url ? whatsappRaw.url : null,
    produtoInteresse: get('produtoInteresse'),
    tipoContato: get('tipoContato'),
    estagio: get('estagio'),
    segmento: get('segmento'),
    cargoDecisor: get('cargoDecisor'),
    canalOrigem: get('canalOrigem'),
    motivoPerda: get('motivoPerda'),
    valorEstimado: get('valorEstimado'),
    ultimoContato: get('ultimoContato'),
    proximoFollowUp: get('proximoFollowUp'),
    responsavelIds: responsaveis.map(String),
    propostas,
    contatos,
    dataQualificacao: get('dataQualificacao'),
    dataFechamento: get('dataFechamento'),
    dataPerda: get('dataPerda'),
  };
}

// Monta o objeto column_values pronto pra mandar pro monday a partir de um
// payload "amigável" vindo do formulário do front-end.
export function buildColumnValues(fields) {
  const columnValues = {};

  if (fields.estagio !== undefined) columnValues[COLUMNS.estagio] = { label: fields.estagio };
  if (fields.segmento !== undefined) columnValues[COLUMNS.segmento] = { label: fields.segmento };
  if (fields.cargoDecisor !== undefined) columnValues[COLUMNS.cargoDecisor] = { label: fields.cargoDecisor };
  if (fields.canalOrigem !== undefined) columnValues[COLUMNS.canalOrigem] = { label: fields.canalOrigem };
  if (fields.motivoPerda !== undefined) columnValues[COLUMNS.motivoPerda] = { label: fields.motivoPerda };
  if (fields.tipoContato !== undefined) columnValues[COLUMNS.tipoContato] = { label: fields.tipoContato };

  if (fields.empresa !== undefined) columnValues[COLUMNS.empresa] = fields.empresa;
  if (fields.telefone !== undefined) columnValues[COLUMNS.telefone] = fields.telefone;
  if (fields.produtoInteresse !== undefined) columnValues[COLUMNS.produtoInteresse] = fields.produtoInteresse;

  if (fields.valorEstimado !== undefined) {
    columnValues[COLUMNS.valorEstimado] = fields.valorEstimado === '' ? '' : String(fields.valorEstimado);
  }

  if (fields.proximoFollowUp !== undefined) {
    columnValues[COLUMNS.proximoFollowUp] = fields.proximoFollowUp ? { date: fields.proximoFollowUp } : null;
  }
  if (fields.ultimoContato !== undefined) {
    columnValues[COLUMNS.ultimoContato] = fields.ultimoContato ? { date: fields.ultimoContato } : null;
  }

  if (fields.responsavelIds !== undefined) {
    columnValues[COLUMNS.pessoas] = {
      personsAndTeams: fields.responsavelIds.map((id) => ({ id: Number(id), kind: 'person' })),
    };
  }

  if (fields.contatos !== undefined) {
    // Coluna long_text: o valor da mutação é a própria string (sem
    // envelope), confirmado ao testar direto na API antes de implementar
    // isto — diferente das colunas status/date, que exigem um objeto.
    const lista = Array.isArray(fields.contatos)
      ? fields.contatos.filter((c) => c && (c.name || '').trim())
      : [];
    columnValues[COLUMNS.contatosDecisao] = lista.length ? JSON.stringify(lista) : '';
  }

  return columnValues;
}
