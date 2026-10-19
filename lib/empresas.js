// Empresa × contato × oportunidade: normalização e SUGESTÕES de vínculo —
// puro, testado em tests/empresas.test.mjs.
//
// Regras (pedido do Tiago):
//  - NUNCA agrupa/vincula sozinho por nome parecido: só devolve sugestões, que
//    uma pessoa confirma uma a uma;
//  - não exige CNPJ nem e-mail; contato pode existir sem empresa;
//  - não copia valores ao vincular (o vínculo é só um id).

const SUFIXOS = new Set([
  'ltda', 'me', 'epp', 'eireli', 'sa', 's', 'a', 'cia', 'companhia', 'industria', 'industrias', 'comercio',
  'comercial', 'e', 'de', 'do', 'da', 'dos', 'das', 'servicos', 'materiais', 'construcao', 'construcoes',
]);

export function semAcento(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

// "Pré-Moldados Silva Ltda." → "pre moldados silva"
export function normalizarNomeEmpresa(nome) {
  const t = semAcento(nome).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return t
    .split(' ')
    .filter((w) => w && !SUFIXOS.has(w))
    .join(' ');
}

export function somenteDigitos(s) {
  return String(s || '').replace(/\D+/g, '');
}

// Telefone comparável: só dígitos, sem DDI 55, últimos 11 (DDD + 9 dígitos) ou
// 10. Retorna '' se curto demais para comparar (evita "falsos iguais").
export function normalizarTelefone(tel) {
  let d = somenteDigitos(tel);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10) return '';
  return d.slice(-11);
}

export function normalizarCnpj(c) {
  const d = somenteDigitos(c);
  return d.length === 14 ? d : '';
}

function tokens(s) {
  return new Set(normalizarNomeEmpresa(s).split(' ').filter(Boolean));
}

export function similaridade(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.max(A.size, B.size);
}

// Sugere vínculos lead → empresa cadastrada. `leads`: itens achatados;
// `empresas`: [{id, nome, cnpj}]. Só considera leads SEM empresaId.
// confianca 'alta' = mesmo nome normalizado (ou mesmo CNPJ); 'media' = muito
// parecido. Nada é aplicado.
export function sugerirVinculosEmpresa(leads, empresas) {
  const out = [];
  const porNorm = new Map();
  for (const e of empresas) {
    const n = normalizarNomeEmpresa(e.nome);
    if (!n) continue;
    if (!porNorm.has(n)) porNorm.set(n, []);
    porNorm.get(n).push(e);
  }
  for (const l of leads) {
    if (l.empresaId) continue;
    const nome = l.empresa;
    const n = normalizarNomeEmpresa(nome);
    if (!n) continue;
    const exatas = porNorm.get(n);
    if (exatas?.length) {
      for (const e of exatas) {
        out.push({ leadId: l.id, leadNome: l.name, empresaId: e.id, empresaNome: e.nome, confianca: 'alta', motivo: 'mesmo nome após normalizar (ignora maiúsculas, acentos, Ltda/ME)' });
      }
      continue;
    }
    let melhor = null;
    for (const e of empresas) {
      const s = similaridade(nome, e.nome);
      if (s >= 0.6 && (!melhor || s > melhor.s)) melhor = { s, e };
    }
    if (melhor) {
      out.push({ leadId: l.id, leadNome: l.name, empresaId: melhor.e.id, empresaNome: melhor.e.nome, confianca: 'media', motivo: `nomes parecidos (${Math.round(melhor.s * 100)}% das palavras em comum)` });
    }
  }
  return out;
}

// Leads SEM empresa cadastrada que parecem ser da mesma empresa (candidatas a
// uma única empresa nova). Só agrupa quando o nome normalizado é IGUAL — a
// decisão de criar a empresa e vincular continua sendo humana.
export function sugerirGruposDeLeads(leads) {
  const mapa = new Map();
  for (const l of leads) {
    if (l.empresaId) continue;
    const n = normalizarNomeEmpresa(l.empresa);
    if (!n) continue;
    if (!mapa.has(n)) mapa.set(n, []);
    mapa.get(n).push(l);
  }
  return [...mapa.entries()]
    .filter(([, ls]) => ls.length > 1)
    .map(([chave, ls]) => ({
      chave,
      nomeSugerido: ls[0].empresa,
      leads: ls.map((l) => ({ id: l.id, nome: l.name, empresa: l.empresa })),
    }));
}

// Contatos antigos (JSON legado do lead) que já têm um contato equivalente no
// board Contatos (mesmo telefone) — para sugerir "usar este" em vez de duplicar.
export function acharContatoEquivalente(legado, contatos) {
  const tel = normalizarTelefone(legado?.phone);
  if (!tel) return null;
  return contatos.find((c) => normalizarTelefone(c.telefone) === tel) || null;
}

// Possíveis contatos duplicados no board (mesmo telefone normalizado).
export function achaDuplicatasContatos(contatos) {
  const mapa = new Map();
  for (const c of contatos) {
    const t = normalizarTelefone(c.telefone);
    if (!t) continue;
    if (!mapa.has(t)) mapa.set(t, []);
    mapa.get(t).push(c);
  }
  return [...mapa.values()].filter((g) => g.length > 1);
}
