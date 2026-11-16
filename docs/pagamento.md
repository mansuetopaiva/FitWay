# Spec: Pagamento dos pedidos (Pix e cartão pelo checkout do InfinitePay)

## Objetivo

Todo pedido (inicial, mensalidade, novo_treino) é pago pelo checkout do InfinitePay, por Pix ou cartão de crédito, e confirmado
automaticamente pelo `payment_check`. Nenhuma confirmação é manual.

**Mudança de decisão (2026-11-16):** o Pix pelo link de cobrança do Nubank, com comprovante conferido pelo admin, saiu. Motivo:
comprovante pode ser falso, e a liberação precisa ser automática e segura. As colunas e o status usados por ele continuam no banco
(nenhuma migração destrutiva); o código só deixa de usá-los.

**Fora do escopo:** a IA, o formulário e as regras de acesso. O pagamento só chama `efeitoDoPagamento()`, que já existe.
**Nunca no código:** dado pessoal do dono. Tudo que é dele vem de variável de ambiente.

## Fontes

Documentação do Checkout InfinitePay (https://www.infinitepay.io/checkout-documentacao), lida em 2026-11-16:
- `POST https://api.checkout.infinitepay.io/links` com `handle` (InfiniteTag sem `$`), `items: [{ quantity, price, description }]`
  (preço em centavos, mínimo 100, "inclusive links criados pela API e Pix"), `order_nsu`, `redirect_url`, `webhook_url` (formato
  simples do FAQ) e `customer: { name, email, phone_number }`;
- **meio de pagamento por link:** só com API Key, em `options.payment_methods_enabled`. Texto da documentação: "O cartão fica sempre
  ligado. Só o Pix pode ser ligado ou desligado." e "Não dá para desligar o cartão." Ou seja, **não existe link só de Pix**, e o
  projeto usa o `handle`, sem API Key. Consequência: no checkout de qualquer link a pessoa pode pagar por Pix ou por cartão (ver "Meio diferente");
- a volta para o `redirect_url` traz `receipt_url`, `order_nsu`, `slug`, `capture_method` (`credit_card` ou `pix`) e `transaction_nsu`;
- o webhook traz `invoice_slug`, `amount`, `paid_amount`, `installments`, `capture_method`, `transaction_nsu`, `order_nsu`, `receipt_url`
  e `items`. Ele **não é assinado**. Qualquer resposta fora de 2xx é reenviada;
- `POST https://api.checkout.infinitepay.io/payment_check` recebe `{ handle, order_nsu, transaction_nsu, slug }` e devolve
  `{ success, paid, amount, paid_amount, installments, capture_method }`;
- `paid_amount` pode ser maior que `amount` (juros do parcelamento pagos pelo comprador);
- a resposta de `/links` traz a URL no campo `url` (confirmado com link real, P2).

## Contrato

### Preços e meios (`api/_precos.js`)

```js
PRECOS = { pix: { inicial: 999, mensalidade: 999, novo_treino: 499 }, cartao: { inicial: 1199, mensalidade: 1199, novo_treino: 599 } } // centavos
metodosDisponiveis(tipo) // ["pix", "cartao"] com INFINITEPAY_HANDLE e SITE_URL; senão []
precoDe(metodo, tipo)    // centavos ou undefined
```

- Sem as duas variáveis, a tela mostra "Pagamento indisponível no momento".
- **Criação do pedido:** `metodo = null` e `valor = PRECOS.pix[tipo]` (provisório, só para a lista do admin).
- `ABERTOS` continua com `aguardando_confirmacao` (pedido antigo nesse status ainda bloqueia um pedido novo até o admin cancelar).

### Banco

Coluna nova em `pedidos` (`add column if not exists`):
- `checkout_url_pix text`: o link do InfinitePay criado com o preço do Pix.

`checkout_url` continua sendo o link criado com o preço do cartão (pedidos antigos já o têm). Um pedido tem no máximo um link por meio.

Ficam no banco, sem uso pelo código novo: `pagador_nome`, `comprovante`, `aviso_em`, `pix_e2e`, `pix_e2e_informado`, `mensagem_usuario`
e o valor `aguardando_confirmacao` do `check`. A limpeza de 90 dias continua apagando `comprovante` e `pagador_nome` antigos.

### Ações do usuário (`api/app.js`, lógica em `api/_pagamento.js`)

- **`pagamento { id }`:** só pedido da própria conta. Devolve `{ pedido: { id, tipo, status, metodo, valor }, metodos: [{ metodo, valor }] }`.
- **`pagar { id, metodo }`:**
  - só pedido da própria conta, em `aguardando_pagamento`, com `metodo` em `metodosDisponiveis(tipo)`;
  - grava `metodo` e `valor = precoDe(metodo, tipo)` num UPDATE condicional (`status = 'aguardando_pagamento'`);
  - se já existe o link daquele meio, devolve o mesmo (`{ url }`) sem chamar o InfinitePay;
  - senão chama `/links` com o preço do meio e `order_nsu = id`, grava com `coalesce` (dois cliques: fica o primeiro) e devolve `{ url }`;
  - trocar de meio cria o link do outro meio **sem apagar o primeiro**;
  - resposta sem URL `https://…infinitepay.io/` válida, erro de rede ou 4xx/5xx → 502 "Pagamento indisponível no momento.".
- **`confirmar_pagamento { order_nsu, transaction_nsu, slug }`:** o pedido precisa ser da conta logada; roda `confirmarPagamento`.
- **Removidas** (respondem 400 "Ação desconhecida."): `pedido_metodo`, `pix_avisei`, `pagar_cartao`, `confirmar_cartao`.
- **Nenhuma ação do usuário grava `pago`.**

### Confirmação (`confirmarPagamento(sql, { order_nsu, transaction_nsu, slug }, { fetch })`)

1. valida o formato dos três (nunca chama o InfinitePay com dado fora do formato);
2. carrega o pedido que tem algum link (`checkout_url` ou `checkout_url_pix`), em qualquer status. Não existe, ou este
   `transaction_nsu` já foi aplicado nele → "ignorado";
3. no máximo uma consulta a cada 10 s por pedido (`checado_em`); antes disso → "temporário";
4. `payment_check` com o `handle` do servidor:
   - rede, 5xx ou 429 → "temporário" (o webhook responde 400 e o InfinitePay reenvia);
   - `success !== true` ou `order_nsu` da resposta diferente → "recusado";
   - reconhecido: guarda o par em `checkout_ref` (para o admin verificar de novo); `paid !== true` → "recusado";
5. pedido já fechado e pago de verdade → **"sobra"**: um `admin_log` `cartao_sem_pedido` (motivo `pedido_fechado`) por
   `transaction_nsu` (um 2º pagamento no mesmo link também conta), e o resumo do admin avisa para devolver;
6. **valor:** `base` = o menor preço entre os links que o pedido tem (com link de Pix, `PRECOS.pix[tipo]`; só com link de cartão,
   `PRECOS.cartao[tipo]`). Exige `amount` (o valor do link pago) `≥ base` e `paid_amount ≥ max(base, amount)`. Sem `amount`, ou abaixo
   disso → "recusado", **e o dinheiro fica registrado** no mesmo `admin_log` (motivo `valor_menor`) para devolver.
   **Não ligue o desconto do Pix nas configurações do checkout:** com ele, `paid_amount < amount` e todo Pix seria recusado;
7. pagamento que já está no `admin_log` para devolução → "recusado": nunca confirma outro pedido depois (o admin pode já ter
   devolvido, e o `payment_check` pode não amarrar o `order_nsu`, P8);
8. aplica o pagamento (`aplicarPagamento`): `status`, `pago_em`, `valor` = `amount` do `payment_check` (ou `paid_amount` se não vier),
   `transaction_nsu`, `checkout_slug`, `capture_method` real, `confirmado_por = 'infinitepay'`, dias de acesso e `admin_log`, numa
   instrução com UPDATE condicional pelo status aberto. `metodo` continua o escolhido. `transaction_nsu`/slug já usado (23505) →
   "ignorado"; fechou entre a leitura e a gravação → "sobra".

**Meio diferente do escolhido:** como o checkout aceita os dois meios em qualquer link, o pagamento confirmado é aceito em qualquer
meio, desde que o valor bata (passo 6). O `capture_method` real fica gravado e o admin marca quando ele difere do `metodo` escolhido.
Nunca se recusa um pagamento confirmado por causa do meio.

**Dois links do mesmo pedido:** o primeiro pago confirma; o segundo encontra o pedido fechado e vira "sobra" (devolver). O UPDATE
condicional e os `unique` de `transaction_nsu` e `checkout_slug` garantem uma confirmação só.

**Webhook `api/infinitepay.js`:** só POST; nunca usa `amount` nem `paid` do corpo; lê `order_nsu`, `transaction_nsu` e `invoice_slug`
e chama `confirmarPagamento`; 200 (processado ou ignorado) ou 400 (temporário).

### Admin (`api/_admin.js`, `js/admin.js`)

- `pedido_verificar { id }` (era `cartao_verificar`): roda o `payment_check` de novo com o `checkout_ref` guardado.
- Detalhe do pedido: meio escolhido, meio pago (`capture_method`), **"Pago com meio diferente do escolhido"** quando não batem,
  transação, e os links criados (Pix e cartão).
- Resumo: aviso dos pagamentos para devolver dos últimos 30 dias (pedido fechado ou valor menor).
- Pedido antigo em `aguardando_confirmacao`: aparece na lista (filtro "Pix a conferir (antigo)") e no detalhe só com "Cancelar pedido",
  mostrando em modo leitura o que a pessoa mandou (nome, data do aviso, ID informado e comprovante), para decidir se devolve.
- **Removidas** (400 "Operação desconhecida."): `pix_confirmar`, `pix_nao_encontrado`, `cartao_verificar`. Sai também o aviso de Pix
  aguardando do topo do painel e do menu.

### Telas

- **"Como quer pagar?"** (depois de enviar o pedido, no Renovar e no "Pagar" do Perfil): "Pix — R$ 9,99" e "Cartão de crédito — R$ 11,99"
  (R$ 4,99 e R$ 5,99 no novo treino), valores vindos do servidor. Os dois chamam `pagar` e levam ao checkout (`location.href`).
- **Volta do checkout:** o app lê `order_nsu`, `transaction_nsu` e `slug`, guarda no `sessionStorage`, limpa a URL com
  `history.replaceState` e chama `confirmar_pagamento` uma vez.
- **Voltou do checkout com os parâmetros, sem pagamento confirmado:** "Pagamento ainda não confirmado", com "Já paguei, verificar",
  "Abrir o pagamento de novo" (o link do meio escolhido) e "Trocar meio de pagamento". Quem volta pelo botão Voltar (sem parâmetros)
  vê "Como quer pagar?" de novo; escolher o mesmo meio reaproveita o link.
- Saem da tela: código do pedido, `PIX_TITULAR_EXIBIDO`, link do Nubank, "Já paguei" com comprovante e ID da transação.
- **Perfil** com pedido antigo em `aguardando_confirmacao`: "Seu pedido está em análise." (sem prazo).

### Prazos (`limparPedidos`)

- `aguardando_pagamento` há mais de 30 dias (de `greatest(criado, aviso_em)`) → `cancelado`, com fotos apagadas.
- Fotos (e comprovante e nome de pedidos antigos) apagados 90 dias depois de pronto, cancelado ou erro.

### Termo (versão `2026-11-16-2`, ainda não publicada, editada no lugar)

- 4.2: "Para isso, essas informações são enviadas à Anthropic, empresa dos Estados Unidos que fornece o serviço de inteligência artificial
  usado na montagem do plano, e podem ser processadas fora do Brasil. Ao pagar, meu nome e email são enviados à InfinitePay, que processa
  os pagamentos por Pix e cartão. Meus dados não são vendidos nem usados para publicidade."
- 6.1: "Este termo pode ser atualizado. Quando isso acontecer, vou precisar aceitar a nova versão no próximo pedido de treino."
- 4.3: já não citava o comprovante (o item 4 vinha igual ao da versão `2026-11-16`); fica como está.
- 5.3: "Os pagamentos por Pix e por cartão são processados pela InfinitePay e confirmados automaticamente. O acesso e o treino são
  liberados assim que o pagamento é confirmado."
- 5.4: "Pedidos sem pagamento em 30 dias são cancelados, e as fotos enviadas são apagadas."
- O resto do item 5 continua igual. A versão `2026-11-16` (publicada) não muda.

## Variáveis (README)

| Variável | Para quê |
|---|---|
| `INFINITEPAY_HANDLE` | InfiniteTag sem o `$` |
| `SITE_URL` | endereço do site, sem barra no fim (ex.: `https://fitway.vercel.app`) |

`PIX_LINK_999`, `PIX_LINK_499` e `PIX_TITULAR_EXIBIDO` saem (podem ser apagadas na Vercel).

## Testes

- Pix e cartão criam o link com o preço certo do meio; o segundo clique reaproveita; trocar de meio cria o outro sem apagar o primeiro;
- pagamento com meio diferente do escolhido é aceito e o `capture_method` real é gravado (o admin marca);
- valor pago menor que o do link é recusado e registrado para devolução; com link de Pix o mínimo é o preço do Pix;
- os dois links do mesmo pedido não confirmam duas vezes (o segundo vira "sobra");
- ações e ops removidas respondem "Ação desconhecida." / "Operação desconhecida.";
- a regra dos 30 dias;
- continuam: corpo forjado, `order_nsu` trocado, `transaction_nsu`/slug repetido, limite de 10 s, formato inválido;
- SQL real no PGlite e fluxo no jsdom, fora do repositório (sem dependência nova).

## Análise de fraude

| Ataque | Barreira |
|---|---|
| Webhook ou volta forjados (`paid: true` no corpo) | Só o `payment_check` com o `handle` do servidor decide |
| Criar um link próprio de R$ 1,00 com o `order_nsu` de um pedido (o `handle` é público) e pagar, até parcelado com juros | `amount` obrigatório e mínimo (passo 6); o dinheiro fica registrado para devolver |
| Reusar em outro pedido um pagamento que ficou para devolução | Passo 7 |
| Pagar o link do Pix (R$ 9,99) com cartão | Aceito por decisão (o checkout não restringe o meio); marcado no admin |
| Reusar um pagamento em outro pedido | `transaction_nsu` e `checkout_slug` únicos; `order_nsu` da resposta conferido quando vem (P8) |
| Pagar os dois links | O segundo vira "sobra" e é devolvido |
| Martelar o webhook para gastar a cota do InfinitePay | Uma consulta a cada 10 s por pedido |
| Martelar o webhook com o id de um pedido alheio para travar a confirmação dele | Risco baixo aceito: o id tem 96 bits aleatórios e só aparece na volta do checkout; o webhook verdadeiro é reenviado |
| Encher o aviso "devolver" com pagamentos de R$ 1,00 | Risco baixo aceito: custa ao atacante; o aviso mostra os 10 mais recentes |
| Confirmar pedido de outra conta pela volta | `confirmar_pagamento` exige o pedido da conta logada; o webhook é anônimo mas só confirma o que o `payment_check` confirma |

## Limites

- **Sempre:** o servidor decide valor e status; nunca confiar no corpo do webhook; toda confirmação vai para o `admin_log`;
  `transaction_nsu` e `checkout_slug` únicos; dinheiro recebido sem liberar fica registrado para devolução.
- **Perguntar antes:** dependência nova (nenhuma prevista); migração destrutiva; push.
- **Nunca:** dado pessoal no código ou nos testes; o usuário mudar o status para `pago`; chamar o InfinitePay com dado do navegador sem validar o formato.

## Perguntas em aberto

1. **P2. Campo da URL na resposta de `/links` (fechada em 2026-11-16, com link real, sem pagamento):**
   - 1ª tentativa: `404 { success: false, error: "external_checkout_not_enabled" }`; o dono habilitou o checkout externo.
   - 2ª tentativa: os dois links (Pix 999 e cartão 1199, mesmo `order_nsu` de teste) voltaram `200 { "url": "https://checkout.infinitepay.io/<handle>?lenc=<token opaco>.v1.<assinatura>" }`.
     O campo é `url`, a URL passa no filtro do app (`https://…infinitepay.io/`) e a página abre (HTTP 200). Cada link tem um token próprio.
   - O slug **não** aparece na URL do link: só chega na volta do checkout e no webhook (o código já usa só esses).
   - `payment_check` sem pagamento (`order_nsu` certo ou trocado, `transaction_nsu` inventado) → `200 { "success": false }`, como na documentação.
2. **P8. O `payment_check` amarra `order_nsu`, `transaction_nsu` e `slug`?** A documentação não diz, e sem pagamento toda consulta
   responde `success: false`. `transaction_nsu` e `checkout_slug` únicos, a conferência do `order_nsu` da resposta (quando vier) e a recusa
   de pagamento já registrado para devolução barram o reuso. Também falta ver num pagamento real se a resposta traz `amount` (sem ele, o
   pagamento é recusado e vai para devolução: aparece logo no primeiro uso).
3. **P9. Cartão pagando o link do Pix (decidido pelo dono em 2026-11-16: risco aceito).** Aceito, com a marcação "Pago com meio
   diferente do escolhido" no admin. Custa no máximo R$ 2,00 por pedido (R$ 1,00 no novo treino), e qualquer pessoa consegue de propósito.
   Alternativa futura, se virar problema: obter a API Key e usar um link só, no preço do cartão, com `options.discounts.pix`.
4. **P10. Desconto do Pix nas configurações do checkout (decidido pelo dono em 2026-11-16: não ligar).** Com ele, `paid_amount < amount`
   e todo Pix seria recusado (passo 6).

Decididas e encerradas pela mudança: P1 (recebedor do Pix), P3 (trocar de cartão para Pix), P4 (ID da transação do Pix).
P5 (`checkout_ref`), P6 (botão sem parcelas) e P7 (versão `2026-11-16-2`) continuam valendo.
