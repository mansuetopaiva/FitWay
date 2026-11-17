# Spec: Pagamento dos pedidos (Pix e cartão pelo checkout do InfinitePay)

## Objetivo

Todo pedido (inicial, mensalidade, novo_treino) é pago pelo checkout do InfinitePay, por Pix ou cartão de crédito, e confirmado
automaticamente pelo `payment_check`. Nenhuma confirmação é manual.

**Mudança de decisão (2026-11-16):** o Pix pelo link de cobrança do Nubank, com comprovante conferido pelo admin, saiu. Motivo:
comprovante pode ser falso, e a liberação precisa ser automática e segura. As colunas e o status usados por ele continuam no banco
(nenhuma migração destrutiva); o código só deixa de usá-los.

**Mudança de decisão (preço único):** o InfinitePay não deixa travar o link no Pix, então preço diferente no cartão não se sustenta.
Um preço por tipo, qualquer que seja o meio, e um link por pedido; a pessoa escolhe Pix ou cartão na página do checkout. O meio real
(`capture_method`) aparece no admin só como informação. Sai a marcação "Pago com meio diferente do escolhido" (a antiga P9).

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
PRECOS = { inicial: 999, mensalidade: 999, novo_treino: 499 } // centavos, qualquer que seja o meio
pagamentoDisponivel()  // INFINITEPAY_HANDLE e SITE_URL
precoDe(tipo)          // centavos ou undefined
```

- Sem as duas variáveis, a tela mostra "Pagamento indisponível no momento".
- **Criação do pedido:** `metodo = null` e `valor = PRECOS[tipo]`. `metodo` não é mais gravado (fica o de pedidos antigos).
- `ABERTOS` continua com `aguardando_confirmacao` (pedido antigo nesse status ainda bloqueia um pedido novo até o admin cancelar).

### Banco

Coluna nova em `pedidos` (`add column if not exists`):
- `checkout_url_pix text`: o link de Pix de pedidos antigos (preço por meio). Não é mais gravado.

`checkout_url` é o link do pedido (um por pedido). Pedidos antigos podem ter `checkout_url` (preço do cartão) e `checkout_url_pix`.

Ficam no banco, sem uso pelo código novo: `pagador_nome`, `comprovante`, `aviso_em`, `pix_e2e`, `pix_e2e_informado`, `mensagem_usuario`
e o valor `aguardando_confirmacao` do `check`. A limpeza de 90 dias continua apagando `comprovante` e `pagador_nome` antigos.

### Ações do usuário (`api/app.js`, lógica em `api/_pagamento.js`)

- **`pagamento { id }`:** só pedido da própria conta. Devolve `{ pedido: { id, tipo, status, metodo, valor }, valor: PRECOS[tipo], disponivel }`.
- **`pagar { id }`** (um `metodo` no corpo é ignorado):
  - só pedido da própria conta, em `aguardando_pagamento`, com `pagamentoDisponivel()`;
  - grava `valor = PRECOS[tipo]` num UPDATE condicional (`status = 'aguardando_pagamento'`);
  - se o pedido já tem link (`checkout_url`, ou o `checkout_url_pix` de um pedido antigo), devolve o mesmo sem chamar o InfinitePay;
  - senão chama `/links` com o preço do tipo e `order_nsu = id`, grava em `checkout_url` com `coalesce` (dois cliques: fica o primeiro);
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
6. **valor:** `base` = `PRECOS[tipo]` (vale também para os links antigos de Pix e de cartão). Exige `amount` (o valor do link pago) `≥ base` e `paid_amount ≥ max(base, amount)`. Sem `amount`, ou abaixo
   disso → "recusado", **e o dinheiro fica registrado** no mesmo `admin_log` (motivo `valor_menor`) para devolver.
   **Não ligue o desconto do Pix nas configurações do checkout:** com ele, `paid_amount < amount` e todo Pix seria recusado;
7. pagamento que já está no `admin_log` para devolução → "recusado": nunca confirma outro pedido depois (o admin pode já ter
   devolvido, e o `payment_check` pode não amarrar o `order_nsu`, P8);
8. aplica o pagamento (`aplicarPagamento`): `status`, `pago_em`, `valor` = `amount` do `payment_check` (ou `paid_amount` se não vier),
   `transaction_nsu`, `checkout_slug`, `capture_method` real, `confirmado_por = 'infinitepay'`, dias de acesso e `admin_log`, numa
   instrução com UPDATE condicional pelo status aberto. `metodo` não muda. `transaction_nsu`/slug já usado (23505) →
   "ignorado"; fechou entre a leitura e a gravação → "sobra".

**Meio:** o checkout aceita Pix e cartão em qualquer link; o pagamento vale em qualquer meio, desde que o valor bata (passo 6). O
`capture_method` real fica gravado e aparece no admin só como informação.

**Dois links do mesmo pedido (só pedidos antigos):** o primeiro pago confirma; o segundo encontra o pedido fechado e vira "sobra" (devolver). O UPDATE
condicional e os `unique` de `transaction_nsu` e `checkout_slug` garantem uma confirmação só.

**Webhook `api/infinitepay.js`:** só POST; nunca usa `amount` nem `paid` do corpo; lê `order_nsu`, `transaction_nsu` e `invoice_slug`
e chama `confirmarPagamento`; 200 (processado ou ignorado) ou 400 (temporário).

### Admin (`api/_admin.js`, `js/admin.js`)

- `pedido_verificar { id }` (era `cartao_verificar`): roda o `payment_check` de novo com o `checkout_ref` guardado.
- Detalhe do pedido: se tem link, transação, meio pago (`capture_method`, só informação) e quem confirmou.
- Resumo: aviso dos pagamentos para devolver dos últimos 30 dias (pedido fechado ou valor menor).
- Pedido antigo em `aguardando_confirmacao`: aparece na lista (filtro "Pix a conferir (antigo)") e no detalhe só com "Cancelar pedido",
  mostrando em modo leitura o que a pessoa mandou (nome, data do aviso, ID informado e comprovante), para decidir se devolve.
- **Removidas** (400 "Operação desconhecida."): `pix_confirmar`, `pix_nao_encontrado`, `cartao_verificar`. Sai também o aviso de Pix
  aguardando do topo do painel e do menu.

### Devoluções (estorno e "Marcar como devolvido")

O dinheiro é sempre devolvido pelo dono no app do InfinitePay; o app só registra e desfaz o efeito.

- **`pedido_estornar { id, motivo, texto? }`** (botão "Registrar devolução e cancelar", em pedido `pago`, `pronto` ou `erro`, ou
  `cancelado` que tinha sido pago, `pago_em` preenchido):
  `motivo` = `desistencia` ("Desistência em 7 dias"), `duplicado` ("Pagamento duplicado") ou `outro` (com `texto` de 1 a 200 caracteres).
  Numa instrução: `status = 'cancelado'`, `estornado_em` e `estornado_por` (colunas novas); tira do acesso os dias que **este** pedido deu
  (`inicial` e `mensalidade`: 30; `novo_treino`: 0), com `least(acesso_ate, greatest(now(), acesso_ate - dias))` (nunca antes de agora,
  nunca aumenta). **Limite conhecido:** os 30 dias saem do fim do acesso atual; se o pedido estornado for antigo e já usado, quem perde
  dias é o pagamento mais novo (o pedido não guarda o período que cobriu). Se `dados.plano.pedido` é este pedido, o treino sai da conta
  (continua em `pedidos.plano_gerado`) e volta o do pedido `pronto` anterior não estornado, se houver; `admin_log`
  `pedido_estornado` com valor, dias, motivo e se o treino saiu. Condição `estornado_em is null`: o segundo clique não desconta de novo.
  `erro` entra porque também é pedido pago.
- **`devolucao_marcar { transaction_nsu }`** (botão "Marcar como devolvido" na lista "para devolver"): grava `admin_log` `devolvido`
  só se o pagamento está na lista e ainda não foi marcado (índice único `admin_log_devolvido` contra dois cliques); a lista do resumo deixa de mostrá-lo.
- Pagamento em dobro do mesmo pedido: o segundo vai para "Pagamentos para devolver"; resolve com "Marcar como devolvido", sem estornar o pedido.
- A receita do mês não conta pedidos estornados.

### Telas

- **Pagamento** (depois de enviar o pedido, no Renovar e no "Pagar" do Perfil): um botão "Pagar R$ 9,99" (R$ 4,99 no novo treino),
  valor vindo do servidor, e a frase "Você escolhe Pix ou cartão na página segura da InfinitePay e volta para cá depois de pagar."
  O botão chama `pagar` e leva ao checkout (`location.href`).
- **Volta do checkout:** o app lê `order_nsu`, `transaction_nsu` e `slug`, guarda no `sessionStorage`, limpa a URL com
  `history.replaceState` e chama `confirmar_pagamento` uma vez.
- **Voltou do checkout com os parâmetros, sem pagamento confirmado:** "Pagamento ainda não confirmado", com "Já paguei, verificar",
  "Abrir o pagamento de novo" (o mesmo link). Quem volta pelo botão Voltar (sem parâmetros) vê o botão "Pagar" de novo, que reaproveita o link.
- Saem da tela: código do pedido, `PIX_TITULAR_EXIBIDO`, link do Nubank, "Já paguei" com comprovante e ID da transação.
- **Perfil** com pedido antigo em `aguardando_confirmacao`: "Seu pedido está em análise." (sem prazo).

### Prazos (`limparPedidos`)

- `aguardando_pagamento` há mais de 30 dias (de `greatest(criado, aviso_em)`) → `cancelado`, com fotos apagadas.
- Fotos (e comprovante e nome de pedidos antigos) apagados 90 dias depois de pronto, cancelado ou erro.

### Termo (versão `2026-11-16-3`)

Igual à `2026-11-16-2` (que pode já ter sido aceita), trocando:
- 5.1: "O primeiro treino custa R$ 9,99, pago por Pix ou cartão de crédito, e inclui 30 dias de acesso. Para continuar vendo o treino,
  pago a mensalidade de R$ 9,99 a cada 30 dias. Sem o pagamento, o treino deixa de aparecer no app até eu renovar. Meus check-ins e meu
  histórico continuam guardados."
- 5.2: "Depois de 8 semanas do plano, com o acesso em dia, posso pedir um novo treino por R$ 4,99."

### Termo (versão `2026-11-16-2`)

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

- um link por pedido com o preço do tipo; o segundo clique reaproveita; pedido antigo reaproveita o link de Pix ou de cartão;
- qualquer meio é aceito e o `capture_method` real é gravado;
- valor pago menor que o do link, ou que o preço do tipo, é recusado e registrado para devolução (links antigos de R$ 11,99 incluídos);
- os dois links de um pedido antigo não confirmam duas vezes (o segundo vira "sobra");
- tela com um botão só ("Pagar R$ 9,99") e sem a escolha de meio (test-integracao/pagamento_ui.test.mjs);
- ações e ops removidas respondem "Ação desconhecida." / "Operação desconhecida.";
- a regra dos 30 dias;
- continuam: corpo forjado, `order_nsu` trocado, `transaction_nsu`/slug repetido, limite de 10 s, formato inválido;
- SQL real no PGlite e fluxo no jsdom em `test-integracao/` (`npm run test:integracao`).

## Análise de fraude

| Ataque | Barreira |
|---|---|
| Webhook ou volta forjados (`paid: true` no corpo) | Só o `payment_check` com o `handle` do servidor decide |
| Criar um link próprio de R$ 1,00 com o `order_nsu` de um pedido (o `handle` é público) e pagar, até parcelado com juros | `amount` obrigatório e mínimo (passo 6); o dinheiro fica registrado para devolver |
| Reusar em outro pedido um pagamento que ficou para devolução | Passo 7 |
| Pagar com outro meio | Não importa: preço único; o meio real fica no admin como informação |
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
3. **P10. Desconto do Pix nas configurações do checkout (decidido pelo dono em 2026-11-16: não ligar).** Com ele, `paid_amount < amount`
   e todo Pix seria recusado (passo 6).

Decididas e encerradas pela mudança: P1 (recebedor do Pix), P3 (trocar de cartão para Pix), P4 (ID da transação do Pix).
P9 (cartão pagando o link do Pix) deixou de existir com o preço único.
P5 (`checkout_ref`), P6 (botão sem parcelas) e P7 (versão `2026-11-16-2`) continuam valendo.
