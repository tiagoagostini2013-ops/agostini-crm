#!/usr/bin/env bash
# Sobe o app (já compilado com `npm run build`) apontando para o monday SIMULADO.
# Nada aqui toca o monday real: MONDAY_API_URL aponta pro mock local.
export MONDAY_API_URL=http://localhost:4010/v2
export MONDAY_API_TOKEN=token-de-teste
export SESSION_SECRET=segredo-de-teste
export MONDAY_COL_PRAZO_COMPRA=date_test_prazo
export MONDAY_COL_DATA_REATIVACAO=date_test_reativ
export MONDAY_COL_PROX_CONTATO_POSVENDA=date_test_posv
export MONDAY_COL_IMPEDIMENTO=text_test_imped
export MONDAY_COL_PLANO_ACAO=long_text_test_plano
# SEM_CONFIG_AUTOMACAO=1 sobe sem o item de configuração (tela de configuração somente leitura).
[ "${SEM_CONFIG_AUTOMACAO:-0}" = "1" ] || export MONDAY_AUTOMACAO_SETTINGS_ITEM_ID=5100
# V2=0 sobe o app SEM a estrutura v2 (modo compatível) para testar o aviso de "estrutura pendente".
if [ "${V2:-1}" = "1" ]; then
  export MONDAY_COL_EMPRESA_ID=text_test_empresaid
  export MONDAY_COL_OPORTUNIDADE=long_text_test_opp
  export MONDAY_COL_PROPOSTAS_REGISTRO=long_text_test_propreg
  export MONDAY_EMPRESAS_BOARD_ID=18500000001
  export MONDAY_EMPRESAS_COL_CNPJ=text_test_emp_cnpj
  export MONDAY_EMPRESAS_COL_CIDADE=text_test_emp_cidade
  export MONDAY_CONTATOS_BOARD_ID=18500000002
  export MONDAY_CONTATOS_COL_TELEFONE=text_test_ct_tel
  export MONDAY_CONTATOS_COL_EMAIL=text_test_ct_email
  export MONDAY_CONTATOS_COL_PAPEL=text_test_ct_papel
  export MONDAY_CONTATOS_COL_EMPRESA_ID=text_test_ct_emp
fi
exec npx next start -p "${1:-3100}"
