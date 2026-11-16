# Plano: pagamento dos pedidos (Pix e cartão pelo InfinitePay)

Spec: [docs/pagamento.md](../docs/pagamento.md). Teste antes do código em toda regra de dinheiro. Um commit por tarefa, sem push.

## Fase 1: regras de dinheiro (puro, teste antes)

- [x] **T1. Preços por meio** (`api/_precos.js`, `api/_pedido.js`, `api/app.js`, testes)
  - O que muda: `PRECOS` com `pix` e `cartao`, `precoDe`, `linkPix(tipo)`, `metodosDisponiveis(tipo)`, e `ABERTOS` com `aguardando_confirmacao`.
  - Na criação: `metodo` vazio e o valor do Pix como provisório.
  - Aceite:
    - o preço de cada meio e tipo; meio sem variável não aparece; tipo ou meio desconhecido (`toString`, `__proto__`) é recusado;
    - sem o link do valor do pedido, o Pix não aparece para aquele tipo;
    - URL fora de `https://nubank.com.br/cobrar/` é recusada;
    - inicial e mensalidade usam `PIX_LINK_999`, novo_treino usa `PIX_LINK_499`.
- [x] **T3. Termo nova versão** (`api/_termo.js`, testes)
  - Aceite: o item 5 com o texto novo, os valores do texto batendo com `PRECOS`, e a versão anterior ainda na lista.

**Checkpoint 1:** `npm test` verde.

## Fase 2: pagamento de ponta a ponta no servidor

- [x] **T4. Banco e Pix** (`api/app.js` schema, `api/_pagamento.js`, `api/_pedido.js` limparPedidos, testes)
  - Colunas, restrição de status e índice único novo, numa migração idempotente.
  - Ações `pagamento`, `pedido_metodo` e `pix_avisei`; `aplicarPagamento`.
  - Aceite:
    - trocar de meio recalcula o valor, e depois de pago nada muda;
    - o "Já paguei" só vale no pedido da própria conta, com Pix e com comprovante; o ID da transação informado é opcional e, se vier, precisa estar no formato;
    - o usuário não consegue chegar a `pago` por nenhuma ação;
    - a regra dos 30 dias não cancela `aguardando_confirmacao`;
    - o comprovante é apagado em 90 dias.
- [x] **T5. Admin Pix** (`api/_admin.js`, testes)
  - O que muda: `pix_confirmar` (com o ID da transação obrigatório, gravado em `pix_e2e`) e `pix_nao_encontrado`, e o resumo com `pixAguardando`.
  - Aceite:
    - confirmar duas vezes não soma 60 dias;
    - ID da transação em formato inválido é recusado; ID já usado em outro pedido é recusado com "Este Pix já confirmou o pedido X"; a confirmação grava o ID;
    - "Não encontrei" volta o status com a mensagem e grava o log;
    - só admin (403).
- [x] **T6. Cartão** (`api/_pagamento.js`, `api/infinitepay.js`, `api/app.js`, `api/_admin.js`, `vercel.json`, testes)
  - Ações `pagar_cartao`, `confirmar_cartao` e `cartao_verificar`; o webhook.
  - Aceite:
    - corpo forjado (o `payment_check` diz que não foi pago) é ignorado;
    - valor menor é recusado;
    - `transaction_nsu` repetido não paga duas vezes;
    - pedido de Pix chegando no webhook é ignorado;
    - `confirmar_cartao` com pedido de outra conta é recusado;
    - erro temporário do `payment_check` faz o webhook responder 400.

**Checkpoint 2:** SQL real no PGlite e o fluxo do webhook com `fetch` simulado. Depois, **com a sua aprovação**, crio um link real no InfinitePay (grátis) para confirmar o campo da resposta (P2).

## Fase 3: telas

- [x] **T7. Tela "Como quer pagar?", Pix (botão do link numa aba nova, `rel="noopener noreferrer"`) e "Já paguei"** (`js/pagamento.js`, baixado só quando abre, e `js/app.js` no Perfil, no Renovar e no "Pagar")
- [x] **T8. Volta do cartão** (`js/app.js`): ler os parâmetros, chamar `confirmar_cartao`, limpar a URL, mostrar "ainda não confirmado" com as duas opções.
- [x] **T9. Admin** (`js/admin.js`): aviso de Pix aguardando, filtro do status novo, detalhe com comprovante e o valor esperado em destaque ao lado, campo do ID da transação (com o ID informado pela pessoa lado a lado) e os botões.

