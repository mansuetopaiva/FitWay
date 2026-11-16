# Spec: Pagamento dos pedidos (Pix manual e cartão pelo InfinitePay)

## Objetivo

Hoje todo pedido (inicial, mensalidade, novo_treino) fica "aguardando pagamento" e o admin marca como pago à mão.
Este passo acrescenta:
- **Pix:** pago por um link de cobrança do Nubank, criado no app do Nubank, com o valor já preenchido. Há um link por valor (R$ 9,99 e R$ 4,99), e o mesmo link serve para todos os pedidos daquele valor. O Nubank de pessoa física não avisa o site, então o admin confere cada pagamento no painel.
- **Cartão:** pago pelo checkout do InfinitePay, com confirmação automática.

**Fora do escopo:** a IA, o formulário e as regras de acesso. O pagamento só chama `efeitoDoPagamento()`, que já existe.
**Nunca no código:** dado pessoal do dono. Tudo que é dele vem de variável de ambiente.

## Fontes

- **Pix:** links de cobrança do Nubank (`https://nubank.com.br/cobrar/...`). O link não identifica o pedido: a conferência usa o ID da transação do Pix (código E2E: "E" + 31 letras ou números, 32 no total), que está no comprovante e no detalhe do Pix recebido no app do Nubank.
- **Cartão:** documentação do Checkout InfinitePay (https://www.infinitepay.io/checkout-documentacao):
  - `POST https://api.checkout.infinitepay.io/links` com `handle` (InfiniteTag sem `$`), `items: [{ quantity, price, description }]` (preço em centavos, mínimo 100), `order_nsu`, `redirect_url`, `webhook_url` (formato simples do FAQ; a seção principal mostra `webhook: { url, events }`) e `customer: { name, email, phone_number }`;
  - a volta para o `redirect_url` traz `receipt_url`, `order_nsu`, `slug`, `capture_method` (`credit_card` ou `pix`) e `transaction_nsu`;
  - o webhook traz `invoice_slug`, `amount`, `paid_amount`, `installments`, `capture_method`, `transaction_nsu`, `order_nsu`, `receipt_url` e `items`. Ele **não é assinado**. Responder 200 rápido; qualquer resposta fora de 2xx é reenviada (a documentação sugere 400 para erro);
  - `POST https://api.checkout.infinitepay.io/payment_check` recebe `{ handle, order_nsu, transaction_nsu, slug }` e devolve `{ success, paid, amount, paid_amount, installments, capture_method }`. Divergência volta como 200 com `success: false` ou `paid: false`;
  - `paid_amount` pode ser maior que `amount` (taxa repassada ao comprador).
  - **A documentação não diz o nome do campo da resposta de `/links` que traz a URL** (ver P2).

## Contrato

### Preços (`api/_precos.js`)

```js
PRECOS = { pix: { inicial: 999, mensalidade: 999, novo_treino: 499 }, cartao: { inicial: 1199, mensalidade: 1199, novo_treino: 599 } } // centavos
linkPix(tipo) // PIX_LINK_<centavos do Pix daquele tipo> se começar com https://nubank.com.br/cobrar/, senão undefined
metodosDisponiveis(tipo) // ["pix", "cartao"], só os que funcionam para aquele tipo
precoDe(metodo, tipo) // centavos ou undefined
```

- **Pix** precisa do link do valor do pedido: `PIX_LINK_999` para inicial e mensalidade, `PIX_LINK_499` para novo_treino.
  - O nome da variável sai do preço (`PIX_LINK_${PRECOS.pix[tipo]}`), então mudar o preço exige um link novo.
  - Link ausente ou fora de `https://nubank.com.br/cobrar/` → o Pix não aparece como opção para aquele pedido.
- **Cartão** precisa de `INFINITEPAY_HANDLE` e `SITE_URL`.
- Sem nenhum meio disponível, a tela mostra "Pagamento indisponível no momento".
- **Criação do pedido:** `metodo = null` e `valor = PRECOS.pix[tipo]` (provisório, o mais barato, só para a lista do admin).
- **Escolher o meio** (`pedido_metodo { id, metodo }`):
  - grava `metodo` e `valor = precoDe(metodo, tipo)` num UPDATE condicional `status = 'aguardando_pagamento'`;
  - pode trocar quantas vezes quiser enquanto não pagou;
  - em qualquer outro status, nada muda.
- `ABERTOS` passa a incluir `aguardando_confirmacao` (no máximo 1 pedido aberto por pessoa).

### Banco

Colunas novas em `pedidos`, com `add column if not exists`:
- `codigo text unique`: "FW" + 6 caracteres de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, gerado na criação;
- `pagador_nome text`, `comprovante text` (data URL JPEG de até ~300 KB), `aviso_em timestamptz`;
- `pix_e2e text`, único sem diferenciar maiúsculas (`unique (upper(pix_e2e))`): o ID da transação do Pix, digitado pelo admin ao confirmar;
- `checkout_slug text unique`: o slug do pagamento de cartão aplicado (o mesmo pagamento não paga dois pedidos, nem com outro `transaction_nsu`);
- `checado_em timestamptz`: última consulta ao `payment_check` deste pedido (no máximo uma a cada 10 s);
- `pix_e2e_informado text`: o ID que a pessoa colou no "Já paguei" (opcional, sem `unique`: é só para conferência);
- `confirmado_por text`, `transaction_nsu text unique`, `capture_method text`, `mensagem_usuario text`;
- `checkout_url text`: o link do InfinitePay, para "Abrir o pagamento de novo";
- `checkout_ref jsonb`: o último `{ slug, transaction_nsu }` que o InfinitePay reconheceu (`success: true`), para o admin conferir de novo (ver P5).

Status e índice:
- o status novo `aguardando_confirmacao` entra na restrição `check` (a migração troca a restrição antiga, uma vez só, num bloco `do $$`);
- o índice único de pedido aberto é recriado com o status novo, com outro nome (`pedidos_um_aberto_v2`); o antigo é removido.

### Ações do usuário (`api/app.js`, lógica em `api/_pagamento.js`)

- **`pagamento { id }`:** só para pedido da própria conta. Devolve:
  - `metodos: [{ metodo, valor }]`;
  - o pedido (`status`, `metodo`, `valor`, `codigo`, `mensagem_usuario`);
  - com Pix: `{ link, recebedor }` (`link` de `linkPix(tipo)`, `recebedor` de `PIX_TITULAR_EXIBIDO`, ou vazio).
- **`pedido_metodo { id, metodo }`:** como descrito acima. Recusa um meio que não está em `metodosDisponiveis(tipo)`.
- **`pix_avisei { id, pagador_nome, comprovante? }`:**
  - só pedido da própria conta, com `metodo = 'pix'` e status `aguardando_pagamento`;
  - nome com 2 a 80 caracteres;
  - comprovante **obrigatório**, só `data:image/jpeg;base64`, até ~300 KB;
  - `pix_e2e` opcional: se vier, precisa estar no formato do E2E (abaixo) e vai para `pix_e2e_informado`;
  - passa para `aguardando_confirmacao`, grava `aviso_em = now()` e limpa `mensagem_usuario`.
- **`pagar_cartao { id }`:**
  - só pedido da própria conta, em `aguardando_pagamento`;
  - grava `metodo = 'cartao'` e o valor do cartão;
  - chama `/links`, guarda `checkout_url` e devolve `{ url }`.
- **`confirmar_cartao { order_nsu, transaction_nsu, slug }`:**
  - o `order_nsu` precisa ser um pedido da conta logada;
  - roda a mesma verificação do webhook.
- **Nenhuma ação do usuário grava `pago`.** Só `confirmarPix` (admin) e `confirmarCartao` (resultado verificado do `payment_check`) fazem isso.

### Confirmação (`api/_pagamento.js`, tudo numa instrução SQL)

`aplicarPagamento(sql, pedido, { quem, transaction_nsu?, capture_method? })`:
- UPDATE condicional `where id = $1 and status in (<de onde pode vir>)`. Para cartão, também `metodo = 'cartao' and transaction_nsu is null`;
- `status = pago` (ou `pronto` na mensalidade), `pago_em = now()`, `confirmado_por`;
- `acesso_ate = greatest(now(), acesso_ate) + dias`;
- `admin_log`.

Sem linha devolvida, não faz nada. Dois cliques ou um webhook repetido nunca somam 60 dias. O `transaction_nsu unique` barra o mesmo pagamento em dois pedidos.

- **Pix (admin):**
  - `pix_confirmar { id, pix_e2e }` aceita pedido em `aguardando_confirmacao` ou `aguardando_pagamento` (o admin pode ter visto o Pix antes do aviso), com qualquer meio escolhido (a pessoa pode ter pagado o Pix e depois trocado para cartão);
  - a data do Pix vem no próprio ID (`E` + ISPB + `yyyyMMddHHmm` + 11): ID com data mais de 1 dia antes do pedido, mais de 1 dia no futuro ou impossível → 400. A folga de 1 dia cobre o fuso, que o padrão não deixa claro;
  - **`pix_e2e` obrigatório**, copiado do app do Nubank. Formato: `/^E[A-Za-z0-9]{31}$/` (espaços nas pontas são removidos; espaço no meio é recusado). Fora do formato → 400 "ID da transação inválido.";
  - grava `pix_e2e` no mesmo UPDATE do pagamento (vai também para o `admin_log`);
  - ID já gravado em outro pedido (mesmo com outra caixa) → 400 "Este Pix já confirmou o pedido X" (400 e não 409: no app, 409 é só a troca de conta), com X o `codigo` daquele pedido. O `unique` do banco barra a corrida entre dois cliques;
  - `pix_nao_encontrado` volta `aguardando_confirmacao → aguardando_pagamento`, com `mensagem_usuario = "Não encontramos seu Pix. Confira o valor e o código e avise de novo."`, e grava o log.
- **Cartão:** `confirmarCartao(sql, { order_nsu, transaction_nsu, slug }, { fetch })`:
  1. valida o formato dos três;
  2. carrega o pedido que tem ou teve link de cartão, em qualquer status: não existe, não é cartão, ou este `transaction_nsu` já foi aplicado nele → "ignorado" (200);
  3. no máximo uma consulta a cada 10 s por pedido (o webhook não tem assinatura nem login); antes disso → "temporário";
  4. `payment_check`:
     - erro de rede, 5xx ou 429 → "temporário" (o webhook responde 400 e o InfinitePay reenvia);
     - `success !== true` ou `order_nsu` da resposta diferente → "recusado" (sem trocar o `checkout_ref`);
     - reconhecido: grava o par em `checkout_ref`; `paid !== true` → "recusado";
  5. pedido já fechado (cancelado, pago por Pix, link pago duas vezes) e pago de verdade → "sobra": um `admin_log` `cartao_sem_pedido` por pagamento, e o resumo do admin avisa para devolver;
  6. `paid_amount` (e `amount`, se vier) menor que o preço do cartão do tipo → "recusado";
  7. aplica o pagamento com `transaction_nsu`, `checkout_slug` e `capture_method`. `transaction_nsu` ou slug já usado (23505) → "ignorado". O pedido fechou entre a leitura e a gravação → "sobra".
- **Webhook `api/infinitepay.js`:**
  - só POST JSON; nunca usa `amount` nem `paid` do corpo;
  - lê `order_nsu`, `transaction_nsu` e `invoice_slug` e chama `confirmarCartao`;
  - responde 200 (processado ou ignorado) ou 400 (temporário).
- **Admin, `cartao_verificar { id }`:** roda o `payment_check` de novo com o `checkout_ref` guardado.

### Telas

- **"Como quer pagar?"** abre depois de enviar o pedido e no botão Renovar:
  - duas opções lado a lado: "Pix — R$ 9,99" e "Cartão — R$ 11,99 (até 12x)", com os valores vindos do servidor;
  - "Pagar" no Perfil volta para esta tela.
- **Pix:**
  - o valor;
  - botão "Pagar R$ X com Pix", um link `<a href target="_blank" rel="noopener noreferrer">` para `linkPix(tipo)` (o `href` é atribuído pelo DOM, nunca montado em HTML);
  - o código do pedido, para a pessoa anotar, e o nome do recebedor (`PIX_TITULAR_EXIBIDO`, ver P1);
  - instruções: "1. Pague pelo link (o valor já vem preenchido). 2. Volte aqui, anexe o comprovante e toque em Já paguei. A confirmação é feita em até 24 horas.";
  - **"Já paguei":** nome de quem pagou (vem preenchido com o nome da conta), comprovante obrigatório (reduzido no aparelho como as fotos) e o campo opcional "ID da transação (está no comprovante, começa com E)". Sem comprovante, o botão fica desativado.
- **Perfil:**
  - com `aguardando_confirmacao`: "Recebemos seu aviso. Estamos conferindo o Pix (até 24 horas).";
  - com `mensagem_usuario`, a mensagem aparece.
- **Cartão:**
  - `location.href = url`;
  - na volta, o app lê os parâmetros, chama `confirmar_cartao`, limpa a URL com `history.replaceState` e mostra o status;
  - sem pagamento: "Pagamento ainda não confirmado", com "Já paguei, verificar" e "Abrir o pagamento de novo".
- **Admin:**
  - aviso no topo com a quantidade de Pix aguardando confirmação, com link para eles;
  - aviso dos pagamentos de cartão sem pedido aberto dos últimos 30 dias (para devolver pelo InfinitePay);
  - detalhe com código, pagador, data do aviso e comprovante (que amplia ao tocar), com o **valor esperado em destaque ao lado do comprovante**, para conferir rápido;
  - "Confirmar Pix recebido" abre o campo "ID da transação" (obrigatório). Se a pessoa informou um ID, ele aparece lado a lado com o campo, para bater com o Nubank;
  - botões "Confirmar Pix recebido" e "Não encontrei o Pix", e "Verificar no InfinitePay" no pedido de cartão.

### Prazos (`limparPedidos`)

- A regra dos 30 dias **não** cancela `aguardando_confirmacao`, e conta de `greatest(criado, aviso_em)`: depois de "Não encontrei o Pix", a pessoa tem 30 dias a partir do aviso.
- O comprovante e o nome de quem pagou são apagados junto com as fotos:
  - 90 dias depois de `pronto` (contando de `coalesce(gerado_em, pago_em)`: a mensalidade vira pronto sem `gerado_em`);
  - ou de `cancelado`/`erro`.

### Termo

Versão nova no topo, com o item 5 trocado pelo texto do pedido; a `2026-11-16` continua na lista. Um teste confere que os valores do texto batem com `PRECOS`.

## Variáveis (README)

| Variável | Para quê |
|---|---|
| `PIX_LINK_999` | link de cobrança do Nubank de R$ 9,99 (inicial e mensalidade). Precisa começar com `https://nubank.com.br/cobrar/` |
| `PIX_LINK_499` | link de cobrança do Nubank de R$ 4,99 (novo_treino). Mesma regra |
| `PIX_TITULAR_EXIBIDO` | nome mostrado na tela do Pix como recebedor (opcional) |
| `INFINITEPAY_HANDLE` | InfiniteTag sem o `$` |
| `SITE_URL` | endereço do site, sem barra no fim (ex.: `https://fitway.vercel.app`) |

Os valores reais ficam só no `.env.local` e na Vercel. Os testes usam valores de exemplo.

## Testes

Os casos do item 9 do pedido:
- **Link do Pix:**
  - sem o link do valor do pedido → Pix fora de `metodosDisponiveis(tipo)` e `pedido_metodo` com Pix recusado;
  - URL fora de `https://nubank.com.br/cobrar/` (outro domínio, `http://`, `https://nubank.com.br.evil.com/cobrar/`) → recusada;
  - inicial e mensalidade usam `PIX_LINK_999`, novo_treino usa `PIX_LINK_499`;
- **"Já paguei" sem comprovante** → recusado; ID informado fora do formato → recusado;
- **ID da transação no admin:** formato inválido recusado (sem o "E", 31 ou 33 caracteres, espaço no meio, caractere especial); data do ID de antes do pedido recusada; ID já usado em outro pedido recusado com o código dele; a confirmação grava o ID;
- **cartão:** corpo forjado, valor menor, `order_nsu` trocado e `transaction_nsu`/slug repetido não pagam; pago em pedido fechado vira `cartao_sem_pedido` uma vez; no máximo uma consulta a cada 10 s;
- **sem rede:** `sql` e `fetch` simulados;
- **SQL real:** PGlite, fora do repositório.

## Limites

- **Sempre:**
  - o servidor decide valor, meio e status;
  - nunca confiar no corpo do webhook;
  - toda confirmação vai para o `admin_log`;
  - `transaction_nsu`, `checkout_slug` e `pix_e2e` são únicos;
  - dinheiro recebido sem pedido aberto fica registrado para devolução.
- **Perguntar antes:** dependência nova (nenhuma prevista); mudar o formato de algo já gravado; push.
- **Nunca:**
  - dado pessoal no código ou nos testes;
  - o usuário mudar o status para `pago`;
  - chamar o InfinitePay com dado vindo do navegador sem validar o formato.

## Perguntas em aberto

1. **P1. Nome do recebedor (decidido):** a tela mostra `PIX_TITULAR_EXIBIDO`, ou nenhum nome se a variável estiver vazia. O app do banco mostra o titular da conta de qualquer jeito.
2. **P2. Campo da URL na resposta de `/links`:** a documentação não diz o nome.
   - O código lê `url` e, se não vier, responde "Pagamento indisponível no momento" sem gastar nada.
   - Na hora de testar, crio um link real (criar link é grátis) com o seu handle para confirmar o campo, antes de dar o cartão como pronto.
3. **P3 (decidido, como recomendado). Trocar de cartão para Pix depois de abrir o checkout.** Se a pessoa abre o checkout de cartão, troca para Pix e mesmo assim paga o link do cartão, a regra "só aceita `metodo = 'cartao'`" deixaria o dinheiro recebido sem dar o acesso.
   - **Recomendo:** aceitar o pagamento verificado pelo `payment_check` de um pedido que já teve link de cartão (`checkout_url` não nulo) se `paid_amount >= valor do cartão` daquele tipo, voltando `metodo` para `cartao`.
   - O contrário também vale: o admin pode confirmar o Pix de um pedido aberto que está com cartão escolhido.
   - Se os dois forem pagos, o segundo vira `cartao_sem_pedido` (cartão) ou fica para o admin não confirmar (Pix): devolver.
4. **P4. Identificar o Pix (decidido):** o link é o mesmo para todos os pedidos do mesmo valor, então a conferência usa o ID da transação (E2E). O admin copia o ID do app do Nubank ao confirmar; o banco guarda com `unique`, então o mesmo Pix nunca confirma dois pedidos. A pessoa pode colar o ID do comprovante no "Já paguei" para facilitar.
5. **P5. "Verificar no InfinitePay" precisa de `transaction_nsu` e `slug`,** que só chegam pela volta do checkout ou pelo webhook.
   - Se nenhum dos dois chegar, o botão avisa que não há o que verificar.
   - Por isso guardo o último par recebido em `checkout_ref`, mesmo antes da verificação.
6. **P6 (decidido: "até 12x (pode ter juros)"):** no InfinitePay, o parcelamento pode ter juros pagos pelo comprador (`paid_amount > amount`).
7. **P7 (decidido: `2026-11-16-2`):** versão nova do termo, com o item 5 de pagamento.
8. **P8. O `payment_check` amarra `order_nsu`, `transaction_nsu` e `slug`?** A documentação não diz. Se ele olhar só o slug, um pagamento poderia ser apresentado como de outro pedido; o `checkout_slug` único e a conferência do `order_nsu` da resposta (quando vier) barram isso. Junto com a P2, no link real de teste: consultar com `order_nsu` trocado (deve dar `paid: false`) e ver se o slug é do link ou de cada pagamento.
