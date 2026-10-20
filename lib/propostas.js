// Registro comercial de PROPOSTAS de uma oportunidade — puro (sem imports de
// framework), testado em tests/propostas.test.mjs.
//
// O que já existia e continua intocado:
//   - arquivos anexados na coluna "Propostas" (DOCX, PDF, layouts...)
//   - "Rastreio de Propostas" (envios em PDF com link de leitura)
// Este registro NÃO guarda arquivos nem links: só CLASSIFICA o que já existe
// ("este DOCX e este PDF são a proposta 2026-045 rev B, enviada, vigente").
//
// Limite real do monday: uma coluna long_text guarda no máximo 2.000
// caracteres (confirmado nos dados de produção: um JSON de rastreio ficou
// truncado em exatamente 2000). Por isso o registro é gravado numa
// representação COMPACTA e há um teto (LIMITE_JSON) — passou disso, a rota
// recusa gravar em vez de truncar em silêncio e corromper o JSON.

export const LIMITE_JSON = 1900;
export const SITUACOES = ['rascunho', 'enviada', 'substituida', 'aceita'];
export const SITUACAO_LABEL = {
  rascunho: 'Rascunho',
  enviada: 'Enviada',
  substituida: 'Substituída',
  aceita: 'Aceita',
};
export const TIPOS = ['principal', 'alternativa'];

const LIM = { numero: 30, revisao: 10, rotulo: 40, obs: 80 };

const SIT_CURTA = { rascunho: 'r', enviada: 'e', substituida: 's', aceita: 'a' };
const SIT_LONGA = { r: 'rascunho', e: 'enviada', s: 'substituida', a: 'aceita' };

export function registroVazio() {
  return { v: 1, rev: 0, docs: [], vigenteId: null, atualizadoEm: null, atualizadoPor: null };
}

// ---------------------------------------------------------------------
// (De)serialização compacta
// ---------------------------------------------------------------------
function docParaArmazenamento(d) {
  const o = { i: d.id };
  if (d.numero) o.n = d.numero;
  if (d.revisao) o.r = d.revisao;
  if (d.tipo === 'alternativa') {
    o.t = 'a';
    if (d.alternativaDe) o.p = d.alternativaDe;
    if (d.rotulo) o.l = d.rotulo;
  }
  o.s = SIT_CURTA[d.situacao] || 'r';
  if (d.data) o.d = d.data;
  if (d.arquivos?.length) o.a = d.arquivos.map(String);
  if (d.sendIds?.length) o.e = d.sendIds;
  if (d.valor !== null && d.valor !== undefined) o.v = d.valor;
  if (d.obs) o.o = d.obs;
  if (d.aceitoEm) o.c = d.aceitoEm;
  if (d.envioEm) o.q = d.envioEm;
  return o;
}

function docDeArmazenamento(o) {
  return {
    id: String(o.i),
    numero: o.n || null,
    revisao: o.r || null,
    tipo: o.t === 'a' ? 'alternativa' : 'principal',
    alternativaDe: o.p || null,
    rotulo: o.l || null,
    situacao: SIT_LONGA[o.s] || 'rascunho',
    data: o.d || null,
    arquivos: Array.isArray(o.a) ? o.a.map(String) : [],
    sendIds: Array.isArray(o.e) ? o.e.map(String) : [],
    valor: typeof o.v === 'number' ? o.v : null,
    obs: o.o || null,
    aceitoEm: o.c || null,
    envioEm: o.q || null,
  };
}

export function serializarRegistro(reg) {
  const o = { v: 1, r: reg.rev || 0, d: (reg.docs || []).map(docParaArmazenamento) };
  if (reg.vigenteId) o.g = reg.vigenteId;
  if (reg.atualizadoEm) o.u = reg.atualizadoEm;
  if (reg.atualizadoPor) o.b = String(reg.atualizadoPor).slice(0, 30);
  return JSON.stringify(o);
}

