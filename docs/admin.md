# Spec: Área de administração do FitWay

## Objetivo

Um painel dentro do app para o dono do FitWay:

- ver os números gerais;
- encontrar usuários;
- liberar ou cortar acesso (por enquanto só um registro: ainda não bloqueia nada);
- editar, enviar ou remover o treino de um usuário.

Toda alteração fica registrada.

**Fora do escopo** (vem em pedidos separados): formulário de pedido, IA, pagamento, pedidos, renovação. Nenhuma tabela ou campo é criado para essas partes.

**Quem usa:** só os emails em `ADMIN_EMAILS`. Eles entram com a conta normal e passam a ver a aba **Admin**.

## Stack e comandos

O stack não muda: JS puro no navegador, uma função Vercel (`api/app.js`) com ações por `acao`, Postgres Neon via `@neondatabase/serverless` e `node --test`. Não entra dependência nova.

```
npm test                          # todos os testes de test/
node --check api/app.js api/_admin.js js/app.js js/admin.js
vercel dev                        # site + função locais (depois de vercel link e vercel env pull)
```

## Estrutura

```
api/app.js      encaminha acao "admin" para api/_admin.js; a ação "treino" passa a usar lerPdf()
api/_admin.js   NOVO: ehAdmin(email), acaoAdmin(sql, u, b), todas as ops
api/_dados.js   + validarPlano(plano), escaparLike(texto)
api/_treino.js  + lerPdf(base64), + NOMES_FOTOS; cada regra de FOTOS ganha um nome de exemplo em pt-BR
js/app.js       aba Admin; carrega js/admin.js só quando a conta é admin
js/admin.js     NOVO: telas do painel
css/style.css   estilos do painel
test/admin.test.js  NOVO
```

## Contrato

### Quem é admin

- `ADMIN_EMAILS="a@x.com, B@y.com"`. O servidor compara em minúsculas e sem espaços. Variável vazia ou ausente significa nenhum admin.
- `publico(u)` passa a devolver `admin: true|false`. A aba (ícone de escudo, depois de Perfil) só aparece com `admin === true`.
- **Toda** chamada `acao: "admin"` confere `ehAdmin(email da sessão)` no servidor, na própria chamada, antes de qualquer consulta. Se não for admin: **403**, nenhum SQL executado.
- As checagens que já existem continuam valendo antes dessa: sessão válida e a proteção `conta` (aba de outra conta).

### Banco (em `schema()`, idempotente)

```sql
-- criado: criada vazia (contas antigas ficam null), o dia da migração vai no comentário da coluna, e só depois entra o default now()
alter table usuarios add column if not exists acesso_ate timestamptz;
create table if not exists admin_log (
  id bigint generated always as identity primary key,
  admin_email text not null, acao text not null, alvo_email text,
  detalhes jsonb, criado timestamptz not null default now()
);
create index if not exists admin_log_alvo on admin_log (alvo_email, criado desc);
```

Usuários que já existem ficam com `criado` nulo, porque o banco não guardou a data real. No painel eles aparecem como "Antes de DD/MM/AAAA", com o dia em que a coluna foi criada (guardado no comentário da coluna). O "novos nos últimos 7 dias" ignora os nulos.

### Ação `admin`: `{ acao: "admin", op, ... }`

| op | entrada | saída | log |
|---|---|---|---|
| `resumo` | — | `usuarios`, `novos7d`, `comTreino`, `comAcesso` (`acesso_ate > now()`), `checkinsHoje`, `checkinsSemana` | não |
| `usuarios` | `busca?` (até 80 caracteres), `pagina?` (inteiro ≥ 0) | `itens[]`: nome, email, criado, checkins, ultimoCheckin, temTreino, acessoAte; `temMais` | não |
| `usuario` | `email` | os mesmos campos, mais `plano`, `sessoes`, `grupo`, `historico[]` (últimas 20 linhas do log com esse alvo) e `nomes` (lista para o datalist) | não |
| `acesso` | `email` e exatamente um de: `dias` (inteiro 1–365), `ate` (`AAAA-MM-DD`, de hoje até +2 anos), `cortar: true` | `acessoAte` | sim |
| `plano_salvar` | `email`, `plano` | `plano` validado | sim |
| `plano_pdf` | `email`, `pdf` (base64) | `plano` | sim |
| `plano_remover` | `email` | `{}` | sim |

