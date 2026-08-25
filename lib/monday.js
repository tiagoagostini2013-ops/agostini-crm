// Cliente mínimo para a API GraphQL v2 do monday.com.
// Roda só no servidor (rotas de API / server components) — o token nunca
// chega ao navegador do usuário.

const MONDAY_API_URL = 'https://api.monday.com/v2';

async function mondayRequest(query, variables = {}) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    throw new Error(
      'MONDAY_API_TOKEN não está configurado. Defina essa variável de ambiente com um token de API pessoal do monday.com.'
    );
  }

  const headers = {
    Authorization: token,
    'Content-Type': 'application/json',
  };
  if (process.env.MONDAY_API_VERSION) {
    headers['API-Version'] = process.env.MONDAY_API_VERSION;
  }

  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`monday.com API respondeu ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = await res.json();

  if (json.errors && json.errors.length > 0) {
    const message = json.errors.map((e) => e.message).join('; ');
    throw new Error(`monday.com API error: ${message}`);
  }

  return json.data;
}

// Converte o array column_values (id/type/text/value) num objeto
// { [columnId]: { text, value, type } } fácil de consumir na UI.
function indexColumnValues(columnValues) {
  const map = {};
  for (const cv of columnValues || []) {
    let parsedValue = null;
    if (cv.value) {
      try {
        parsedValue = JSON.parse(cv.value);
      } catch {
        parsedValue = cv.value;
      }
    }
    map[cv.id] = { text: cv.text, value: parsedValue, type: cv.type };
  }
  return map;
}

function mapItem(item) {
  return {
    id: item.id,
    name: item.name,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    group: item.group ? { id: item.group.id, title: item.group.title } : null,
    columns: indexColumnValues(item.column_values),
  };
}

export async function fetchAllItems(boardId, columnIds) {
  const query = `
    query GetItems($boardId: ID!, $cursor: String, $limit: Int!, $columnIds: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: $limit, cursor: $cursor) {
          cursor
          items {
            id
            name
            created_at
            updated_at
            group { id title }
            column_values(ids: $columnIds) {
              id
              type
              text
              value
            }
          }
        }
      }
    }
  `;

  let cursor = null;
  const items = [];

  // Evita loop infinito se algo vier estranho da API.
  for (let page = 0; page < 50; page++) {
    const data = await mondayRequest(query, {
      boardId,
      cursor,
      limit: 500,
      columnIds,
    });
    const board = data.boards && data.boards[0];
    if (!board) break;

    const page_ = board.items_page;
    for (const item of page_.items) items.push(mapItem(item));

    cursor = page_.cursor;
    if (!cursor) break;
  }

  return items;
}

// Busca a URL pública dos arquivos anexados (usado para a coluna
// "Propostas") — a query de items só traz o assetId, não a URL; precisa
// dessa consulta separada por assets.
export async function fetchAssetsPublicUrls(assetIds) {
  const ids = [...new Set(assetIds)].filter(Boolean);
  if (ids.length === 0) return {};

  const query = `
    query GetAssets($ids: [ID!]!) {
      assets(ids: $ids) {
        id
        name
        public_url
        file_extension
      }
    }
  `;
  const data = await mondayRequest(query, { ids });
  const map = {};
  for (const a of data.assets || []) {
    map[String(a.id)] = { url: a.public_url, name: a.name, extension: a.file_extension };
  }
  return map;
}

// Busca o valor bruto (JSON) de uma coluna de arquivos direto do monday.com —
// é a lista autoritativa "agora", usada antes de apagar um arquivo (ver
// removeFileFromItem) pra não correr risco de sobrescrever um arquivo que
// outra pessoa acabou de anexar por outro caminho (ex: suplemento do Word).
export async function fetchItemFileColumnRaw(itemId, columnId) {
  const query = `
    query GetFileColumn($itemId: [ID!], $columnId: [String!]) {
      items(ids: $itemId) {
        column_values(ids: $columnId) {
          value
        }
      }
    }
  `;
  const data = await mondayRequest(query, { itemId: [itemId], columnId: [columnId] });
  const item = data.items && data.items[0];
  const cv = item && item.column_values && item.column_values[0];
  if (!cv || !cv.value) return { files: [] };
  try {
    const parsed = JSON.parse(cv.value);
    return { files: Array.isArray(parsed.files) ? parsed.files : [] };
  } catch {
    return { files: [] };
  }
}

// Descobre o assetId de um arquivo recém-anexado por diferença: a mutação de
// upload (add_file_to_column) só devolve o id do ITEM, não o do arquivo
// criado — então buscamos a lista de arquivos da coluna de novo e comparamos
// com o conjunto de ids que existia ANTES do upload (`existingIds`, um Set).
// Usado pelo rastreio de leitura de propostas (precisa saber qual asset é o
// PDF recém-gerado, pra colocar no token de rastreio) — ver
// app/api/word-addin/finalize/route.js.
//
// Corrigido em 21/08/2026: quando o lead já tinha proposta(s) anexada(s)
// antes (ou quando o monday.com demora um instante pra refletir o upload do
// .docx na leitura seguinte — consistência eventual da API), mais de um
// arquivo pode aparecer como "não existia antes" ao mesmo tempo (o próprio
// .docx recém-subido + o PDF). A versão antiga pegava sempre o PRIMEIRO da
// lista (`.find`), sem checar qual realmente é o esperado — na prática podia
// devolver o asset do .docx em vez do PDF, e o link de rastreio saía
// apontando pro arquivo errado. Agora, quando `expectedName` é informado,
// filtra pelos arquivos "novos" com esse nome exato; e em qualquer empate
// remanescente, escolhe o de maior assetId (os ids do monday.com são
// atribuídos de forma crescente na criação, então o maior é sempre o mais
// recente).
export async function findNewFileAssetId(itemId, columnId, existingIds, expectedName) {
  const raw = await fetchItemFileColumnRaw(itemId, columnId);
  const fresh = (raw.files || []).filter(
    (f) => f.fileType === 'ASSET' && f.assetId && !existingIds.has(String(f.assetId))
  );
  if (fresh.length === 0) return null;
  const byName = expectedName ? fresh.filter((f) => f.name === expectedName) : [];
  const candidates = byName.length > 0 ? byName : fresh;
  candidates.sort((a, b) => Number(b.assetId) - Number(a.assetId));
  return String(candidates[0].assetId);
}

// Remove um arquivo específico de uma coluna de arquivos. A API do
// monday.com não tem uma mutação "apague só este arquivo" — a única forma é
// update_assets_on_item, que SUBSTITUI a lista inteira da coluna. Por isso
// sempre buscamos a lista atual (fetchItemFileColumnRaw, direto do
// monday.com) antes de escrever de volta sem o arquivo removido.
export async function removeFileFromItem(boardId, itemId, columnId, assetIdToRemove) {
  const raw = await fetchItemFileColumnRaw(itemId, columnId);
  const remaining = (raw.files || []).filter(
    (f) => f.fileType === 'ASSET' && f.assetId && String(f.assetId) !== String(assetIdToRemove)
  );
  const files = remaining.map((f) => ({
    assetId: String(f.assetId),
    // O enum da mutação é minúsculo ("asset"), diferente do "ASSET" maiúsculo
    // usado dentro do JSON bruto da própria coluna — são representações
    // diferentes (confirmado direto no schema da API antes de usar isso aqui).
    fileType: 'asset',
    name: f.name,
  }));

  const query = `
    mutation RemoveFile($boardId: ID!, $itemId: ID!, $columnId: String!, $files: [FileInput!]!) {
      update_assets_on_item(board_id: $boardId, item_id: $itemId, column_id: $columnId, files: $files) {
        id
      }
    }
  `;
  await mondayRequest(query, { boardId, itemId, columnId, files });

  return files.map((f) => ({ assetId: f.assetId, name: f.name }));
}

// Busca o texto "cru" de uma coluna qualquer de um item — usado pelo board
// de Configurações (Fase 5: probabilidades de forecast), que guarda um JSON
// dentro de uma coluna long_text. Diferente de fetchItemFileColumnRaw (essa
// é específica pra colunas de arquivo), esta é genérica: devolve o campo
// "text" puro, que pra long_text já é a própria string gravada (confirmado
// direto na API do monday.com antes de usar esse padrão pela primeira vez,
// em Contatos e Decisores).
export async function fetchItemColumnText(itemId, columnId) {
  const query = `
    query GetColumnText($itemId: [ID!], $columnId: [String!]) {
      items(ids: $itemId) {
        column_values(ids: $columnId) {
          text
        }
      }
    }
  `;
  const data = await mondayRequest(query, { itemId: [itemId], columnId: [columnId] });
  const item = data.items && data.items[0];
  const cv = item && item.column_values && item.column_values[0];
  return cv ? cv.text : null;
}

export async function fetchUsers() {
  const query = `
    query GetUsers {
      users(limit: 200) {
        id
        name
        photo_thumb_small
        enabled
      }
    }
  `;
  const data = await mondayRequest(query);
  return (data.users || [])
    .filter((u) => u.enabled !== false)
    .map((u) => ({ id: u.id, name: u.name, photo: u.photo_thumb_small }));
}

export async function updateItemColumns(boardId, itemId, columnValues) {
  const query = `
    mutation ChangeColumns($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(
        board_id: $boardId
        item_id: $itemId
        column_values: $columnValues
      ) {
        id
      }
    }
  `;
  const data = await mondayRequest(query, {
    boardId,
    itemId,
    columnValues: JSON.stringify(columnValues),
  });
  return data.change_multiple_column_values;
}

export async function createLead(boardId, groupId, name, columnValues) {
  const query = `
    mutation CreateItem($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON) {
      create_item(
        board_id: $boardId
        group_id: $groupId
        item_name: $itemName
        column_values: $columnValues
      ) {
        id
      }
    }
  `;
  const data = await mondayRequest(query, {
    boardId,
    groupId: groupId || null,
    itemName: name,
    columnValues: columnValues ? JSON.stringify(columnValues) : null,
  });
  return data.create_item;
}

export async function fetchItemNotes(itemId) {
  const query = `
    query GetNotes($itemId: [ID!]) {
      items(ids: $itemId) {
        updates(limit: 100) {
          id
          text_body
          created_at
          creator { id name photo_thumb_small }
        }
      }
    }
  `;
  const data = await mondayRequest(query, { itemId: [itemId] });
  const item = data.items && data.items[0];
  if (!item) return [];
  return item.updates
    .map((u) => ({
      id: u.id,
      text: u.text_body,
      createdAt: u.created_at,
      author: u.creator ? u.creator.name : 'Alguém',
      authorPhoto: u.creator ? u.creator.photo_thumb_small : null,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function addItemNote(itemId, body) {
  const query = `
    mutation AddNote($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) {
        id
      }
    }
  `;
  const data = await mondayRequest(query, { itemId, body });
  return data.create_update;
}

// Upload de arquivo (usado pelo suplemento do Word para anexar a proposta —
// .docx e/ou .pdf — direto na coluna "Propostas" do lead). É uma chamada
// diferente das outras: a API de upload do monday.com não é GraphQL puro
// (JSON), é multipart/form-data num endpoint HTTP separado.
export async function uploadFileToItem(itemId, columnId, buffer, filename, mimeType) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    throw new Error(
      'MONDAY_API_TOKEN não está configurado. Defina essa variável de ambiente com um token de API pessoal do monday.com.'
    );
  }

  const form = new FormData();
  form.append(
    'query',
    `mutation ($file: File!) { add_file_to_column (item_id: ${itemId}, column_id: "${columnId}", file: $file) { id } }`
  );
  form.append('variables[file]', new Blob([buffer], { type: mimeType }), filename);

  const res = await fetch('https://api.monday.com/v2/file', {
    method: 'POST',
    headers: { Authorization: token },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`monday.com API (upload) respondeu ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = await res.json();
  if (json.errors && json.errors.length > 0) {
    const message = json.errors.map((e) => e.message).join('; ');
    throw new Error(`monday.com API error (upload): ${message}`);
  }

  return json.data.add_file_to_column;
}