// Tolerante: coluna ausente/vazia/corrompida vira registro vazio (e `corrompido`
// avisa a tela, que NÃO deve regravar por cima sem o usuário saber).
export function parseRegistro(texto) {
  if (!texto) return registroVazio();
  try {
    const o = JSON.parse(texto);
    if (!o || typeof o !== 'object' || !Array.isArray(o.d)) return { ...registroVazio(), corrompido: true };
    return {
      v: 1,
      rev: Number(o.r) || 0,
      docs: o.d.filter((x) => x && x.i).map(docDeArmazenamento),
      vigenteId: o.g || null,
      atualizadoEm: o.u || null,
      atualizadoPor: o.b || null,
    };
  } catch {
    return { ...registroVazio(), corrompido: true };
  }
}

// ---------------------------------------------------------------------
// Nomes de arquivo → sugestões (NUNCA aplicadas sozinhas)
// ---------------------------------------------------------------------
export function extensaoDe(nome) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(nome || ''));
  return m ? m[1].toLowerCase() : '';
}

export function formatoDe(nome) {
  const e = extensaoDe(nome);
  if (e === 'doc' || e === 'docx') return 'DOCX';
  if (e === 'pdf') return 'PDF';
  return e ? e.toUpperCase() : 'ARQUIVO';
}

// Chave de comparação: nome sem extensão, minúsculo, sem acentos, sem sufixos de
// cópia do tipo " (1)", "- copia", "copy". DOCX e PDF da mesma proposta caem na
// mesma chave; "Proposta rev B" e "Proposta rev C" NÃO (a revisão faz parte).
export function chaveBase(nome) {
  let s = String(nome || '').replace(/\.[a-z0-9]{1,5}$/i, '');
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/\s*[-_ ]*\((\d{1,2})\)\s*$/g, '');
  s = s.replace(/\s*[-_ ]*(copia|copy|cópia)( de)?\s*$/g, '');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

// Tenta ler número e revisão no nome do arquivo — só como SUGESTÃO pré-
// preenchida; o usuário confirma ou corrige.
export function dicasDoNome(nome) {
  const base = String(nome || '').replace(/\.[a-z0-9]{1,5}$/i, '');
  const num = /(?:proposta|prop\.?|orc(?:amento|\.)?|orçamento)[\s_-]*(?:n[ºo°.]?\s*)?(\d[\d./-]{1,20}\d)/i.exec(base);
  const rev = /(?:\brev(?:is[aã]o)?\.?|\br)[\s_.-]*([a-z]|\d{1,2})\b/i.exec(base.replace(/(\d)[_ ]r/gi, '$1 r'));
  return { numero: num ? num[1] : null, revisao: rev ? rev[1].toUpperCase() : null };
}

