import { NextResponse } from 'next/server';
import { fetchAllItems, createLead } from '../../../lib/monday';
import { BOARD_ID, COLUMNS, EMPRESAS_BOARD_ID, columnIdsConfigurados } from '../../../lib/config';
import { flattenItem, buildColumnValues } from '../../../lib/transform';
import { listarEmpresas } from '../../../lib/estruturaServer';
import { aplicarOportunidade, parseOportunidade } from '../../../lib/oportunidade.js';
import { getSessao } from '../../../lib/sessao';

export const dynamic = 'force-dynamic';

// Só pede ao monday as colunas que existem de fato neste ambiente (as colunas
// novas da v1 de prioridades podem ainda não ter id — ver lib/config.js).
const COLUMN_IDS = columnIdsConfigurados();

export async function GET() {
  try {
    const items = await fetchAllItems(BOARD_ID, COLUMN_IDS);
    // Não buscamos a URL de cada proposta aqui: a public_url do monday.com
    // expira em 1h e força download em vez de exibir inline. A prévia no
    // drawer pede a URL sob demanda, na hora de abrir (ver
    // /api/proposals/[assetId]/link), então sempre pega uma fresca.
    const lista = items.map(flattenItem);

    // Empresa cadastrada (board Empresas) é a fonte do NOME da organização:
    // quando o lead tem `empresaId`, o nome exibido vem de lá. O texto antigo
    // da coluna "Empresa" não é alterado e segue em `empresaLegado`. Se o board
    // falhar, o CRM continua funcionando com o texto antigo e avisa.
    let empresasErro = null;
    if (EMPRESAS_BOARD_ID && COLUMNS.empresaId && lista.some((l) => l.empresaId)) {
      try {
        const porId = new Map((await listarEmpresas()).map((e) => [e.id, e.nome]));
        for (const l of lista) {
          if (!l.empresaId) continue;
          l.empresaLegado = l.empresa;
          const nome = porId.get(l.empresaId);
          if (nome) l.empresa = nome;
          else l.empresaVinculoQuebrado = true; // id não existe mais: mantém o texto antigo
        }
      } catch (e) {
        empresasErro = `Não foi possível ler o board de empresas: ${e.message}`;
      }
    }
    return NextResponse.json({ items: lista, empresasErro });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Cria um novo lead manualmente pela página (ex: contato que chegou por
// telefone e não passou pela extensão do Chrome).
export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 });
    }
    const columnValues = buildColumnValues({ estagio: 'Lead', ...body.fields });
    // v2: vínculo opcional com empresa já cadastrada e nome da oportunidade.
    // Lead SEM empresa continua permitido (não exige CNPJ, e-mail nem empresa).
    if (body.empresaId) {
      if (!COLUMNS.empresaId) {
        return NextResponse.json({ error: 'A coluna "Empresa ID" ainda não existe neste ambiente (veja o README).' }, { status: 409 });
      }
      columnValues[COLUMNS.empresaId] = String(body.empresaId);
    }
    if (body.oportunidadeNome) {
      if (!COLUMNS.oportunidade) {
        return NextResponse.json({ error: 'A coluna "Oportunidade (JSON)" ainda não existe neste ambiente (veja o README).' }, { status: 409 });
      }
      const sessao = await getSessao(request);
      const r = aplicarOportunidade(parseOportunidade(''), { nome: body.oportunidadeNome }, { autor: sessao?.name });
      if (r.erro) return NextResponse.json({ error: r.erro }, { status: 400 });
      columnValues[COLUMNS.oportunidade] = r.texto;
    }
    const created = await createLead(BOARD_ID, null, body.name.trim(), columnValues);
    return NextResponse.json({ item: created });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
