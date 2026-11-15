# Plano de implementação: área de administração

Spec: [docs/admin.md](../docs/admin.md). A lista de tarefas está neste arquivo.

## Visão geral

Painel de admin na aba **Admin** (só para quem está em `ADMIN_EMAILS`). Mostra o resumo, a lista e o detalhe de usuários, o acesso (`acesso_ate`), o editor de treino, o envio de PDF e a remoção de treino, e o histórico de ações. Tudo que o admin altera vai para `admin_log`. Pedidos, IA e pagamento ficam fora.

Cada tarefa é uma fatia vertical (banco + servidor + tela quando cabe), com teste, e termina num commit local. Não há push.

## Decisões de arquitetura

- **`api/_admin.js` recebe o `sql` por parâmetro** (`acaoAdmin(sql, u, b)`). Assim o teste injeta um `sql` falso e prova que um não-admin recebe 403 sem nenhuma consulta. O "_" impede a Vercel de expor o arquivo como rota.
- **`ehAdmin` lê `process.env.ADMIN_EMAILS` a cada chamada**, sem cache.
- **`lerPdf(base64)` sai da ação `treino` e vai para `api/_treino.js`**. A ação `treino` e a op `plano_pdf` usam a mesma função, com os mesmos limites e mensagens.
- **Datalist a partir de `FOTOS`:** cada regra ganha um nome de exemplo, e um teste garante que cada exemplo cai na própria regra.
- **`js/admin.js` é carregado só para admin**, por um `<script>` injetado quando `admin === true`. O CSP atual (`script-src 'self'`) já permite isso.
- **Layout largo só no admin:** uma classe no `#app` na rota admin muda a largura máxima de 480 px para 1100 px, com duas colunas a partir de 900 px.

## Tarefas

### Fase 1: base e segurança

- [ ] **T1: Quem é admin, a aba e a porta fechada (S)**
  - O que muda: o teste vem primeiro; depois `ehAdmin`, `admin` em `publico(u)`, colunas `criado`/`acesso_ate` e `admin_log` em `schema()`, o encaminhamento `acao: "admin"`, a aba de escudo e um `js/admin.js` mínimo ("Carregando…").
  - Aceite: o teste prova 403 com zero SQL para não-admin em todas as ops; a aba só aparece para admin.
  - Verifica: `npm test` e `node --check`.
  - Arquivos: `api/app.js`, `api/_admin.js`, `js/app.js`, `js/admin.js`, `test/admin.test.js`.
- [ ] **T2: `validarPlano`, `escaparLike` e `NOMES_FOTOS` (S, teste primeiro)**
  - Aceite: todos os limites da spec, na borda e um acima; ids repetidos e tipos errados recusados; foto recalculada; escape de `\ % _`; cada nome de exemplo cai na própria regra.
  - Verifica: `npm test`.
  - Arquivos: `api/_dados.js`, `api/_treino.js`, `test/admin.test.js`.

**Checkpoint 1:** `npm test` verde e commits locais.

### Fase 2: usuários e acesso

- [ ] **T3: Resumo e lista de usuários (M)**
  - O que muda: ops `resumo` e `usuarios`; na tela, cartões, busca, lista, "Carregar mais", estados de carregando, vazio e erro, e o CSS do painel.
  - Aceite: a busca por `a_b` encontra o texto literal "a_b"; os três estados aparecem.
  - Verifica: `npm test` e `vercel dev` em 360 px e no computador.
  - Arquivos: `api/_admin.js`, `js/admin.js`, `css/style.css`.
- [ ] **T4: Detalhe, acesso e histórico (M)**
  - O que muda: ops `usuario` e `acesso` (dias, data, cortar) com log; na tela, os blocos Acesso e Histórico, confirmação antes de cortar, e Voltar no celular.
  - Aceite: as três formas de mudar o acesso funcionam como na spec e aparecem no histórico; entrada fora da faixa dá 400; email inexistente dá 404.
  - Verifica: `npm test` (validação das entradas) e `vercel dev`.
  - Arquivos: `api/_admin.js`, `js/admin.js`, `css/style.css`, `test/admin.test.js`.

**Checkpoint 2:** buscar, abrir, liberar e cortar funcionam de ponta a ponta no `vercel dev`, e o histórico mostra as ações.

### Fase 3: treino do usuário

- [ ] **T5: `lerPdf` e as ops de plano (S)**
  - O que muda: extrair `lerPdf` da ação `treino` sem mudar o comportamento dela; ops `plano_salvar`, `plano_pdf` e `plano_remover`, com log.
  - Aceite: os testes de PDF continuam verdes; `plano_salvar` não toca em check-ins, cargas nem sessões; plano inválido dá 400 com mensagem que diz onde está o erro.
  - Verifica: `npm test`.
  - Arquivos: `api/_treino.js`, `api/app.js`, `api/_admin.js`, `test/admin.test.js`.
- [ ] **T6: Editor de treino (M)**
  - O que muda: abas de treino (renomear, adicionar, remover), exercícios (seis campos; adicionar, remover, subir, descer), datalist, Salvar, Enviar PDF e Remover com confirmação, e aviso de alterações não salvas.
  - Aceite: o admin edita e salva, e o usuário vê o treino novo com fotos; o editor funciona em 360 px e pelo teclado.
  - Verifica: `vercel dev`, salvando e conferindo na conta do usuário.
  - Arquivos: `js/admin.js`, `css/style.css`.

**Checkpoint 3:** fluxo completo no `vercel dev`.

### Fase 4: fechamento

- [ ] **T7: README, revisão e go/no-go (S)**
  - O que muda: seção Admin no README; os agentes code-reviewer, security-auditor, test-engineer e web-performance-auditor rodam em paralelo sobre o que mudou; correções; checklist de lançamento; instruções de `vercel dev`.
  - Aceite: `npm test` verde; cada achado corrigido ou justificado.
  - Arquivos: `README.md` e os que a revisão apontar.

## Riscos

| Risco | Impacto | Como reduzir |
|---|---|---|
| `ADMIN_EMAILS` sem valor na Vercel | Baixo | A variável vazia é segura (ninguém é admin); o README explica como configurar. |
| Usuários antigos aparecem com `criado` = dia do deploy | Baixo | Avisado na spec; afeta "novos 7d" uma única vez. |
| Lista e resumo leem os check-ins de dentro do JSON `dados` | Baixo agora | Páginas de 20; comentário `shortcut:` indicando quando mover os check-ins para uma tabela própria. |
| Editor grande demais para celular | Médio | Um treino por vez (abas), campos empilhados em 360 px, e teste manual nessa largura antes do commit. |

## Perguntas em aberto

As duas da spec: o significado de "Escolher data" e o arquivo `js/admin.js` separado.