// Agrupa arquivos AINDA NÃO CLASSIFICADOS em "documentos prováveis" e aponta
// possíveis duplicatas (mesmo documento com o mesmo formato mais de uma vez).
// `arquivos`: [{assetId, name}], `jaVinculados`: Set de assetIds já no registro.
export function sugerirAgrupamentos(arquivos, jaVinculados = new Set(), docs = []) {
  const grupos = new Map();
  for (const a of arquivos || []) {
    if (jaVinculados.has(String(a.assetId))) continue;
    const k = chaveBase(a.name);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a);
  }
  const chavesRegistradas = new Map(); // chave+formato -> doc
  for (const d of docs) {
    for (const f of d.arquivosInfo || []) chavesRegistradas.set(`${chaveBase(f.name)}|${formatoDe(f.name)}`, d);
  }
  const out = [];
  for (const [chave, lista] of grupos) {
    const porFormato = new Map();
    for (const a of lista) {
      const f = formatoDe(a.name);
      porFormato.set(f, (porFormato.get(f) || 0) + 1);
    }
    const duplicadosNoGrupo = [...porFormato.entries()].filter(([, n]) => n > 1).map(([f]) => f);
    const duplicaRegistrado = lista
      .map((a) => chavesRegistradas.get(`${chave}|${formatoDe(a.name)}`))
      .filter(Boolean);
    out.push({
      chave,
      arquivos: lista.map((a) => ({ assetId: String(a.assetId), name: a.name, formato: formatoDe(a.name) })),
      dicas: dicasDoNome(lista[0].name),
      possivelDuplicata: duplicadosNoGrupo.length > 0 || duplicaRegistrado.length > 0,
      motivoDuplicata:
        duplicadosNoGrupo.length > 0
          ? `Há mais de um arquivo ${duplicadosNoGrupo.join('/')} com nome equivalente.`
          : duplicaRegistrado.length > 0
            ? 'Mesmo nome e formato de um arquivo já registrado.'
            : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// Operações (todas devolvem uma NOVA cópia do registro)
// ---------------------------------------------------------------------
function limpa(s, max) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

function dataOk(v) {
  if (v === undefined || v === null || v === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  if (!m) return undefined;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.getUTCMonth() === +m[2] - 1 ? String(v) : undefined;
}

function valorOk(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

// Data em que a proposta FOI ENVIADA ao cliente (evento explícito, informado por
// quem enviou). Não é futura nem tem mais de um ano. Upload, geração de PDF e
// visualização do cliente NÃO são envio e nunca preenchem este campo.
export function envioOk(v, hoje) {
  if (v === undefined || v === null || v === '') return null;
  const d = dataOk(v);
  if (d === undefined) return { erro: 'Data de envio inválida (use AAAA-MM-DD).' };
  if (hoje && d > hoje) return { erro: 'A data de envio não pode estar no futuro.' };
  if (hoje && (Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000 > 370) {
    return { erro: 'Data de envio antiga demais (mais de um ano).' };
  }
  return d;
}

let seq = 0;
export function novoIdProposta() {
  seq += 1;
  return `p${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}${seq.toString(36)}`;
}

function arquivoJaUsado(docs, assetId, exceto) {
  return docs.find((d) => d.id !== exceto && d.arquivos.includes(String(assetId)));
}

function resumoDoc(d) {
  const nome = d.numero ? `${d.numero}${d.revisao ? ` rev ${d.revisao}` : ''}` : d.rotulo || 'sem número';
  return d.tipo === 'alternativa' ? `${nome} (alternativa${d.rotulo && d.numero ? `: ${d.rotulo}` : ''})` : nome;
}
export { resumoDoc };

// Aplica uma operação ao registro. `ctx`:
//   { expectedRev, autor, agora (ISO), assetsAtuais:Set<string>, gerarId }
// Resultado: { conflito:true, atual } | { erro } | { registro, efeitos:[...], nota }
export function aplicarOperacao(registro, op, ctx = {}) {
  const reg = registro || registroVazio();
  if (reg.corrompido) {
    return { erro: 'O registro de propostas deste lead está ilegível (JSON corrompido). Corrija ou limpe a coluna no monday antes de continuar.' };
  }
  if (ctx.expectedRev !== undefined && ctx.expectedRev !== null && Number(ctx.expectedRev) !== (reg.rev || 0)) {
    return { conflito: true, atual: reg };
  }
  const gerarId = ctx.gerarId || novoIdProposta;
  const docs = reg.docs.map((d) => ({ ...d, arquivos: [...d.arquivos], sendIds: [...d.sendIds] }));
  let vigenteId = reg.vigenteId;
  const efeitos = [];
  let nota = null;
  const achar = (id) => docs.find((d) => d.id === id);

  const validarArquivos = (ids, exceto) => {
    const lista = [...new Set((ids || []).map(String))];
    for (const a of lista) {
      if (ctx.assetsAtuais && !ctx.assetsAtuais.has(a)) return { erro: `O arquivo ${a} não está mais anexado a este lead.` };
      const uso = arquivoJaUsado(docs, a, exceto);
      if (uso) return { erro: `Um dos arquivos já está registrado na proposta ${resumoDoc(uso)}.` };
    }
    return { lista };
  };

  const camposComuns = (src, base = {}) => {
    const out = { ...base };
    if ('numero' in src) out.numero = limpa(src.numero, LIM.numero);
    if ('revisao' in src) out.revisao = limpa(src.revisao, LIM.revisao);
    if ('rotulo' in src) out.rotulo = limpa(src.rotulo, LIM.rotulo);
    if ('obs' in src) out.obs = limpa(src.obs, LIM.obs);
    if ('data' in src) {
      const d = dataOk(src.data);
      if (d === undefined) return { erro: 'Data inválida (use AAAA-MM-DD).' };
      out.data = d;
    }
    if ('envioEm' in src) {
      const e = envioOk(src.envioEm, ctx.hoje);
      if (e && e.erro) return { erro: e.erro };
      out.envioEm = e || null;
    }
    if ('valor' in src) {
      const v = valorOk(src.valor);
      if (v === undefined) return { erro: 'Valor inválido.' };
      out.valor = v; // informativo: NUNCA altera o valor estimado da oportunidade
    }
    if ('situacao' in src) {
      if (!SITUACOES.includes(src.situacao)) return { erro: 'Situação inválida.' };
      out.situacao = src.situacao;
    }
    return { out };
  };

  switch (op.acao) {
    case 'registrar': {
      if (docs.length >= 12) return { erro: 'Limite de 12 propostas registradas por oportunidade (o monday guarda no máximo 2.000 caracteres nesta coluna).' };
      const tipo = op.tipo === 'alternativa' ? 'alternativa' : 'principal';
      if (!SITUACOES.includes(op.situacao)) return { erro: 'Informe a situação da proposta (rascunho, enviada, substituída ou aceita) — o sistema não presume.' };
      const arq = validarArquivos(op.arquivos);
      if (arq.erro) return arq;
      const c = camposComuns(op, {});
      if (c.erro) return c;
      let alternativaDe = null;
      if (tipo === 'alternativa') {
        if (!c.out.rotulo) return { erro: 'Alternativa precisa de um rótulo (ex.: "com esteira").' };
        if (op.alternativaDe) {
          if (!achar(op.alternativaDe)) return { erro: 'A proposta de referência da alternativa não existe.' };
          alternativaDe = op.alternativaDe;
        }
      }
      const doc = {
        id: gerarId(),
        numero: null,
        revisao: null,
        tipo,
        alternativaDe,
        rotulo: null,
        situacao: op.situacao,
        data: null,
        arquivos: arq.lista,
        sendIds: [],
        valor: null,
        obs: null,
        aceitoEm: null,
        envioEm: null,
        ...c.out,
      };
      // envioEm só faz sentido para proposta enviada; nas demais situações é ignorado.
      if (doc.situacao !== 'enviada') doc.envioEm = null;
      if (doc.situacao === 'aceita') doc.aceitoEm = doc.data || ctx.hoje || null;
      docs.push(doc);
      nota = `Proposta ${resumoDoc(doc)} registrada como ${SITUACAO_LABEL[doc.situacao].toLowerCase()}.`;
      break;
    }
    case 'nova_revisao': {
      if (docs.length >= 12) return { erro: 'Limite de 12 propostas registradas por oportunidade.' };
      const base = achar(op.baseId);
      if (!base) return { erro: 'Proposta base não encontrada.' };
      const revisao = limpa(op.revisao, LIM.revisao);
      if (!revisao) return { erro: 'Informe a identificação da nova revisão (ex.: B).' };
      if (docs.some((d) => d.numero && d.numero === base.numero && d.revisao === revisao && d.tipo === base.tipo && d.alternativaDe === base.alternativaDe)) {
        return { erro: `Já existe a revisão ${revisao} desta proposta.` };
      }
      const arq = validarArquivos(op.arquivos);
      if (arq.erro) return arq;
      const d = dataOk(op.data);
      if (d === undefined) return { erro: 'Data inválida (use AAAA-MM-DD).' };
      const doc = {
        ...base,
        id: gerarId(),
        revisao,
        situacao: 'rascunho', // nunca presume que a revisão nova já foi enviada
        data: d,
        arquivos: arq.lista,
        sendIds: [],
        valor: null, // valor da revisão é informado à parte (não herda nem soma)
        aceitoEm: null,
        envioEm: null,
        obs: null,
      };
      docs.push(doc);
      nota = `Nova revisão ${resumoDoc(doc)} criada como rascunho a partir de ${resumoDoc(base)}.`;
      break;
    }
    case 'atualizar': {
      const d = achar(op.id);
      if (!d) return { erro: 'Proposta não encontrada.' };
      const c = camposComuns(op.campos || {}, {});
      if (c.erro) return c;
      Object.assign(d, c.out);
      if (op.campos && 'arquivos' in op.campos) {
        const arq = validarArquivos(op.campos.arquivos, d.id);
        if (arq.erro) return arq;
        d.arquivos = arq.lista;
      }
      if (c.out.situacao === 'aceita' && !d.aceitoEm) d.aceitoEm = ctx.hoje || null;
      if (c.out.situacao && c.out.situacao !== 'aceita') d.aceitoEm = null;
      if (c.out.situacao === 'rascunho') d.envioEm = null;
      if (d.situacao !== 'enviada' && d.situacao !== 'substituida' && d.situacao !== 'aceita') d.envioEm = null;
      nota = `Proposta ${resumoDoc(d)} atualizada${c.out.situacao ? ` (${SITUACAO_LABEL[c.out.situacao].toLowerCase()})` : ''}.`;
      break;
    }
    case 'enviar': {
      // Registro EXPLÍCITO de envio ao cliente (gatilho confiável da regra A).
      const d = achar(op.id);
      if (!d) return { erro: 'Proposta não encontrada.' };
      if (d.situacao === 'substituida' || d.situacao === 'aceita') {
        return { erro: `Esta proposta está ${SITUACAO_LABEL[d.situacao].toLowerCase()}; registre o envio na revisão vigente.` };
      }
      const e = envioOk(op.data || ctx.hoje, ctx.hoje);
      if (e && e.erro) return { erro: e.erro };
      if (!e) return { erro: 'Informe a data do envio.' };
      if (d.situacao === 'enviada' && d.envioEm === e) {
        return { registro: reg, efeitos: [], nota: null, texto: serializarRegistro(reg), semAlteracao: true };
      }
      d.situacao = 'enviada';
      d.envioEm = e;
      nota = `Envio da proposta ${resumoDoc(d)} registrado em ${e.split('-').reverse().join('/')} (registro explícito).`;
      break;
    }
    case 'vigente': {
      if (op.id === null || op.id === undefined || op.id === '') {
        vigenteId = null;
        nota = 'Nenhuma proposta marcada como vigente.';
        break;
      }
      const d = achar(op.id);
      if (!d) return { erro: 'Proposta não encontrada.' };
      const anterior = vigenteId && vigenteId !== d.id ? achar(vigenteId) : null;
      vigenteId = d.id;
      if (anterior) {
        const mesmaFamilia = anterior.numero && anterior.numero === d.numero && anterior.tipo === d.tipo && anterior.alternativaDe === d.alternativaDe;
        if (mesmaFamilia && anterior.situacao === 'enviada') {
          anterior.situacao = 'substituida';
          efeitos.push(`A revisão ${resumoDoc(anterior)} passou para "substituída" por ser a mesma proposta.`);
        } else {
          efeitos.push(`${resumoDoc(anterior)} deixou de ser a vigente (situação mantida: ${SITUACAO_LABEL[anterior.situacao].toLowerCase()}).`);
        }
      }
      nota = `Proposta ${resumoDoc(d)} marcada como a vigente (referência comercial).`;
      break;
    }
    case 'aceitar': {
      const d = achar(op.id);
      if (!d) return { erro: 'Proposta não encontrada.' };
      const data = dataOk(op.data);
      if (data === undefined) return { erro: 'Data inválida (use AAAA-MM-DD).' };
      d.situacao = 'aceita';
      d.aceitoEm = data || ctx.hoje || null;
      const outras = docs.filter((x) => x.id !== d.id && x.situacao === 'aceita');
      if (outras.length) efeitos.push(`Atenção: há outra proposta aceita nesta oportunidade (${outras.map(resumoDoc).join(', ')}).`);
      nota = `Aceite da proposta ${resumoDoc(d)} confirmado manualmente (${d.aceitoEm || 'sem data'}).`;
      break;
    }
    case 'remover': {
      const d = achar(op.id);
      if (!d) return { erro: 'Proposta não encontrada.' };
      docs.splice(docs.indexOf(d), 1);
      for (const x of docs) if (x.alternativaDe === d.id) x.alternativaDe = null;
      if (vigenteId === d.id) vigenteId = null;
      nota = `Registro da proposta ${resumoDoc(d)} removido (os arquivos anexados não foram apagados).`;
      break;
    }
    default:
      return { erro: 'Operação desconhecida.' };
  }

  const novo = {
    v: 1,
    rev: (reg.rev || 0) + 1,
    docs,
    vigenteId,
    atualizadoEm: ctx.agora || null,
    atualizadoPor: ctx.autor || null,
  };
  const texto = serializarRegistro(novo);
  if (texto.length > LIMITE_JSON) {
    return { erro: `O registro de propostas ficou grande demais para o monday (${texto.length} de ${LIMITE_JSON} caracteres). Remova registros antigos ou encurte observações.` };
  }
  return { registro: novo, efeitos, nota, texto };
}

// ---------------------------------------------------------------------
// Visão pronta para a tela: vigente + situação de envio/visualização
// ---------------------------------------------------------------------
// `arquivosPorId`: Map assetId -> {assetId, name}; `rastreio`: lista do
// "Rastreio de Propostas". Visualização do cliente é SEMPRE rotulada como
// estimativa; aceite só existe se alguém confirmou manualmente.
export function visaoPropostas(registro, arquivos = [], rastreio = []) {
  const reg = registro || registroVazio();
  const porId = new Map((arquivos || []).map((a) => [String(a.assetId), a]));
  const envioPorAsset = new Map();
  for (const e of rastreio || []) if (e?.assetId) envioPorAsset.set(String(e.assetId), e);

  const docs = reg.docs.map((d) => {
    const arquivosInfo = d.arquivos.map((id) => porId.get(String(id)) || { assetId: String(id), name: '(arquivo removido do lead)', removido: true });
    const envios = d.arquivos.map((id) => envioPorAsset.get(String(id))).filter(Boolean);
    const ultimoEnvio = envios.sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))[0] || null;
    const rastreioIndicaEnvio = !!ultimoEnvio && d.situacao === 'rascunho';
    return {
      ...d,
      titulo: resumoDoc(d),
      arquivosInfo,
      formatos: [...new Set(arquivosInfo.map((a) => formatoDe(a.name)))],
      envioRastreado: ultimoEnvio
        ? {
            sendId: ultimoEnvio.sendId,
            enviadoEm: ultimoEnvio.sentAt,
            visualizacoes: ultimoEnvio.viewCount || 0,
            ultimaVisualizacao: ultimoEnvio.lastViewedAt || null,
            baixou: (ultimoEnvio.downloadCount || 0) > 0,
          }
        : null,
      avisoRastreio: rastreioIndicaEnvio
        ? 'O rastreio mostra um envio deste arquivo, mas a situação registrada é "rascunho". Confirme a situação.'
        : null,
    };
  });
  const vigente = docs.find((d) => d.id === reg.vigenteId) || null;
  return {
    rev: reg.rev || 0,
    corrompido: !!reg.corrompido,
    docs,
    vigente,
    semVigente: docs.length > 0 && !vigente,
    aceitas: docs.filter((d) => d.situacao === 'aceita').length,
    vinculados: new Set(reg.docs.flatMap((d) => d.arquivos)),
  };
}
