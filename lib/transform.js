import { COLUMNS } from './config';

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

  const propostasRaw = getRaw('propostas');
  const propostas =
    propostasRaw && Array.isArray(propostasRaw.files)
      ? propostasRaw.files
          // Arquivos linkados externamente (fileType "LINK", raros aqui) não
          // têm assetId no monday.com — só mostramos os que foram de fato
          // enviados (é sempre o caso vindo do suplemento do Word).
          .filter((f) => f.fileType === 'ASSET' && f.assetId)
          .map((f) => ({
            // Chave real do arquivo no monday.com é "assetId", não "fileId"
            // (nome que usei antes por engano — o value bruto da coluna nunca
            // teve "fileId", por isso a URL nunca resolvia).
            assetId: String(f.assetId),
            name: f.name,
          }))
      : [];

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

  return columnValues;
}
