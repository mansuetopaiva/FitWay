# Firme

Site de treino com login, check-in diário, gráfico de check-ins e treinos com GIFs dos exercícios.
Frontend em HTML, CSS e JavaScript puros; backend em uma função da Vercel com banco Postgres (Neon).
A conta, os check-ins e as cargas ficam no banco e aparecem em qualquer aparelho.

## Publicar na Vercel

1. Envie esta pasta para o GitHub (`git add . && git commit -m "Firme" && git push -u origin main`).
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
js/data.js          treinos, exercícios, cargas e nomes dos GIFs  <- edite aqui
js/app.js           telas, check-in, gráfico e chamadas ao servidor
api/app.js          backend: criar conta, entrar, sair, carregar e salvar dados
api/_dados.js       validação e fusão dos dados (testado em test/)
gifs/               um GIF animado por exercício (240x240)
gifs/thumb/         miniatura parada de cada GIF (92x92)
```

## Banco de dados

- `usuarios`: email, nome, senha (hash scrypt com salt) e `dados` (JSON com check-ins, sessões, próximo treino e cargas).
- `sessoes`: hash do token de login, email e validade de 30 dias. O token fica em um cookie `HttpOnly`.

Quando dois aparelhos salvam, o servidor junta os dados: check-ins são somados, o número de sessões é o maior e as cargas mais recentes prevalecem.
Sem conexão, o app guarda a alteração no aparelho e envia na próxima vez que abrir.
O treino em andamento (séries marcadas e cronômetro) continua só no aparelho em que foi iniciado.

## Editar os treinos

Em `js/data.js`, cada exercício é uma linha:

```js
["Nome", "arquivo-do-gif", séries, repetições, carga em kg, intervalo em segundos, "Instruções"]
```

## Trocar os GIFs

Substitua o arquivo em `gifs/` mantendo o mesmo nome (ex.: `gifs/leg-press-45.gif`) e,
se quiser, a miniatura em `gifs/thumb/` (ex.: `gifs/thumb/leg-press-45.png`).
Use apenas GIFs que você tem direito de publicar.

## Testes

`npm test`
