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
- Cada conta do painel pode ser vinculada à pessoa correspondente no monday.com ("Gerenciar usuários" → coluna "Vendedor no monday.com") — só quem está vinculado aparece no filtro de "responsável" e pode ser escolhido ao criar/editar um lead, então gente de outros setores (PCP, almoxarifado, técnicos etc.) não polui mais essas listas. Leads antigos que já estavam com alguém de fora atribuído continuam mostrando o nome certo, só não dá mais pra escolher essa pessoa daqui pra frente.
- Filtros por responsável, segmento e canal de origem, mais busca por nome/empresa/telefone.
- Aviso visual quando um lead está há mais de 5 dias sem contato.
- Link direto para abrir o item correspondente no monday.com.
- Anexar e remover arquivos de um lead direto no painel (card do lead → aba/seção "Arquivos" → **"+ Adicionar arquivo"**): proposta, orçamento de frete, layout do cliente, foto, planilha — qualquer tipo. Cada arquivo mostrado tem um botão de remover (🗑️), para o caso de ter sido anexado por engano; a remoção pede confirmação e não pode ser desfeita. Usa a mesma coluna **"Propostas"** do monday.com por trás (por isso ela também aparece com esse nome se você abrir o lead direto no monday.com) — e o mesmo mecanismo de upload direto pro Vercel Blob descrito na seção do suplemento do Word abaixo, então precisa do mesmo `BLOB_READ_WRITE_TOKEN` configurado.

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
