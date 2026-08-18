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

As listas de opções (segmentos, cargos, canais, motivos de perda) estão hoje fixas em `lib/config.js`, copiadas das opções reais do board. Se vocês criarem um novo segmento ou motivo de perda no monday, adicione a mesma opção nesse arquivo para ela aparecer nos formulários e filtros da página.

## O que o painel faz hoje

- Kanban arrastável por estágio de vendas (arrastar um card já atualiza o monday.com).
- Painel lateral por lead: dados de contato, checklist de qualificação (5 critérios, com botão de "marcar como Qualificado" quando 4+ estão preenchidos), edição de todos os campos, anotações (viram "updates" no próprio item do monday, visíveis também por lá, já identificadas com o nome de quem escreveu).
- Formulário de criação de lead direto pela tela ("+ Novo lead"), sem precisar abrir o monday.com.
- Painel de métricas: total de leads, taxa de conversão, ticket médio, motivo de perda mais comum, funil por estágio e ranking por responsável.
- Agenda de follow-ups: atrasados, hoje, próximos 7 dias e leads sem follow-up agendado — com um banner de aviso no Kanban quando há pendências.
- Login individual por pessoa, com uma tela de administração para cadastrar/desativar usuários e redefinir senhas.
- Filtros por responsável, segmento e canal de origem, mais busca por nome/empresa/telefone.
- Aviso visual quando um lead está há mais de 5 dias sem contato.
- Link direto para abrir o item correspondente no monday.com.

## Ideias para o futuro (não incluídas ainda)

- Alertas automáticos por e-mail (hoje o aviso de follow-up atrasado só aparece quando alguém abre o painel).
- Permissões por perfil (ex: cada vendedor só edita os próprios leads) — hoje o login é só identificação, todo mundo continua vendo/editando tudo.
- Previsão de vendas (forecasting) a partir do funil atual.
- Integração de e-mail/calendário direto pela tela.
