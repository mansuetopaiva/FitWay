# FitWay

Site de treino com login, check-in diário, gráfico de check-ins, treinos com imagem de cada exercício,
envio do treino em PDF e ranking de check-ins entre amigos.
Frontend em HTML, CSS e JavaScript puros; backend em uma função da Vercel com banco Postgres (Neon).
A conta, os check-ins e as cargas ficam no banco e aparecem em qualquer aparelho.

## Publicar na Vercel

1. Envie esta pasta para o GitHub (`git add . && git commit -m "FitWay" && git push -u origin main`).
2. Em vercel.com: **Add New → Project**, escolha o repositório, mantenha o preset **Other** e todos os campos de build vazios, e clique em **Deploy**.
3. No projeto: **Storage → Create Database → Neon (Postgres)**, plano gratuito, e conecte ao projeto. Isso cria a variável `DATABASE_URL` sozinho.
4. **Deployments → ⋯ → Redeploy**, para o site passar a enxergar a variável.

As tabelas são criadas automaticamente no primeiro acesso; não há SQL para rodar à mão.

Para testar no computador: `npm i -g vercel`, depois `vercel link`, `vercel env pull` e `vercel dev`.
Abrir o `index.html` direto ou por `python3 -m http.server` não funciona mais, porque o login precisa da função em `/api`.

## Estrutura

```
index.html          página única
css/style.css       visual (tema escuro + verde)
js/app.js           telas, check-in, gráfico, ranking e chamadas ao servidor
js/admin.js         painel de administração (só é baixado por quem é admin)
js/pedido.js        formulário do treino personalizado (só é baixado ao abrir o formulário)
js/pagamento.js     tela de pagamento do pedido: Pix ou cartão (só é baixado ao abrir)
api/app.js          backend: criar conta, entrar, sair, carregar e salvar dados, pedidos
api/_admin.js       ações do painel de administração, inclusive pedidos
api/_precos.js      preços e regras de cobrança e acesso
api/_pedido.js      validação do formulário e das fotos, criação do pedido
api/_pagamento.js   Pix (link do Nubank), cartão (InfinitePay) e a confirmação do pagamento
api/infinitepay.js  webhook do InfinitePay (POST /api/infinitepay)
api/_ia.js          chamada à IA, validação do plano gerado e geração do pedido
api/_prompt.js      texto do prompt da IA
api/_material_apoio.md  material de apoio que entra no prompt
api/_termo.js       Termo de Responsabilidade e Uso (versão atual e antigas)
api/_dados.js       validação e fusão dos dados, validarPlano e escaparLike (testado em test/)
api/_treino.js      leitura do PDF de treino e escolha da foto de cada exercício
img/fitway-logo.png     logo da tela de login
img/fitway-favicon.png  ícone da aba e da tela inicial do celular
```

## Banco de dados

- `usuarios`: email, nome, senha (hash scrypt com salt) e `dados` (JSON com check-ins, sessões, próximo treino e cargas).
- `usuarios.grupo`: código do grupo do ranking (o mesmo código para todos do grupo).
- `usuarios.criado`: data de cadastro. Contas criadas antes do painel ficam vazias (o banco não guardava a data);
  o dia em que a coluna foi criada fica no comentário da coluna.
- `usuarios.acesso_ate`: até quando o acesso está pago ou liberado pelo admin. Sem acesso ativo, o treino feito pela IA não aparece (PDF e admin aparecem sempre).
- `pedidos`: cada pedido de treino com IA ou mensalidade (tipo, status, valor, respostas, fotos, aceite do termo, plano gerado, modelo da IA, erro)
  e o pagamento (meio, código do pedido, comprovante e ID da transação do Pix, transação do cartão).
  Índices únicos impedem dois pedidos abertos para a mesma pessoa e o mesmo Pix ou pagamento de cartão em dois pedidos.
- `admin_log`: cada alteração feita pelo admin (quem, o quê, em quem, detalhes e quando).
- `sessoes`: hash do token de login, email e validade de 30 dias. O token fica em um cookie `HttpOnly`.

Quando dois aparelhos salvam, o servidor junta os dados: check-ins são somados, o número de sessões é o maior e as cargas mais recentes prevalecem.
Sem conexão, o app guarda a alteração no aparelho e envia na próxima vez que abrir.
O treino em andamento (séries marcadas e cronômetro) continua só no aparelho em que foi iniciado.

## Treino em PDF

Conta nova não tem treino: a aba **Treinos** só aparece depois que a pessoa envia o PDF em **Perfil → Enviar PDF do treino**. A leitura é por regras, sem IA, e entende dois formatos:

- **Tabela numerada**: `1 Supino reto com halteres B 3 x 6–8 Observação`, com títulos como `A – Superior`
  (`B` = básico, 2min30 de descanso; `I` = isolador, 1min30; sem tipo, 1 min). Nomes quebrados em várias linhas funcionam.
