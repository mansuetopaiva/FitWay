# Plano de implementação: treino com IA, pedidos e cobrança

Spec: [docs/treino-ia.md](../docs/treino-ia.md). A lista de tarefas está neste arquivo. O plano do admin continua em `tasks/plan.md`.

## Visão geral

O fluxo completo é: formulário → pedido aguardando pagamento → admin marca como pago → IA gera um plano de 8 semanas → acesso de 30 dias com mensalidade e novo treino. Não há meio de pagamento. A lógica de preço, permissão, validação e prompt fica em arquivos puros, com testes escritos antes do código. O SQL é conferido no PGlite e a tela no jsdom, como foi feito no admin.

## Decisões de arquitetura

- Toda lógica pura fica em `api/_precos.js`, `api/_pedido.js`, `api/_prompt.js` e `api/_ia.js`. O `app.js` e o `_admin.js` só chamam essas funções.
- `gerarSeDevido(sql, pedido, chamarIA)` recebe o `sql` e a função que chama a IA, para o teste provar que a geração roda uma vez só, com `sql` e `fetch` simulados.
- A saída da IA usa `output_config.format` (JSON Schema), porque o `tool_choice` forçado dá erro 400 nesse modelo. O system fica só com a parte fixa, para o cache funcionar (decisões D1 e D2 da spec).
- O formulário fica em `js/pedido.js`, baixado só quando a pessoa abre o formulário, no mesmo esquema do `admin.js`.
- Um índice único parcial garante no banco o "1 pedido aberto por usuário", contra dois cliques ao mesmo tempo.

## Tarefas

### Fase 1: regras (servidor puro, teste antes)

- [x] **T1: `api/_precos.js` (S)**
  - O que muda: `PRECOS`, `podePedir`, `efeitoDoPagamento`, `acessoAtivo`, `planoVisivel`.
  - Aceite: os casos do item 8 do pedido (cada tipo; plano com 55 e 56 dias; acesso vencido; pedido aberto; IA vencido some e PDF e admin ficam).
  - Verifica: `npm test`.
  - Arquivos: `api/_precos.js`, `test/precos.test.js`.
- [x] **T2: `limparRespostas` e `limparFotos` (S)**
  - O que muda: cada limite, as opções fechadas, o PAR-Q exigindo liberação, os consentimentos e as fotos (tipo, chaves, tamanho).
  - Verifica: `npm test`.
  - Arquivos: `api/_pedido.js`, `test/pedido.test.js`.
- [x] **T3: Prompt e validação da IA (M)**
  - O que muda: `api/_material_apoio.md`, `api/_prompt.js` (`montarPrompt` devolvendo `{system, mensagem}`), `api/_ia.js` (SCHEMA, `montarRequisicao`, `validarPlanoIA`).
  - Aceite: marcadores trocados e nenhum sobrando; texto do aluno escapado e delimitado; seção de plano anterior só no `novo_treino`; nada do aluno no system; plano válido aceito; nome fora da lista, limites e fases recusados.
  - Verifica: `npm test`.
  - Arquivos: os três acima e `test/ia.test.js`.

**Checkpoint 1:** `npm test` verde. Mostro um exemplo de requisição montada, sem a chave da API.

### Fase 2: pedidos de ponta a ponta

- [x] **T4: Banco, `pedido_criar`, `pedido_status` e `publico()` (M)**
  - O que muda: tabela, índices, as duas ações; `publico()` esconde o plano de IA vencido; `limpar()` e `validarPlano()` aceitam `guia`; `plano_salvar` preserva a origem IA (D4).
  - Aceite: podePedir e as validações rodam no servidor; segundo pedido aberto recusado, inclusive em corrida (índice); o plano de IA some com o acesso vencido.
  - Verifica: `npm test` e PGlite.
  - Arquivos: `api/app.js`, `api/_dados.js`, `api/_admin.js`, testes.
- [x] **T5: Geração (M)**
  - O que muda: `gerarSeDevido` (pega o pedido com UPDATE condicional, chama a IA, grava plano e pedido numa instrução, `tentativas`, `erro`), mensalidade direto para `pronto`, `chamarIA` com `fetch`, `vercel.json` com `maxDuration: 60`.
  - Aceite: duas chamadas simultâneas geram uma vez só; falha volta para `pago` e, na segunda, vira `erro`; recusa ou `max_tokens` contam como falha.
  - Verifica: `npm test` com `sql` e `fetch` simulados, mais PGlite.
  - Arquivos: `api/_pedido.js`, `api/_ia.js`, `api/app.js`, `vercel.json`, testes.

**Checkpoint 2:** antes de qualquer chamada real à IA, você aprova. Cada geração custa por volta de US$ 0,05 a 0,10.

### Fase 3: telas

- [x] **T6: Formulário `js/pedido.js` (M)**
  - O que muda: etapas, validação por etapa, barra de progresso, rascunho no `localStorage`, fotos reduzidas no aparelho, resumo com Editar e envio.
  - Aceite: usável em 360 px e no computador; PAR-Q bloqueia sem liberação, com a explicação; foco e rótulos acessíveis.
  - Verifica: jsdom e `vercel dev`.
- [x] **T7: Perfil e aba Treinos (S)**
  - O que muda: os estados do acesso e do pedido, a consulta a cada 4 s enquanto gera, e o cartão "Como funciona seu plano" com a fase atual.
  - Verifica: jsdom.
- [x] **T8: Admin: aba Pedidos (M)**
  - O que muda: ops `pedidos`, `pedido` (com log), `pedido_pago`, `pedido_gerar_de_novo`, `pedido_cancelar`, o resumo novo e a tela com filtros, detalhe, PAR-Q destacado e fotos ampliáveis.
  - Aceite: marcar como pago aplica o efeito certo com log numa instrução só; não-admin recebe 403 em todas as ops novas (o teste atual cobre `OPS`).
  - Verifica: `npm test`, PGlite e jsdom.

**Checkpoint 3:** fluxo completo no `vercel dev`: pedir, marcar como pago, gerar, ver o treino, vencer e renovar.

### Fase 4: fechamento

- [x] **T9: README, os 4 agentes, correções e go/no-go (S)**

## Commits

Um por tarefa, **só quando você pedir**: você pediu para não fazer commit ainda.

## Riscos

| Risco | Impacto | Como reduzir |
|---|---|---|
| A geração passa de 60 s | Alto | Effort `medium`, uma tentativa por chamada (D3), e medir na primeira chamada real. Se passar, usar `effort: "low"` ou tirar as fotos. |
| Prompt injection pelos campos livres | Médio | Texto só na mensagem do usuário, delimitado e escapado; schema com `enum` de exercícios; `validarPlanoIA`; o plano não muda preço nem acesso. |
| Dados de saúde e fotos (LGPD) | Médio | Consentimentos gravados; fotos fora de listas; visualização registrada no log; prazo de guarda (pergunta 4). |
| Custo da IA | Baixo | Por volta de US$ 0,05 a 0,10 por geração, contra R$ 9,99 ou 4,99 por pedido; o cache reduz a parte fixa. |
| Formato exato do `output_config.format` em HTTP | Baixo | Conferir na página oficial antes da T3 (source-driven-development). |

## Perguntas em aberto

As 5 da spec: PDF por cima do plano de IA, PAR-Q 5 e 7, menores de idade, prazo das fotos e cancelamento de pedido pago.
