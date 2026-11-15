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
api/app.js          backend: criar conta, entrar, sair, carregar e salvar dados
api/_admin.js       ações do painel de administração
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
- `usuarios.acesso_ate`: até quando o admin liberou o acesso. Por enquanto só o admin mexe nela e ela não bloqueia nada.
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

## Testes

`npm test`
