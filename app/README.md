# CRM Agostini — Painel

Uma página própria para visualizar e trabalhar o funil de vendas da Agostini, usando o **board "CRM Agostini" no monday.com como banco de dados** (via API oficial). Kanban por estágio (arraste os cards), checklist de qualificação, anotações por lead e filtros — tudo lendo e escrevendo direto no monday.com, então nada muda para quem continua usando o monday.com normalmente (inclusive a extensão do Chrome que já preenche o CRM a partir do sistema de atendimento continua funcionando exatamente igual).

## Como funciona por trás

- **Next.js** — um único projeto que serve tanto a página (React) quanto um pequeno backend (rotas de API) que fala com o monday.com.
- O **token de API do monday.com fica só no servidor** (variável de ambiente), nunca é enviado ao navegador. O navegador conversa só com o seu próprio backend, que por sua vez conversa com `api.monday.com`.
- Não existe login por pessoa nesta v1 — existe uma **senha compartilhada** (`APP_PASSWORD`) que protege a página inteira, já que ela tem permissão de escrita no CRM. Todo mundo que entra vê tudo, mas pode filtrar por responsável, segmento e canal.
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
   | `APP_PASSWORD` | uma senha que só o seu time vai saber |
   | `SESSION_SECRET` | uma string aleatória longa — gere uma com `openssl rand -hex 32` no terminal, ou peça pra mim |
   | `MONDAY_API_VERSION` | deixe em branco (opcional) |

4. Clique em **Deploy**. Em ~1 minuto a Vercel te dá uma URL tipo `agostini-crm.vercel.app`.
5. Abra a URL, digite a `APP_PASSWORD` e pronto.

Qualquer atualização que eu (ou vocês) fizer no código depois, basta subir pro GitHub de novo — a Vercel republica sozinha.

## Segurança — pontos importantes

- **Não é multiusuário de verdade.** A senha compartilhada impede acesso aleatório pela internet, mas não sabe "quem" fez cada alteração além do que já fica registrado como atualização/nota no próprio monday.com. Se isso virar importante, dá para evoluir para login individual (ex: com NextAuth) numa v2.
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

## O que essa v1 faz

- Kanban arrastável por estágio de vendas (arrastar um card já atualiza o monday.com).
- Painel lateral por lead: dados de contato, checklist de qualificação (5 critérios, com botão de "marcar como Qualificado" quando 4+ estão preenchidos), edição de todos os campos, anotações (viram "updates" no próprio item do monday, visíveis também por lá).
- Filtros por responsável, segmento e canal de origem, mais busca por nome/empresa/telefone.
- Aviso visual quando um lead está há mais de 5 dias sem contato.
- Link direto para abrir o item correspondente no monday.com.

## Ideias para uma v2 (não incluídas ainda)

- Login individual por vendedor, com permissões (ex: cada um só edita os próprios leads).
- Alertas automáticos (e-mail/WhatsApp) para leads parados demais num estágio.
- Criação de leads direto pela página (a função já existe no backend — `POST /api/items` — só falta um formulário na tela).
- Um pequeno painel de métricas (taxa de conversão por estágio, motivo de perda mais comum), usando os mesmos dados que a página já carrega.