**Checkpoint 3:** jsdom do fluxo completo (pedir, escolher Pix, avisar, admin confirmar; pedir, escolher cartão, voltar com os parâmetros, confirmar).

## Fase 4: fechamento

- [x] **T10. README** (variáveis) e os 4 agentes em paralelo, com a análise de fraude pedida ao security-auditor; correções; go/no-go.

## Fase 5: Pix pelo checkout do InfinitePay (mudança de decisão de 2026-11-16)

O Pix manual (link do Nubank + comprovante) sai. Pix e cartão passam a ser links do InfinitePay, confirmados pelo `payment_check`.
Nenhuma migração destrutiva. Commits de remoção separados; histórico intacto.

- [x] **T11. Spec e plano** (`docs/pagamento.md`, este arquivo).
- [x] **T12. Remover o Pix manual no servidor** (`api/_precos.js`, `api/_pagamento.js`, `api/_admin.js`, `api/app.js`, testes)
  - Saem `linkPix`, `PIX_LINK_*`, `PIX_TITULAR_EXIBIDO`, `pedido_metodo`, `pix_avisei`, `lerE2E`/`dataDoE2E`, `pix_confirmar`,
    `pix_nao_encontrado`, `pixAguardando`, `mensagem_usuario` na resposta.
  - Aceite: ações e ops removidas respondem "Ação desconhecida." / "Operação desconhecida."; pedido em `aguardando_confirmacao` ainda cancela.
- [x] **T13. Link por meio e confirmação genérica** (`api/_pagamento.js`, `api/_admin.js`, `api/app.js`, `api/infinitepay.js`, testes antes)
  - `checkout_url_pix`; `pagar { id, metodo }`; `confirmar_pagamento`; `confirmarPagamento` com mínimo pelo link mais barato,
    `valor` do `payment_check`, `capture_method` real, valor menor registrado; `pedido_verificar`; detalhe com meio diferente.
  - Aceite: os testes da spec (preço por meio, reaproveitar link, meio diferente aceito e marcado, valor menor recusado e registrado,
    dois links confirmam uma vez só, 30 dias).
- [ ] **T14. Telas** (`js/pagamento.js`, `js/app.js`, `js/admin.js`, `css/style.css`): remover o Pix manual; os dois botões levam ao checkout;
  admin sem conferência de Pix, com "meio diferente" e "Cancelar pedido" no pedido antigo.
- [ ] **T15. Termo 2026-11-16-2** (4.2, 5.3, 5.4) e teste.
- [ ] **T16. README** (fluxo e variáveis).
- [ ] **T17. Os 4 agentes em paralelo** (fraude pelo security-auditor), correções, go/no-go. Checkpoints PGlite e jsdom atualizados.

**Depois:** você habilita o checkout externo no InfinitePay e eu rodo o teste com link real (P2).

## Riscos

| Risco | Impacto | Como reduzir |
|---|---|---|
| Webhook forjado | Alto | Nunca usa o corpo; só o `payment_check` com o handle do servidor; UPDATE condicional; `transaction_nsu` único |
| Dois cliques ou webhook repetido | Alto | Condição de status no UPDATE, pagamento e log numa instrução |
| Valor alterado no navegador | Alto | O valor sai sempre de `PRECOS` no servidor; o `payment_check` compara `paid_amount` com `pedido.valor` |
| Pagar o cartão depois de trocar para Pix | Médio | P3 |
| Campo da resposta de `/links` | Médio | P2: um link real antes de liberar |
| Link criado por terceiro com valor baixo (o `handle` é público) | Alto | Valor mínimo pelo link mais barato do pedido; dinheiro registrado para devolver |
| Cartão pagando o link do Pix | Baixo | Aceito e marcado no admin (P9) |
| Comprovante antigo com dado pessoal (LGPD) | Baixo | Continua apagado em 90 dias |