- **Lista**: uma linha por exercício, com ou sem marcador (`●`, `-`, `*`, `1)`), como `Extensora — 3×10`,
  `Supino reto: 4 séries de 12`, `Crucifixo 3x10-12`, `Panturrilha — 4× até a falha`. Cada título entre as listas vira um treino.

Tempos como `3 x 20 min` são ignorados (cárdio).

PDF escaneado (foto do papel) não funciona: o texto precisa ser selecionável.
A foto de cada exercício vem do [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (domínio público),
escolhida pelo nome em `api/_treino.js` (lista `FOTOS`). Nome sem correspondência aparece com um ícone.
Para reconhecer um nome novo, adicione uma linha nessa lista.

## Ranking

A aba **Ranking** cria um grupo com um código de 6 letras. Quem entra com o código vê o nome e os check-ins
de todos do grupo na semana (a partir de domingo) e no mês. O email nunca aparece para os outros.


## Admin

Na Vercel, em **Settings → Environment Variables**, crie `ADMIN_EMAILS` com os emails de quem administra,
separados por vírgula, e faça um **Redeploy**. **A conta precisa existir antes:** crie a conta no app
e só depois coloque o email na variável. Um email listado ali não pode mais ser cadastrado pelo app (senão quem
cadastrasse primeiro viraria admin). Essas pessoas entram com a
conta normal e passam a ver a aba **Admin** (escudo). Sem a variável, ninguém é admin.

A aba escondida é só visual. Toda chamada do painel confere no servidor, a cada vez, se o email da sessão está em
`ADMIN_EMAILS`; quem não está recebe 403 sem que nenhum dado de admin seja lido. O arquivo `js/admin.js` é público
para quem souber o endereço, por isso não guarda nenhum segredo.

- **Resumo:** total de usuários, novos nos últimos 7 dias, quantos têm treino, quantos têm acesso liberado e
  check-ins de hoje e da semana (horário de Brasília, semana a partir de domingo).
- **Usuários:** busca por nome ou email (`%` e `_` são tratados como texto), 20 por página, mais novos primeiro.
- **Detalhe:** cadastro, check-ins, sessões e grupo do ranking.
  - **Acesso:** +7 dias e +30 dias (somam ao que já existe), uma data exata (vale até o fim do dia, em Brasília)
    e cortar acesso.
  - **Treino:** editor com treinos em abas e exercícios. O nome sugere os exercícios que têm foto, mas aceita qualquer
    nome. Ao salvar, o servidor valida tudo e recalcula as fotos; check-ins, cargas e sessões do usuário não mudam.
    Também dá para enviar um PDF pela conta do usuário (mesma leitura do Perfil) ou remover o treino.
  - **Histórico:** as últimas 20 ações do admin com esse usuário.

## Treino com IA

Fluxo: a pessoa pede o treino no Perfil e preenche o formulário (Você, Rotina, Saúde com PAR-Q, Fotos, Observações e Resumo com o termo).
O pedido fica **aguardando pagamento** e a pessoa escolhe como pagar (ver [Pagamento](#pagamento)). Com o pagamento confirmado,
a IA monta um plano de 8 semanas, que aparece na aba Treinos com o cartão "Como funciona seu plano".

| Pedido | Pix | Cartão | O que libera |
|---|---|---|---|
| Treino inicial | R$ 9,99 | R$ 11,99 | 30 dias de acesso e o treino |
| Mensalidade | R$ 9,99 | R$ 11,99 | +30 dias de acesso (a partir do fim do acesso atual) |
| Novo treino | R$ 4,99 | R$ 5,99 | um plano novo; só depois de 8 semanas do atual e com acesso ativo |

Os preços ficam em `api/_precos.js`. Regras de saúde: qualquer "Sim" no PAR-Q exige a caixa de liberação médica (o servidor confere),
e o pedido é só para maiores de 18 anos. As fotos são apagadas 90 dias depois do treino pronto; as respostas ficam.
Pedido aguardando pagamento há mais de 30 dias é cancelado e perde as fotos (roda na consulta de status e no resumo do admin, sem cron).
Pedido com o Pix avisado (aguardando confirmação) não é cancelado pelo prazo.

Variáveis na Vercel (**Settings → Environment Variables**):
- `TREINO_IA_ATIVO`: `1` liga os pedidos de treino com IA para todos; qualquer outro valor (ou sem a variável) deixa desligado — só o admin vê e pode pedir, para testar. Renovar e ver um treino de IA que já existe funcionam sempre. Desligado, o termo também não é público (tem dados pessoais): só o admin lê.
- `ANTHROPIC_API_KEY`: chave da API da Anthropic (console.anthropic.com). Fica só no servidor.
- `IA_MODELO` (opcional): modelo usado; o padrão é `claude-sonnet-5-5`.

Onde editar:
- o prompt: `api/_prompt.js` (a parte fixa vai no system com cache; a parte do aluno, na mensagem);
- o material de apoio: `api/_material_apoio.md`;
- o termo: `api/_termo.js`. Para mudar o texto, acrescente uma versão nova no topo da lista; quem já aceitou a antiga continua com ela registrada,
  e o próximo pedido exige o aceite da nova.

### Dados do responsável no termo

O repositório é público, então nome, documento, email e foro do responsável **não ficam no código**. O termo tem os marcadores
`{{responsavel}}`, `{{documento}}`, `{{email_contato}}` e `{{foro}}`, trocados na hora por estas variáveis de ambiente:

| Variável | Marcador | Exemplo |
|---|---|---|
| `TERMO_RESPONSAVEL` | `{{responsavel}}` | nome do responsável ou da empresa |
| `TERMO_DOCUMENTO` | `{{documento}}` | CPF ou CNPJ |
| `TERMO_EMAIL` | `{{email_contato}}` | email para pedidos de acesso, correção ou exclusão de dados |
| `TERMO_FORO` | `{{foro}}` | cidade/UF do foro |

- Cadastre as quatro na Vercel (Production e Development) e, para testar no computador, no `.env.local` (fora do git).
  O `vercel env pull` reescreve o `.env.local`: cadastre na Vercel antes, para não perdê-las.
- Se alguma estiver vazia, o treino com IA fica bloqueado mesmo com `TREINO_IA_ATIVO=1`: o usuário vê "Em breve." e o painel do admin
  mostra qual variável falta.
- O aceite grava o SHA-256 do texto exato mostrado. Se as variáveis mudarem depois, o painel avisa que o texto atual é diferente do aceito.

Cada geração custa por volta de US$ 0,05 a 0,10. A geração roda dentro da consulta de status (do aluno ou do admin), sem fila nem cron;
se falhar, o pedido tenta mais uma vez e, na segunda falha, fica como **Erro** para o admin clicar em **Gerar de novo**.

## Pagamento

Spec: [docs/pagamento.md](docs/pagamento.md). Depois de enviar o pedido (ou tocar em **Pagar** no Perfil), a pessoa escolhe Pix ou cartão.
Só aparecem os meios configurados; sem nenhum, a tela diz "Pagamento indisponível no momento".

- **Pix:** a tela mostra o valor, o botão "Pagar R$ X com Pix" (abre o link de cobrança do Nubank numa nova aba, com o valor já preenchido)
  e o código do pedido. Depois de pagar, a pessoa anexa o comprovante (obrigatório), pode colar o ID da transação e toca em **Já paguei**.
  O pedido fica **Pix a conferir**. No painel, o admin vê o valor esperado ao lado do comprovante, cola o ID da transação copiado do app
  do Nubank (o servidor recusa um Pix com data de antes do pedido) e clica em **Confirmar Pix recebido** (ou **Não encontrei o Pix**, que devolve o pedido com um aviso para a pessoa).
  O mesmo ID nunca confirma dois pedidos.
- **Cartão:** a pessoa vai para o checkout do InfinitePay e volta para o app, que confirma o pagamento. O webhook `/api/infinitepay`
  também confirma. Nos dois casos o servidor pergunta ao InfinitePay (`payment_check`) se o pagamento existe e de quanto foi: o que chega
  no navegador ou no webhook nunca vale como prova. **Verificar no InfinitePay** no painel repete a pergunta.

Variáveis na Vercel:

| Variável | Para quê |
|---|---|
| `PIX_LINK_999` | link de cobrança do Nubank de R$ 9,99 (treino inicial e mensalidade). Precisa começar com `https://nubank.com.br/cobrar/` |
| `PIX_LINK_499` | link de cobrança do Nubank de R$ 4,99 (novo treino). Mesma regra |
| `PIX_TITULAR_EXIBIDO` | nome mostrado na tela do Pix como recebedor (opcional). O app do banco mostra o titular da conta de qualquer jeito |
| `INFINITEPAY_HANDLE` | InfiniteTag sem o `$` |
| `SITE_URL` | endereço do site, sem barra no fim (ex.: `https://fitway.vercel.app`); usado na volta do checkout e no webhook |

- Sem o link do valor de um pedido, o Pix não aparece para aquele pedido (o nome da variável sai do preço em centavos: mudou o preço, crie um link novo).
- Sem `INFINITEPAY_HANDLE` ou `SITE_URL`, o cartão não aparece.
- O comprovante e o nome de quem pagou são apagados junto com as fotos, 90 dias depois do pedido pronto, cancelado ou com erro.
- Cartão pago num pedido que já não estava aberto (cancelado, já pago por Pix, link pago duas vezes) aparece no topo do resumo do admin
  por 30 dias: devolva pelo InfinitePay.
- Antes de liberar o cartão, falta conferir com um link real (criar link é grátis) o campo da URL na resposta de `/links` e se o
  `payment_check` amarra o pedido ao pagamento (perguntas P2 e P8 da spec).

## Testes

`npm test`
