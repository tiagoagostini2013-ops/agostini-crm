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
exec npx next start -p "${1:-3100}"
