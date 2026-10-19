import { NextResponse } from 'next/server';
import { createLead } from '../../../lib/monday';
import { EMPRESAS_BOARD_ID, EMPRESAS_COLUMNS, estruturaV2Status } from '../../../lib/config';
import { listarEmpresas, listarContatos } from '../../../lib/estruturaServer';
import { normalizarNomeEmpresa, normalizarCnpj } from '../../../lib/empresas.js';

export const dynamic = 'force-dynamic';

// Empresas (organizações) e Contatos (pessoas) cadastrados — para os seletores
// da tela da oportunidade. Sem o board configurado devolve `configurado:false`
// e a lista do que falta (a tela mostra o aviso; nada é gravado).
export async function GET() {
  try {
    const st = estruturaV2Status();
    if (!EMPRESAS_BOARD_ID) {
      return NextResponse.json({ configurado: false, faltando: st.empresas.faltando, empresas: [], contatos: [] });
    }
    const [empresas, contatos] = await Promise.all([listarEmpresas(), listarContatos()]);
    return NextResponse.json({ configurado: st.empresas.pronto, faltando: st.empresas.faltando, empresas, contatos });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Cadastrar empresa. NÃO exige CNPJ. Nome igual (após normalizar) ou CNPJ já
// cadastrado → 409 com as existentes: quem decide é a pessoa (usar a existente
// ou `force:true` para criar mesmo assim). Isso também barra duplo clique.
export async function POST(request) {
  try {
    if (!EMPRESAS_BOARD_ID) {
      return NextResponse.json({ error: 'O board "Empresas" ainda não foi configurado neste ambiente (MONDAY_EMPRESAS_BOARD_ID). Veja o README.' }, { status: 409 });
    }
    const body = await request.json();
    const nome = String(body.nome || '').replace(/\s+/g, ' ').trim();
    if (!nome) return NextResponse.json({ error: 'Informe o nome da empresa.' }, { status: 400 });
    if (nome.length > 120) return NextResponse.json({ error: 'O nome da empresa pode ter no máximo 120 caracteres.' }, { status: 400 });
    const cnpjTxt = String(body.cnpj || '').trim();
    if (cnpjTxt && !normalizarCnpj(cnpjTxt)) {
      return NextResponse.json({ error: 'CNPJ inválido: informe 14 dígitos ou deixe em branco (não é obrigatório).' }, { status: 400 });
    }
    const existentes = await listarEmpresas();
    const norm = normalizarNomeEmpresa(nome);
    const cnpjN = normalizarCnpj(cnpjTxt);
    const iguais = existentes.filter(
      (e) => (norm && normalizarNomeEmpresa(e.nome) === norm) || (cnpjN && normalizarCnpj(e.cnpj) === cnpjN)
    );
    if (iguais.length && body.force !== true) {
      return NextResponse.json(
        { duplicada: true, existentes: iguais, error: 'Já existe empresa com este nome ou CNPJ. Use a existente ou confirme para criar outra mesmo assim.' },
        { status: 409 }
      );
    }
    const colunas = {};
    if (cnpjTxt && EMPRESAS_COLUMNS.cnpj) colunas[EMPRESAS_COLUMNS.cnpj] = cnpjTxt;
    const cidade = String(body.cidade || '').trim().slice(0, 60);
    if (cidade && EMPRESAS_COLUMNS.cidade) colunas[EMPRESAS_COLUMNS.cidade] = cidade;
    const criado = await createLead(EMPRESAS_BOARD_ID, null, nome, Object.keys(colunas).length ? colunas : null);
    return NextResponse.json({ empresa: { id: String(criado.id), nome, cnpj: cnpjTxt || null, cidade: cidade || null } });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