- **Acesso:**
  - `dias`: `acesso_ate = greatest(now(), coalesce(acesso_ate, now())) + N dias`.
  - `ate`: vale até o fim do dia escolhido, no horário de Brasília.
  - `cortar`: `acesso_ate = now()`.
- **Busca:** `nome ilike $q or email ilike $q`, com `$q = '%' || escaparLike(busca) || '%'` (escapa `\`, `%` e `_`). Ordem: `criado desc, email`. Páginas de 20 (pede 21 para saber se há mais).
- **Check-ins hoje e na semana:** datas em America/Sao_Paulo; a semana começa no domingo, como no app.
- **`plano_salvar`:** `validarPlano()` devolve `{ plano }` ou `{ erro }`. A foto de cada exercício é recalculada com `foto(nome)`, e o que vem do navegador é ignorado. Só `dados.plano` é trocado, mais `dados.proximo` se ele apontar para um treino que deixou de existir. Check-ins, cargas e sessões não mudam.
- **`plano_pdf`:** usa `lerPdf()`, a mesma função da ação `treino` do usuário, com os mesmos limites (3 MB, 30 páginas, 200 mil caracteres) e as mesmas mensagens.
- **Log:** guarda `admin_email`, `acao` (= op), `alvo_email` e `detalhes`. Os detalhes são `{dias}`, `{ate}`, `{cortar}`, `{treinos, exercicios}` ou `{}`, nunca o plano inteiro.
- **Erros:** email alvo inexistente dá **404**; entrada inválida dá **400** com mensagem em pt-BR; op desconhecida dá **400**.

### `validarPlano(plano)` em `api/_dados.js`

- **Plano:** objeto com `nome` (1 a 80 caracteres) e `treinos`, de 1 a 12.
- **Treino:** `id` com 1 a 10 caracteres `[A-Za-z0-9]`, único no plano; `nome` com 1 a 80 caracteres; `exercicios`, de 1 a 30.
- **Exercício** `[nome, foto, séries, reps, carga, descanso, obs]`:
  - nome: string de 1 a 70 caracteres depois do `trim`;
  - séries: inteiro de 1 a 20;
  - reps: string de até 12 caracteres;
  - carga: número finito de 0 a 500;
  - descanso: inteiro de 0 a 600;
  - obs: string de até 160 caracteres.
- Qualquer outro tipo é recusado. A mensagem de erro diz onde está o problema, por exemplo: "Treino B, exercício 3: séries precisa ser de 1 a 20."

### Datalist a partir de `FOTOS`

Cada regra de `FOTOS` ganha um terceiro item, o nome de exemplo em pt-BR (`[/supino.*halter/, "Dumbbell_Bench_Press", "Supino reto com halteres"]`). `NOMES_FOTOS` é a lista desses nomes. Um teste garante que `foto(nome)` de cada exemplo cai na própria regra, então a sugestão sempre tem foto.

### Tela

- **Topo:** cartões do resumo.
- **Lista:** busca (envia depois de uma pausa na digitação ou ao apertar Enter), linhas com nome, email, check-ins e um selo "Treino" ou "Acesso até DD/MM", e o botão "Carregar mais". Tem estados de carregando, vazio ("Nenhum usuário encontrado") e erro (com "Tentar de novo").
- **Detalhe:**
  - **Acesso:** "Liberado até DD/MM" ou "Sem acesso liberado". Botões +7 dias, +30 dias, Escolher data (`<input type="date">`) e Cortar acesso (com confirmação).
  - **Treino:** editor com treinos em abas (renomear, adicionar, remover) e exercícios (os seis campos com `<label>`; adicionar, remover, subir e descer). O nome usa `<datalist>`. Botões Salvar treino, Enviar PDF por este usuário (com confirmação, porque substitui o treino) e Remover treino (com confirmação). Alterações não salvas: aviso antes de sair do detalhe.
  - **Histórico:** as últimas 20 ações do admin com esse usuário (data, admin, ação, detalhe).
- **Layout:** no celular, uma coluna, e o detalhe abre no lugar da lista com botão Voltar. A partir de 900 px, a tela do admin usa até 1100 px, com a lista à esquerda e o detalhe à direita. As outras telas continuam com 480 px.
- **Acessibilidade:** botões de verdade; abas com `role="tab"` e `aria-selected`; alvos de toque de 40 px ou mais; foco levado para o título do detalhe ao abrir e de volta para a linha ao voltar; mensagens de sucesso e erro pelo `toast` (`aria-live`) que já existe.
- **Visual:** os tokens e componentes atuais (`.card`, `.btn`, `.tools`, `.seg`, `.field`, `.row`).

## Testes (`test/admin.test.js`)

- `ehAdmin`: lista com espaços e maiúsculas; variável vazia; email parecido mas diferente.
- `acaoAdmin` com um `sql` falso que registra chamadas: para **cada** op, um não-admin recebe 403 e **zero** consultas. Admin com op desconhecida recebe 400.
- `validarPlano`:
  - um plano válido passa;
  - cada limite passa na borda e falha um acima (ou abaixo): 12 treinos, 30 exercícios, nome com 70 caracteres, séries 1 e 20, reps com 12 caracteres, carga 0 e 500, descanso 0 e 600, obs com 160;
  - falham: ids repetidos, tipos errados, plano vazio ou `null`;
  - a foto é recalculada.
- `escaparLike`: `%`, `_` e `\` escapados; texto comum intacto.
- `NOMES_FOTOS`: cada nome cai na própria regra.
- Os testes atuais continuam passando. Nenhum teste é pulado ou enfraquecido.

## Limites

- **Sempre:** conferir admin no servidor a cada chamada; tratar todo campo do navegador como hostil (tipo, tamanho, faixa); `esc()` em tudo que vai para o HTML; log em toda escrita; commits pequenos e locais.
- **Perguntar antes:** dependência nova; mudar o formato de algo já gravado; qualquer coisa de pedido ou pagamento; `push`.
- **Nunca:** confiar em `admin` vindo do navegador; devolver hash de senha, token de sessão ou foto de perfil de outro usuário nas listas; apagar usuários; push.

## Critérios de pronto

1. Conta fora de `ADMIN_EMAILS` não vê a aba e recebe 403 em todas as ops (há teste).
2. Admin vê o resumo e busca usuários (`%` e `_` são tratados como texto). No detalhe, dá +7, +30 ou uma data e corta o acesso, e cada ação aparece no histórico.
3. Admin edita o treino de um usuário e salva; o usuário vê o treino novo com as fotos, e check-ins e cargas ficam como estavam.
4. Admin envia um PDF e remove o treino de um usuário, com confirmação e registro no log.
5. Plano inválido é recusado pelo servidor com uma mensagem que diz onde está o erro.
6. O painel é usável com 360 px de largura e no computador; listas com carregando, vazio e erro.
7. `npm test` verde; os quatro agentes rodados, com o que ficou de fora justificado.

## Decisões

1. **"Escolher data":** o acesso vale até o fim do dia escolhido, no horário de Brasília.
2. **Código do painel:** em `js/admin.js`, carregado só para quem é admin.

## Regras do treino pago (para a etapa de pagamento, não implementadas aqui)

Registradas para não se perderem. Nada disto entra nesta etapa.

- O acesso ao treino pago vale 30 dias a partir do aceite do admin. No painel de hoje isso é o botão "+30 dias".
- Quando o acesso expira e a pessoa não paga, ela perde **só o treino pago**. Continua usando o resto do site: check-in, ranking, perfil e treino por PDF.
- Depois de 2 meses com o mesmo treino, pedir um novo custa R$ 4,99, e não R$ 9,99.
