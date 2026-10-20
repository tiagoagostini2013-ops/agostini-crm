# CRM Agostini — Painel

Uma página própria para visualizar e trabalhar o funil de vendas da Agostini, usando o **board "CRM Agostini" no monday.com como banco de dados** (via API oficial). Kanban por estágio (arraste os cards), checklist de qualificação, anotações por lead, agenda de follow-ups, painel de métricas e login individual — tudo lendo e escrevendo direto no monday.com, então nada muda para quem continua usando o monday.com normalmente (inclusive a extensão do Chrome que já preenche o CRM a partir do sistema de atendimento continua funcionando exatamente igual).

## Como funciona por trás

- **Next.js** — um único projeto que serve tanto a página (React) quanto um pequeno backend (rotas de API) que fala com o monday.com.
- O **token de API do monday.com fica só no servidor** (variável de ambiente), nunca é enviado ao navegador. O navegador conversa só com o seu próprio backend, que por sua vez conversa com `api.monday.com`.
- **Login individual por pessoa** (nome + senha) — as contas ficam guardadas num segundo board, separado do funil: "CRM Agostini - Usuários do Painel" (privado, só para a página usar; não mexer nele direto no monday.com). Na primeira vez que alguém abrir o link publicado, a tela pede pra criar a conta do administrador; depois disso, esse administrador cadastra o resto do time em **Gerenciar usuários** (link que só aparece pra quem é admin). É identificação, não controle de acesso por lead: todo mundo continua vendo e editando qualquer lead, como sempre — só que agora dá pra saber quem fez o quê, porque cada anotação nova já sai com o nome de quem escreveu.
- O Kanban usa a coluna real **"Estágio de Vendas"** do board (Lead → Qualificado → Proposta Enviada → Em Negociação → Fechado → Perdido). Os "grupos" do board (Leads, Qualificados, ...) não são alterados — só a coluna de status.

## Passo a passo para colocar no ar

### 1. Gerar um token de API do monday.com

1. No monday.com, clique na sua foto de perfil (canto inferior esquerdo) → **Developers** (ou, em contas admin, **Administração → API**).
2. Gere um **token pessoal de API**. Guarde-o — ele não é mostrado de novo depois.
3. Esse token herda as mesmas permissões da conta que o gerou. Recomendo gerar a partir de uma conta que tenha acesso de edição ao board CRM Agostini (a sua ou a da Raíssa, por exemplo), não uma conta genérica.

### 2. Subir o código para o GitHub

Se quiser, eu ajudo a criar o repositório. O caminho mais simples:

```bash
cd agostini-crm
git init
git add .
git commit -m "Painel CRM Agostini"
```

Depois crie um repositório vazio no GitHub e siga as instruções que ele mostra para "push an existing repository".

### 3. Deploy na Vercel (gratuito para esse uso)

1. Crie uma conta em [vercel.com](https://vercel.com) (dá para entrar direto com o GitHub).
2. "Add New Project" → selecione o repositório que você acabou de subir.
3. Na tela de configuração, adicione as variáveis de ambiente (**Environment Variables**):

   | Nome | Valor |
   |---|---|
   | `MONDAY_API_TOKEN` | o token gerado no passo 1 |
   | `MONDAY_BOARD_ID` | `18404435549` (já é o board CRM Agostini) |
   | `SESSION_SECRET` | uma string aleatória longa — gere uma com `openssl rand -hex 32` no terminal, ou peça pra mim |
   | `MONDAY_API_VERSION` | deixe em branco (opcional) |

4. Clique em **Deploy**. Em ~1 minuto a Vercel te dá uma URL tipo `agostini-crm.vercel.app`.
5. Abra a URL. Como é a primeira vez, ela vai pedir pra você criar a conta do administrador (seu nome + uma senha) — depois disso, use **Gerenciar usuários** (no topo da tela) pra cadastrar o resto do time.

> A variável `APP_PASSWORD` da v1 (senha única compartilhada) não é mais usada — pode remover das Environment Variables da Vercel se ela ainda estiver lá.

Qualquer atualização que eu (ou vocês) fizer no código depois, basta subir pro GitHub de novo — a Vercel republica sozinha.

## Segurança — pontos importantes

- **As anotações/alterações no monday.com sempre aparecem como vindas da conta dona do `MONDAY_API_TOKEN`** (a sua ou a da Raíssa) — o monday.com não sabe distinguir qual pessoa usou o painel. Por isso o texto de cada anotação nova já vem com o nome de quem escreveu (ex: "Vendedor principal: cliente pediu desconto...").
- **As senhas de cada pessoa ficam com hash (bcrypt)** no board de usuários — nunca em texto puro, nem no monday.com nem em variável de ambiente.
- Para desativar o acesso de alguém (ex: saiu do time), vá em **Gerenciar usuários** e desmarque "Ativo" — não precisa apagar a conta, e dá pra reativar depois se precisar.
- **Nunca comite o arquivo `.env` ou `.env.local`** — ele já está no `.gitignore`, mas vale conferir antes de cada `git add`.
- Para revogar o acesso de todo mundo de uma vez (ex: emergência), troque `SESSION_SECRET` na Vercel e faça um redeploy — isso invalida todas as sessões abertas.
- Rode `npm audit` de vez em quando e atualize dependências. Na auditoria feita ao montar este projeto (ago/2026), a única pendência era um alerta do Next.js ligado a "Server Actions" — um recurso que este projeto não usa (aqui só usamos rotas de API comuns), então o risco prático é baixo, mas manter atualizado é sempre mais seguro.

## Mapa de campos (para manutenção futura)

O arquivo `lib/config.js` é a única fonte de verdade que liga os campos da página às colunas reais do board. Se alguém renomear ou adicionar uma coluna no monday.com, ajuste os IDs ali (não em vários lugares do código).

| Campo na página | Coluna no monday.com | Tipo |
|---|---|---|
| Estágio de vendas | `Estágio de Vendas` | status |
| Responsável | `Pessoas` | pessoas |
| Empresa | `Empresa` | texto |
| Telefone | `Telefone` | texto |
| WhatsApp | `WhatsApp` | link (preenchido pela extensão) |
| Produto/aplicação de interesse | `Produto/Serviço de Interesse` | texto |
| Segmento | `Segmento` | status |
| Cargo do decisor | `Cargo do Decisor` | status |
| Canal de origem | `Canal de Origem` | status |
| Valor estimado | `Valor Estimado` | número |
| Motivo de perda | `Motivo de Perda` | status |
| Último contato / Próximo follow-up | `Data Último Contato` / `Data Próximo Follow-up` | data |
| Prazo de compra, reativação, pós-venda, impedimento, plano de ação | colunas novas — ver seção "Agenda por trilha" abaixo | data / texto / texto longo |

As listas de opções (segmentos, cargos, canais, motivos de perda) estão hoje fixas em `lib/config.js`, copiadas das opções reais do board. Se vocês criarem um novo segmento ou motivo de perda no monday, adicione a mesma opção nesse arquivo para ela aparecer nos formulários e filtros da página.

## O que o painel faz hoje

- Kanban arrastável por estágio de vendas (arrastar um card já atualiza o monday.com).
- Painel lateral por lead: dados de contato, checklist de qualificação (5 critérios, com botão de "marcar como Qualificado" quando 4+ estão preenchidos), edição de todos os campos, anotações (viram "updates" no próprio item do monday, visíveis também por lá, já identificadas com o nome de quem escreveu).
- Formulário de criação de lead direto pela tela ("+ Novo lead"), sem precisar abrir o monday.com.
- Painel de métricas: total de leads, taxa de conversão, ticket médio, motivo de perda mais comum, funil por estágio e ranking por responsável.
- Agenda de follow-ups: atrasados, hoje, próximos 7 dias e leads sem follow-up agendado — com um banner de aviso no Kanban quando há pendências.
- Login individual por pessoa, com uma tela de administração para cadastrar/desativar usuários e redefinir senhas.
- Cada conta do painel pode ser vinculada à pessoa correspondente no monday.com ("Gerenciar usuários" → coluna "Vendedor no monday.com") — só quem está vinculado aparece no filtro de "responsável" e pode ser escolhido ao criar/editar um lead, então gente de outros setores (PCP, almoxarifado, técnicos etc.) não polui mais essas listas. Leads antigos que já estavam com alguém de fora atribuído continuam mostrando o nome certo, só não dá mais pra escolher essa pessoa daqui pra frente.
- Filtros por responsável, segmento e canal de origem, mais busca por nome/empresa/telefone.
- Aviso visual quando um lead está há mais de 5 dias sem contato.
- Link direto para abrir o item correspondente no monday.com.
- Anexar e remover arquivos de um lead direto no painel (card do lead → aba/seção "Arquivos" → **"+ Adicionar arquivo"**): proposta, orçamento de frete, layout do cliente, foto, planilha — qualquer tipo. Cada arquivo mostrado tem um botão de remover (🗑️), para o caso de ter sido anexado por engano; a remoção pede confirmação e não pode ser desfeita. Usa a mesma coluna **"Propostas"** do monday.com por trás (por isso ela também aparece com esse nome se você abrir o lead direto no monday.com) — e o mesmo mecanismo de upload direto pro Vercel Blob descrito na seção do suplemento do Word abaixo, então precisa do mesmo `BLOB_READ_WRITE_TOKEN` configurado.

## Agenda por trilha, prioridades e próxima ação (v1, out/2026)

**Três trilhas**, derivadas do estágio do lead — cada uma com a sua data e as suas regras de alerta:

| Trilha | Estágios | Data usada | Gera alerta? |
|---|---|---|---|
| Vendas ativas | Lead, Qualificado, Proposta Enviada, Em Negociação | `Data Próximo Follow-up` (já existia) | Sim: follow-up vencido e "sem data" |
| Reativação | Perdido | `Data de Reativação` (nova) | Só na aba Reativação (nunca no banner de follow-up vencido). O follow-up antigo de perdidos continua guardado e aparece numa seção recolhida "legado". |
| Pós-venda | Fechado | `Próximo Contato Pós-venda` (nova) | Sim, só pós-venda atrasado |

Os contadores (selo da aba Agenda, banner do Kanban) e as listagens usam os mesmos filtros da tela e dizem o escopo: "equipe inteira" ou o nome do usuário filtrado. Nenhum dado é excluído.

**Minhas prioridades de hoje** (topo da aba Agenda › Vendas ativas): lista objetiva, com o motivo de cada item e o que está "não informado". Os pesos ficam em `lib/prioridades.js` (`PESOS`) e também aparecem na própria tela, em "Como esta lista é montada". Compromisso combinado com o cliente pesa mais que o valor do negócio. Campo ausente conta 0 ponto — nada é inventado.

**Próxima ação**: toda oportunidade ativa deve ter ação concreta + responsável + data. Registros antigos incompletos são sinalizados (cartão e painel do lead), sem impedir consulta ou edição. "✅ Registrar atividade realizada" pede canal, se houve **contato efetivo com o cliente**, resultado e próximo passo. Só atividade com contato efetivo (ou anotação marcada como contato) atualiza "Último contato"; editar o cadastro não conta.

**Qualificação**: "Prazo previsto de compra" (novo) é separado da data do próximo follow-up. Necessidade, decisor, investimento estimado e principal impedimento aproveitam os campos existentes (o impedimento é novo) e aparecem num resumo no painel do lead; o cartão mostra só compra prevista e impedimento.

### Onde cada dado novo fica guardado (e como evita sobrescritas)

| Dado | Armazenamento | Observação |
|---|---|---|
| Prazo previsto de compra | coluna `Prazo Previsto de Compra` (data) | env `MONDAY_COL_PRAZO_COMPRA` |
| Data de reativação | coluna `Data de Reativação` (data) | env `MONDAY_COL_DATA_REATIVACAO` |
| Próximo contato pós-venda | coluna `Próximo Contato Pós-venda` (data) | env `MONDAY_COL_PROX_CONTATO_POSVENDA` |
| Principal impedimento | coluna `Principal Impedimento` (texto) | env `MONDAY_COL_IMPEDIMENTO` |
| Ação concreta, responsável, "combinado com o cliente", último resultado | coluna `Plano de Ação (JSON)` (texto longo) | env `MONDAY_COL_PLANO_ACAO`; escrito só pelas rotas `/api/items/[id]/proxima-acao` e `/atividades`, nunca pelo PATCH genérico |
| Histórico completo de atividades | "updates" do item (mesma lista das Anotações) | o JSON guarda só o último resultado |

Conflitos: o plano tem uma revisão por trilha; a rota lê → altera → grava e responde 409 se outra pessoa mudou a mesma trilha entretanto (a tela oferece "usar o valor atual"). Textos são truncados para caber no limite do monday.

### Criar as colunas novas (uma vez por quadro)

Nada é criado automaticamente. Enquanto as variáveis `MONDAY_COL_*` não existirem o CRM roda em **modo compatível** (avisa no painel do lead; só a data de follow-up de vendas é editável). Para criar:

```
MONDAY_API_TOKEN=... MONDAY_BOARD_ID=18404435549 node --no-warnings scripts/criar-colunas-monday.mjs          # só mostra o que faria
MONDAY_API_TOKEN=... MONDAY_BOARD_ID=18404435549 node --no-warnings scripts/criar-colunas-monday.mjs --criar  # cria o que falta
```

O script é idempotente (reaproveita coluna com mesmo título e tipo), não altera colunas nem dados existentes e imprime as linhas `MONDAY_COL_*` para colar na Vercel (depois, redeploy).

### Testes

- `npm test` — testes unitários das regras (trilhas, alertas, prioridades, plano de ação), com dados fictícios.
- Teste ponta a ponta contra um monday **simulado** (nunca toca o monday real): `npm run build`, depois `node tests/e2e/mock-monday.mjs 4010 &`, `bash tests/e2e/start-app.sh 3100 &` e `python3 tests/e2e/run_e2e.py <token-de-sessão> <pasta-de-prints>` (requer Playwright; o token é um cookie de sessão assinado com `SESSION_SECRET=segredo-de-teste`, ver cabeçalho do script).

## Atendimento e gestão de oportunidades (v2, out/2026)

> Status: implementado na branch `feature/atendimento-oportunidades-v2`, testado só contra um monday **simulado** com dados fictícios. **Não publicado** e **nenhuma coluna/quadro criado no monday real.** A tela funciona em "modo compatível" enquanto a estrutura nova não existir (avisos aparecem no painel do lead).

### O que mudou para o vendedor

- **Painel do lead = tela da oportunidade.** O topo mostra, sem repetir campos: cliente e assunto, estágio, responsável principal (+ participantes), valor, próxima ação (responsável e data), prazo de compra, impedimento, último contato **efetivo**, última atividade e proposta vigente. Tudo vem de dados registrados; o que falta aparece como "não informado" (não há texto gerado por IA). Ações rápidas: Abrir WhatsApp, Registrar atendimento, Agendar próximo passo, Abrir proposta vigente, Histórico completo. Seções secundárias (rastreio de propostas, segmento/cargo/canal, tipo de contato) ficam recolhidas; "Salvar alterações" fica fixo no rodapé.
- **Empresa × Contatos × Oportunidades.** Uma empresa pode ter várias oportunidades independentes (máquina, formas…) e vários contatos; cada oportunidade escolhe quais contatos participam. Contato sem empresa e lead sem empresa identificada são permitidos; CNPJ e e-mail são opcionais.
- **Histórico único e cronológico** (anotações, atendimentos, tentativas, propostas e revisões, mudanças de estágio, vínculos de empresa). Cada evento mostra tipo, data, autor e conteúdo, e é classificado como *contato efetivo*, *tentativa*, *registro interno*, *não classificado* ou *sistema*.
- **Propostas.** Os arquivos anexados continuam na coluna de arquivos; o registro só os **classifica** (número, revisão, situação rascunho/enviada/substituída/aceita, qual é a referência comercial vigente). DOCX+PDF de mesmo nome = o mesmo documento; revisão ≠ alternativa técnica; valores nunca são somados nem copiados para a oportunidade; possível duplicata é só sinalizada (nada é excluído); aceite só por confirmação manual, e visualização do link é sempre "estimada".
- **Registrar atendimento** (reaproveita o formulário de atividade): tipo, resultado, contato efetivo × tentativa, e (opcional) próximo passo. Concluir a ação planejada fica registrado no histórico; sem próximo passo o lead fica marcado como **pendente**. Datas usam dias úteis (com feriados nacionais) e **nunca sobrescrevem um retorno combinado com o cliente** sem confirmação.

Regra de ouro do "último contato efetivo": só um atendimento registrado como contato efetivo (ou anotação marcada como contato) atualiza essa data. **Edição cadastral, abrir WhatsApp, ver proposta e tentativa sem resposta não atualizam.**

### Onde cada informação é guardada (fonte única de verdade)

| Informação | Fonte da verdade | Observação |
|---|---|---|
| Oportunidade | item do quadro do CRM (o mesmo de sempre; IDs, arquivos, histórico e links preservados) | nada migrado |
| Assunto + contatos da oportunidade | coluna `Oportunidade (JSON)` (texto longo, compacto, com revisão) | `MONDAY_COL_OPORTUNIDADE` |
| Vínculo oportunidade → empresa | coluna `Empresa ID` (texto; guarda só o id) | `MONDAY_COL_EMPRESA_ID`; o texto antigo da empresa é preservado |
| Empresa (nome, CNPJ, cidade) | quadro **CRM Agostini - Empresas**, 1 item por empresa | `MONDAY_EMPRESAS_BOARD_ID`, `MONDAY_EMPRESAS_COL_CNPJ`, `MONDAY_EMPRESAS_COL_CIDADE` |
| Contato (nome, telefone, e-mail, papel, empresa) | quadro **CRM Agostini - Contatos**, 1 item por contato | `MONDAY_CONTATOS_BOARD_ID`, `MONDAY_CONTATOS_COL_TELEFONE`, `_EMAIL`, `_PAPEL`, `_EMPRESA_ID` |
| Classificação de propostas | coluna `Propostas — Registro (JSON)` | `MONDAY_COL_PROPOSTAS_REGISTRO`; os arquivos continuam na coluna de arquivos |
| Histórico | *updates* do item no monday + datas de estágio + rastreio (derivado, não duplicado) | nenhuma coluna nova |
| Responsável principal / participantes | coluna de pessoas existente: o 1º é o principal, os demais participam | nenhuma coluna nova |
| Próxima ação, prazo, impedimento, reativação, pós-venda | colunas da v1 | sem duplicar |

Quando uma oportunidade é vinculada a uma empresa/contato, **só o id** é gravado — telefone, nome etc. não são copiados (sem sincronização circular). Os contatos antigos (JSON legado no lead) continuam visíveis enquanto o quadro de Contatos não estiver configurado.

### Variáveis de ambiente novas (Vercel → Settings → Environment Variables)

| Variável | Para quê | Sem ela |
|---|---|---|
| `MONDAY_COL_EMPRESA_ID` | vínculo oportunidade → empresa | vínculo desativado (aviso) |
| `MONDAY_COL_OPORTUNIDADE` | assunto + contatos da oportunidade | nome da oportunidade não salva (aviso) |
| `MONDAY_COL_PROPOSTAS_REGISTRO` | classificação/vigência de propostas | arquivos listados sem classificação (aviso) |
| `MONDAY_EMPRESAS_BOARD_ID`, `MONDAY_EMPRESAS_COL_CNPJ`, `MONDAY_EMPRESAS_COL_CIDADE` | quadro de empresas | campo "empresa" segue em texto livre |
| `MONDAY_CONTATOS_BOARD_ID`, `MONDAY_CONTATOS_COL_TELEFONE`, `MONDAY_CONTATOS_COL_EMAIL`, `MONDAY_CONTATOS_COL_PAPEL`, `MONDAY_CONTATOS_COL_EMPRESA_ID` | quadro de contatos | editor antigo de "Contatos e papéis" continua |

Todas as credenciais continuam só no servidor (`MONDAY_API_TOKEN`, `SESSION_SECRET`); nada novo vai para o navegador. As rotas novas respeitam a sessão (e `requireAdmin` nas de sugestões de vínculo).

### Criar a estrutura no monday (uma vez; só depois do OK)

Nomes usados: quadros **CRM Agostini - Empresas** e **CRM Agostini - Contatos** (o quadro antigo "Contatos" da equipe é outro assunto e nunca é reaproveitado). Depois de configurar as variáveis, `scripts/validar-estrutura-oportunidades.mjs` (somente leitura) confere se cada variável aponta para uma coluna existente do tipo certo.

```
MONDAY_API_TOKEN=... MONDAY_BOARD_ID=18404435549 node --no-warnings scripts/criar-estrutura-oportunidades.mjs          # só mostra o que faria
MONDAY_API_TOKEN=... MONDAY_BOARD_ID=18404435549 node --no-warnings scripts/criar-estrutura-oportunidades.mjs --criar  # cria o que falta
```

Idempotente (reaproveita pelo título/tipo; aceita quadros já existentes via `MONDAY_EMPRESAS_BOARD_ID`/`MONDAY_CONTATOS_BOARD_ID`), não altera nem apaga nada e imprime as linhas de variáveis para colar na Vercel (depois, redeploy). **Recuperação:** se uma coluna for apagada ou trocada de tipo no monday, o painel avisa o que falta (`/api/meta` → `estruturaV2`) e volta ao modo compatível; rode o script de novo para recriar e atualize as variáveis.

### Simulação de vínculos (somente leitura) antes de qualquer migração

```
MONDAY_API_TOKEN=... MONDAY_BOARD_ID=18404435549 node --no-warnings scripts/simular-vinculos-empresas.mjs [--json]
```

Lista (sem gravar nada): leads já vinculados, só com texto, sem empresa; vínculos **sugeridos** lead → empresa existente (confiança alta = mesmo nome normalizado; média = nomes parecidos, ignorando palavras genéricas do ramo como "pré-moldados", "artefatos" e "cimento", para não sugerir empresas diferentes só por serem do mesmo ramo); grupos de leads com o **mesmo** nome de empresa que poderiam virar uma empresa nova; contatos do formato antigo que seriam trazidos. Nomes apenas parecidos **nunca** são agrupados automaticamente. A mesma simulação existe em `GET /api/vinculos/sugestoes` (admin).

### Plano de migração e reversão (não executado)

1. Rodar `criar-estrutura-oportunidades.mjs` em dry-run e, com OK, `--criar`; configurar as variáveis na Vercel de **preview**, testar; só então produção. (Aditivo: nenhuma coluna ou dado existente muda.)
2. Rodar a simulação e revisar a lista com a equipe comercial.
3. Vincular **item a item pela tela** (botão "Confirmar vínculo"), ou, se preferirem em lote, aprovar uma lista específica de ids — nunca por nome parecido. Cada vínculo grava só o `Empresa ID` e uma nota "🏢 … Ref:" no histórico.
4. Não há migração em massa de dados de produção: oportunidades, arquivos, IDs e histórico ficam onde estão.

**Reversão:** (a) redeploy da versão anterior na Vercel (a v1 ignora as colunas novas); ou (b) remover as variáveis novas → o CRM volta ao modo compatível; as colunas/quadros novos podem ficar (inofensivos) ou ser apagados manualmente no monday. As notas "📑/🏢 … Ref:" já gravadas permanecem como histórico (o app nunca exclui updates).

### Confiabilidade, conflitos e limites

- **Falha do monday nunca vira "sucesso":** se a gravação principal falha a tela mostra o erro e preserva o que foi digitado; se só a nota de histórico falha, o painel diz que o dado foi salvo mas a nota não.
- **Duplo clique / reenvio:** cada gravação carrega um `requestId` registrado no histórico como `Ref:`; repetir devolve o resultado já gravado, sem duplicar (há também trava local no servidor).
- **Edição concorrente:** oportunidade, plano de ação e registro de propostas têm `rev` (409 com opção de usar o valor atual); empresas e contatos comparam o valor-base de cada campo editado.
- **Limite do monday:** texto longo corta silenciosamente em **2.000 caracteres**. Os JSONs novos são compactos (limite interno 1.900) e, se algo vier ilegível/truncado, o app mostra aviso e **não regrava por cima**. Já existe um caso real (rastreio truncado no item 13021330142) — ver "Pendências".
- **Horário:** "hoje", dias úteis e "quando aconteceu" usam America/Sao_Paulo (UTC-3 fixo; sem horário de verão desde 2019).
- **Autor:** o monday registra todo *update* como do dono do token; por isso o autor vem do texto gravado ("— registrado por Fulano") e só é exibido quando bate com um usuário conhecido. Notas antigas sem autor não ganham autor inventado.

### Testes da v2

- `npm test` — 55 testes unitários (tempo/dias úteis, histórico, empresas/contatos, propostas, agenda, prioridades).
- `tests/e2e/api_v2.py <token>` — 70 verificações de API contra o monday simulado (empresa com 2 contatos e 2 oportunidades independentes, lead sem empresa, histórico sem duplicidade, proposta vigente após recarregar, revisão sem herdar valor, tentativa não atualiza contato efetivo, duplo clique, conflitos, falha de gravação, sugestões somente leitura…).
- `tests/e2e/run_e2e.py <token> <pasta>` — 88 verificações no navegador (Playwright), incluindo a tela da oportunidade, histórico, propostas, WhatsApp sem efeito, falha de sincronização e filtros.
- Token de teste: `node tests/e2e/gerar-token.mjs > /tmp/token.txt`. Para ver o modo compatível: `V2=0 bash tests/e2e/start-app.sh 3101`.

### Pendências e limitações conhecidas da v2

- Estrutura nova **não existe** no monday real; scripts testados só no simulado. Nada foi validado contra o monday real.
- Anotação livre com "Foi um contato com o cliente" marcado (padrão antigo) ainda carimba o último contato; no histórico ela aparece como "contato não classificado". Para contato de verdade, o caminho recomendado é "Registrar atendimento".
- Escritores antigos do rastreio de propostas (`parseTrackingList`) devolvem lista vazia se o JSON estiver corrompido e poderiam sobrescrever; não foi alterado nesta etapa (a v2 só lê de forma tolerante).
- Proteção contra duplo clique entre instâncias da Vercel depende da consulta ao `Ref:` nas últimas 40 atualizações do item (mais a trava em memória por instância).
- Feriados estaduais/municipais não entram no cálculo de dias úteis (`FERIADOS_EXTRAS` em `lib/tempo.js`).

## Automação do acompanhamento comercial (v3, out/2026) — modo sugestão

**O que é.** O CRM passa a *sugerir* próximos passos internos (tarefas na agenda existente) a partir de eventos que já
existem. **Não envia nada ao cliente** (nem mensagem, e-mail ou WhatsApp) e **não cria tarefa antes de alguém aceitar**.
Não há segunda agenda nem segundo sistema de tarefas: aceitar grava a ação no mesmo plano de ação que a Agenda já lê.

### Regras (gatilhos reais)

| Regra | Gatilho (dado que já existe) | Sugestão |
|---|---|---|
| A — Follow-up de proposta | proposta com **envio registrado de forma explícita** (botão "Registrar envio", situação *enviada* + data do envio) e sem contato efetivo depois | ação na trilha de vendas, **próximo dia útil às 09:00** (horário é lembrete interno) |
| B — Tentativa sem resposta | último registro de atendimento = *tentativa sem resposta* (canal ≠ interno) | nova tentativa **7 dias corridos** depois; se cair em dia não útil, próximo dia útil |
| C — Compromisso combinado | ação marcada "combinada com o cliente" | nada a sugerir: é a **garantia** das demais (nunca substituída em silêncio; só com confirmação) e gera aviso se a data cair em dia não útil |
| D — Oportunidade parada | ativa sem próxima ação (ação+data) **ou** sem contato efetivo há ≥ N dias (padrão 7, ajustável) | *destaque* (sem ação proposta); uma pendência por oportunidade; retorno futuro combinado e ação já vencida não entram |
| E — Compra em 30 dias | "Prazo previsto de compra" entre hoje e +30 dias | *destaque* com impedimento e próxima ação existente; sem próximo passo → pede ao responsável definir (o prazo **não** substitui o follow-up) |
| F — Venda fechada | estágio Fechado sem ação de pós-venda | pendência na trilha de pós-venda ("definir responsável e registrar compromissos comerciais"); **não** marca entrega nem mexe no fluxo de handoff/entrega |

Perdida: nenhuma sugestão de prospecção. Fechada: encerra A/B/D/E. Quando A e B coincidem vale o evento mais recente.
Cada sugestão mostra justificativa curta, a **data do evento**, a **data programada** e a **origem**: *Planejada manualmente /
Combinada com o cliente / Sugerida por regra / Criada a partir de sugestão aceita*. **Aceitar ≠ realizar**: a ação só conta
como feita pelo registro do atendimento.

### Como funciona (e o que NÃO faz)

- **Cálculo no servidor, sem depender da página aberta.** As sugestões são *derivadas* a cada consulta (`GET /api/automacao/sugestoes`)
  do plano de ação, do registro de propostas e do último contato. Não há tarefa agendada (cron): **nenhuma notificação/lembrete é
  disparado sozinho** — o vendedor vê as sugestões ao abrir a Agenda/oportunidade. Hospedagem: funciona na Vercel sem configuração extra.
- **Só a decisão é gravada**: aceitas/dispensadas ficam numa lista compacta (`sg`, até 10) dentro do JSON "Plano de Ação" — sem coluna nova.
  A mesma `chave` (regra + evento) nunca reaparece depois de aceita ou dispensada; **novo evento relevante = nova chave = nova sugestão**.
- **Antes de aceitar**, o servidor relê o lead e recalcula: sugestão obsoleta → 409 "obsoleta"; ação criada/alterada desde a geração → 409 "estagnada";
  ação existente / compromisso do cliente / dia não útil → exige confirmação explícita. Falha no monday = erro (`gravado:false`), sem falso sucesso.
  `requestId` vira "Ref:" no histórico (repetição/duplo clique é ignorada). Autor = usuário da sessão.
- **Escopo**: administrador vê tudo (filtro por responsável); os demais, só suas oportunidades; usuário sem vínculo com o monday não vê nem decide.
- **Eventos antigos** (fora da janela, padrão 30 dias) **não** viram sugestões: ficam na "Análise prévia", que só lista com um responsável escolhido e sem ação em massa.
- **Horário**: o monday guarda só a data. O horário (ex.: 09:00) fica no JSON do plano e a tela o chama de *lembrete interno*.
- **Dias úteis**: America/Sao_Paulo; sábado/domingo e feriados nacionais (Carnaval, Sexta Santa, Corpus Christi incluídos) em `lib/tempo.js`;
  feriados estaduais/municipais/pontes são cadastrados pelo administrador (Gerencial → Configurações) — também valem no registro de atendimento.
- **Envio de proposta**: só conta o registro explícito (Propostas → "Registrar envio" ou situação *enviada* com a data do envio). Anexar arquivo,
  gerar PDF, editar e o cliente abrir o link **não** são envio. Propostas já marcadas como enviadas sem data ficam fora (aparecem como "sem data do envio").

### Visão semanal do gestor (Gerencial, só admin)
Ativas sem próxima ação · compromissos vencidos · propostas sem avanço · compras previstas 30/60 dias · passagens de pós-venda pendentes, com filtro por
responsável, abrir oportunidade e o **critério escrito** em cada lista. "Sem registro" não prova "sem atendimento".

### Configuração (hospedagem e monday)
| O quê | Onde | Observação |
|---|---|---|
| `MONDAY_AUTOMACAO_SETTINGS_ITEM_ID` | Vercel → Environment Variables | id do item de configuração (criado por `scripts/criar-item-config-automacao.mjs --criar`, dry-run por padrão; **só depois do seu OK** — cria 1 item no quadro Configurações, nenhuma coluna). Sem ela: padrões e tela somente leitura |
| `AUTOMACAO_DESATIVADA=1` | Vercel | chave de emergência: desliga todas as regras sem mexer em dados |
| colunas do plano/data, `MONDAY_COL_PROPOSTAS_REGISTRO` | já existentes (v1/v2) | A depende do registro de propostas (v2); D/E/F/B funcionam só com a v1 |

### Como desativar sem perder histórico
Gerencial → *Automação do acompanhamento — configurações*: desligar a regra ou a automação inteira (ou `AUTOMACAO_DESATIVADA=1`). Ações aceitas, dispensas e notas
do histórico permanecem. Reverter a versão: redeploy do commit anterior (o JSON do plano ganhou campos opcionais que a versão antiga simplesmente ignora).

### Testes da v3
`npm test` (74) · `python3 tests/e2e/api_v3.py <token>` (86, monday simulado) · `python3 tests/e2e/run_e2e_v3.py <token> <pasta>` (34, navegador).
Tudo contra o **monday simulado** com dados fictícios (`/__seed` do mock cria leads de teste); nada foi testado contra o monday real nem contra a Vercel.

### Limitações conhecidas
- Sem lembretes ativos (push/e-mail/WhatsApp interno) — exigiria agendador (cron) e canal de notificação.
- Dispensar/aceitar regrava o JSON do plano (leitura→gravação); duas pessoas decidindo no mesmo milissegundo podem sobrescrever uma à outra — a checagem por revisão cobre a ação, não a lista `sg`.
- O registro de propostas ganhou +~17 caracteres por proposta (data do envio); o teto de 1.900 do monday continua valendo (12 propostas).
- "Data de registro" do envio é a da última atualização do registro de propostas (e do update no histórico), não um campo próprio.
- Em produção há muitas oportunidades ativas sem próxima ação: a regra D lista as recentes (30 dias) e manda as demais para a análise prévia.

## Suplemento do Word (buscar cliente + vincular proposta)

Como a Agostini vende de tudo, de um equipamento avulso até uma planta inteira, não existe um modelo fixo de proposta — então em vez de "gerar a proposta pronta", o suplemento dá ao vendedor uma ponte para o CRM dentro do próprio Word: buscar o cliente/lead pelo nome, inserir dados dele (empresa, produto, valor etc.) no texto onde o cursor estiver, e — quando a proposta estiver pronta — vincular o `.docx` ao lead certo no monday.com com um clique. (Só o Word mesmo — a geração automática de PDF foi removida de propósito para simplificar o fluxo; se precisar do PDF, gere direto no Word com "Salvar como" e anexe pelo painel principal, ver seção abaixo.)

### Como funciona por trás

- É uma página a mais dentro deste mesmo projeto Next.js (`/word-addin`), carregada dentro de um painel lateral do Word (Office Add-in / suplemento). Usa o **mesmo login individual** do painel — na primeira vez que o suplemento abrir, ele pede pra entrar com nome + senha, igual ao painel principal; depois disso, fica logado nesse computador.
- O arquivo do Word finalizado é anexado na coluna **"Propostas"** do lead, no board CRM Agostini do monday.com (coluna criada automaticamente ao montar essa função). O painel principal mostra esses arquivos no card do lead, com um visualizador embutido (.docx/.xlsx usam o Office Online Viewer da Microsoft).
- O arquivo do Word não vai direto pro nosso backend — vai primeiro pro **Vercel Blob** (armazenamento de arquivos da própria Vercel), e só a URL resultante (bem pequena) é que chega no backend, que busca o conteúdo de lá pra mandar ao monday.com. Isso existe porque funções da Vercel recusam receber mais de 4.5MB de uma vez só, e uma proposta técnica com fotos/desenhos de uma planta inteira passa disso com folga. O arquivo é apagado do Blob assim que termina de ser encaminhado ao monday.com — ele não fica guardado ali, é só uma ponte.

### Colocando em funcionamento

1. Depois de fazer o deploy deste projeto atualizado (mesmo processo de sempre — subir pro GitHub, a Vercel republica sozinha), você já tem a URL do painel, tipo `agostini-crm.vercel.app`.
2. Abra `public/word-addin/manifest.xml` num editor de texto simples e troque **todas** as ocorrências de `PAINEL_URL_AQUI` por esse domínio real (sem repetir `https://`).
3. **Obrigatório** — crie o armazenamento do Vercel Blob: no painel da Vercel, dentro do projeto, vá em **Storage → Create Database → Blob** (é gratuito) e conecte ao projeto. A variável `BLOB_READ_WRITE_TOKEN` é criada sozinha; não precisa copiar nada manualmente. Sem isso, tanto o botão "Vincular proposta ao CRM" do suplemento quanto o "+ Adicionar arquivo" do painel principal não funcionam. Ao colar/conferir esse valor manualmente em algum lugar, use sempre o botão de copiar da própria Vercel — selecionar o texto à mão é fácil de cortar sem querer o último caractere, o que faz o token parecer configurado mas ser rejeitado como inválido.
4. Em cada computador de vendas: abra o Word, vá em **Inserir → Suplementos → Meus Suplementos → Carregar Meu Suplemento**, e selecione o `manifest.xml` já ajustado. Isso é necessário porque a licença do Microsoft 365 usada é a pessoal (não a versão empresarial com um administrador central) — então a instalação é manual, uma vez por computador, parecido com o instalador da extensão do WhatsApp. Para instalar no Word **desktop** (não só no Word Online), veja o passo a passo detalhado no documento "Benchmark CRM Mercado" do projeto no Claude — inclui o método de sideload via pasta de rede compartilhada e uma solução para o erro comum de cache do WebView2.
5. Depois de instalado, aparece um botão **"Abrir CRM"** na aba Início do Word, que abre o painel lateral do suplemento.

### Limitações a ter em mente

- Como a instalação é manual por computador (sem administrador central do Microsoft 365), atualizações futuras no suplemento não exigem reinstalar o `manifest.xml` (ele só aponta para a URL do painel) — mas se algum dia trocarem de domínio na Vercel, o arquivo precisa ser atualizado e reinstalado.
- A prévia de arquivos no painel principal usa uma URL de visualização válida por 30 minutos — se alguém deixar um card aberto muito tempo antes de clicar num arquivo, pode aparecer erro de link expirado; basta fechar e reabrir o card.
- O envio de arquivo (suplemento do Word ou "+ Adicionar arquivo" do painel) mostra o progresso em % e o tempo decorrido durante o upload. Se a conexão travar (algumas redes/antivírus/proxy fazem isso, principalmente perto do fim do envio), o sistema detecta a falta de progresso em segundos e tenta de novo sozinho, até 4 vezes, antes de mostrar um erro claro — e sempre existe um botão "Cancelar envio" para desistir na hora, sem precisar fechar o Word. Se mesmo assim continuar travando sempre no mesmo computador, é sinal de bloqueio de rede/antivírus específico daquela máquina — vale testar abrindo a mesma URL do painel num navegador comum (Edge/Chrome) em vez de dentro do Word, pra confirmar se o problema é do ambiente do Word (WebView2) ou da rede em geral.

## Ideias para o futuro (não incluídas ainda)

- Alertas automáticos por e-mail (hoje o aviso de follow-up atrasado só aparece quando alguém abre o painel).
- Permissões por perfil (ex: cada vendedor só edita os próprios leads) — hoje o login é só identificação, todo mundo continua vendo/editando tudo.
- Previsão de vendas (forecasting) a partir do funil atual.
- Integração de e-mail/calendário direto pela tela.
