import { test } from "node:test";
import assert from "node:assert/strict";
import { acaoPagamento, confirmarPagamento } from "../api/_pagamento.js";
import { acaoAdmin } from "../api/_admin.js";

Object.assign(process.env, { INFINITEPAY_HANDLE: "exemplo", SITE_URL: "https://exemplo.app/", ADMIN_EMAILS: "dono@x.com" });
const u = { email: "a@x.com", nome: "Ana" };
const ref = { order_nsu: "p1", transaction_nsu: "tx-123", slug: "s-abc" };

// fetch falso: guarda as chamadas e responde com o que o teste mandar.
function fetchFalso(resposta) {
  const chamadas = [];
  const fetch = async (url, opc) => {
    chamadas.push({ url, corpo: JSON.parse(opc.body) });
    if (resposta instanceof Error) throw resposta;
    const { status = 200, json } = typeof resposta === "function" ? resposta(url) : resposta;
    return { ok: status >= 200 && status < 300, status, json: async () => { if (json === undefined) throw new SyntaxError("não é JSON"); return json; } };
  };
  return { fetch, chamadas };
}
// Banco falso para confirmarPagamento. pedido: a linha que o select devolve (null = pedido sem link do InfinitePay);
// livre: o limite de 10 s deixa consultar; aplicar: resposta do UPDATE do pagamento.
function sqlFalso({ pedido = {}, livre = true, aplicar = () => [{ status: "pago" }] } = {}) {
  const linha = pedido && { id: "p1", tipo: "inicial", status: "aguardando_pagamento", email: "a@x.com", transaction_nsu: null, metodo: "cartao", tem_pix: false, ...pedido };
  const chamadas = [];
  const sql = async (partes, ...valores) => {
    const q = partes.join("?");
    chamadas.push({ q, valores });
    if (q.startsWith("select id, tipo, status, email, transaction_nsu")) return linha ? [linha] : [];
    if (q.startsWith("update pedidos set checado_em")) return livre ? [{ id: "p1" }] : [];
    if (q.startsWith("with p as")) return aplicar(q, valores);
    return [];
  };
  return { sql, chamadas };
}
const pago = (o = {}) => ({ json: { success: true, paid: true, amount: 1199, paid_amount: 1199, installments: 1, capture_method: "credit_card", ...o } });
const aplicou = (s) => s.chamadas.some((c) => c.q.startsWith("with p as"));
const guardouRef = (s) => s.chamadas.some((c) => c.q.startsWith("update pedidos set checkout_ref"));
const sobrou = (s) => s.chamadas.find((c) => c.q.startsWith("insert into admin_log") && c.q.includes("'cartao_sem_pedido'"));

test("confirmarPagamento: pago de verdade grava com transaction_nsu, slug e capture_method, saindo só de status aberto", async () => {
  const s = sqlFalso(), f = fetchFalso(pago());
  assert.equal(await confirmarPagamento(s.sql, ref, { fetch: f.fetch }), "pago");
  assert.equal(f.chamadas[0].url, "https://api.checkout.infinitepay.io/payment_check");
  assert.deepEqual(f.chamadas[0].corpo, { handle: "exemplo", order_nsu: "p1", transaction_nsu: "tx-123", slug: "s-abc" });
  const w = s.chamadas.find((c) => c.q.startsWith("with p as"));
  for (const v of ["tx-123", "s-abc", "credit_card", "infinitepay", 1199]) assert.ok(w.valores.includes(v), String(v));
  assert.doesNotMatch(w.q, /metodo = \?/, "o meio escolhido não muda: o meio real vai em capture_method");
  assert.ok(w.valores.some((v) => Array.isArray(v) && v.join() === "aguardando_pagamento,aguardando_confirmacao"), "de: só status aberto");
  assert.match(w.q, /\(\?::text is null or transaction_nsu is null\)/, "pedido já pago com um transaction_nsu não é pago de novo");
  assert.ok(guardouRef(s), "guarda o retorno para o admin verificar de novo");
  assert.match(s.chamadas[0].q, /\(checkout_url is not null or checkout_url_pix is not null\)/, "qualquer pedido com link do InfinitePay, Pix ou cartão");
  assert.match(s.chamadas[0].q, /checkout_url_pix is not null as tem_pix/, "o mínimo depende de existir o link do Pix");
});

test("confirmarPagamento: corpo forjado, valor menor (pago ou do item) e order_nsu de outro pedido são recusados", async () => {
  for (const r of [pago({ paid: false }), pago({ success: false }), pago({ paid: "true" }), pago({ paid_amount: "1199", amount: undefined }),
    pago({ paid_amount: undefined, amount: undefined }), pago({ order_nsu: "outro" }), { json: null }, { status: 404, json: {} }]) {
    const s = sqlFalso(), f = fetchFalso(r);
    assert.equal(await confirmarPagamento(s.sql, ref, { fetch: f.fetch }), "recusado", JSON.stringify(r));
    assert.equal(aplicou(s), false);
    assert.equal(sobrou(s), undefined);
  }
  for (const r of [pago({ success: false }), pago({ order_nsu: "outro" })]) {
    const s = sqlFalso();
    await confirmarPagamento(s.sql, ref, { fetch: fetchFalso(r).fetch });
    assert.equal(guardouRef(s), false, "um par que o InfinitePay não reconhece não troca o retorno guardado");
  }
  const s = sqlFalso({ pedido: { tipo: "novo_treino" } }), f = fetchFalso(pago({ amount: 599, paid_amount: 599 }));
  assert.equal(await confirmarPagamento(s.sql, ref, { fetch: f.fetch }), "pago", "novo treino: 5,99 basta");
  const juros = sqlFalso();
  assert.equal(await confirmarPagamento(juros.sql, ref, { fetch: fetchFalso(pago({ paid_amount: 1350, installments: 12 })).fetch }), "pago", "juros do parcelamento: paid_amount maior vale");
  const wj = juros.chamadas.find((c) => c.q.startsWith("with p as"));
  assert.ok(wj.valores.includes(1199) && !wj.valores.includes(1350), "grava o valor do link (amount), sem os juros");
  const semAmount = sqlFalso();
  assert.equal(await confirmarPagamento(semAmount.sql, ref, { fetch: fetchFalso(pago({ amount: undefined, paid_amount: 1350 })).fetch }), "recusado", "sem amount: um link próprio barato parcelado passaria");
  assert.ok(sobrou(semAmount).valores.includes("valor_menor"), "o dinheiro fica registrado para devolver");
});

test("confirmarPagamento: erro temporário (rede, 5xx, 429, JSON quebrado) não grava nada", async () => {
  for (const r of [new Error("rede"), { status: 500, json: {} }, { status: 503, json: {} }, { status: 429, json: {} }, { status: 200 }]) {
    const s = sqlFalso();
    assert.equal(await confirmarPagamento(s.sql, ref, { fetch: fetchFalso(r).fetch }), "temporario");
    assert.equal(aplicou(s), false);
  }
});

test("confirmarPagamento: no máximo uma consulta ao InfinitePay a cada 10 s por pedido", async () => {
  const s = sqlFalso({ livre: false }), f = fetchFalso(pago());
  assert.equal(await confirmarPagamento(s.sql, ref, { fetch: f.fetch }), "temporario", "o webhook responde 400 e o InfinitePay reenvia depois");
  assert.equal(f.chamadas.length, 0);
  assert.match(s.chamadas[1].q, /checado_em is null or checado_em < now\(\) - interval '10 seconds'/);
});

test("confirmarPagamento: pedido sem link, inexistente ou com este pagamento já aplicado é ignorado sem chamar o InfinitePay", async () => {
  for (const pedido of [null, { status: "pronto", transaction_nsu: "tx-123" }]) {
    const s = sqlFalso({ pedido }), f = fetchFalso(pago());
    assert.equal(await confirmarPagamento(s.sql, ref, { fetch: f.fetch }), "ignorado");
    assert.equal(f.chamadas.length, 0);
  }
});

test("confirmarPagamento: pago num pedido fechado (cancelado, ou o outro link já pago) fica no admin_log para devolver; não pago, nada", async () => {
  for (const status of ["cancelado", "pronto", "pago"]) {
    const s = sqlFalso({ pedido: { status, transaction_nsu: null } }), f = fetchFalso(pago({ paid_amount: 1199 }));
    assert.equal(await confirmarPagamento(s.sql, ref, { fetch: f.fetch }), "sobra", status);
    assert.equal(aplicou(s), false);
    const l = sobrou(s);
    assert.match(l.q, /insert into admin_log .*'cartao_sem_pedido'.*where not exists \(select 1 from pedidos where transaction_nsu = \?\)\s*and not exists \(select 1 from admin_log where acao = 'cartao_sem_pedido'/s, "uma vez por pagamento");
    assert.ok(l.valores.includes("tx-123") && l.valores.includes(1199) && l.valores.includes("a@x.com") && l.valores.includes("pedido_fechado"));
  }
  const s = sqlFalso({ pedido: { status: "cancelado" } });
  assert.equal(await confirmarPagamento(s.sql, ref, { fetch: fetchFalso(pago({ paid: false })).fetch }), "recusado");
  assert.equal(sobrou(s), undefined);
  // Fechou entre a leitura e a gravação (o outro link pago ao mesmo tempo): também fica registrado.
  const corrida = sqlFalso({ aplicar: () => [] });
  assert.equal(await confirmarPagamento(corrida.sql, ref, { fetch: fetchFalso(pago()).fetch }), "sobra");
  assert.ok(sobrou(corrida));
});

test("confirmarPagamento: formato inválido nunca chega ao banco nem ao InfinitePay", async () => {
  for (const r of [{ ...ref, order_nsu: "a b" }, { ...ref, transaction_nsu: "" }, { ...ref, slug: "x/../y" }, { ...ref, slug: { $ne: 1 } },
    { ...ref, transaction_nsu: "x".repeat(101) }, { ...ref, order_nsu: undefined }, { ...ref, transaction_nsu: 1.5 }]) {
    const s = sqlFalso(), f = fetchFalso(pago());
    assert.equal(await confirmarPagamento(s.sql, r, { fetch: f.fetch }), "ignorado", JSON.stringify(r));
    assert.equal(s.chamadas.length + f.chamadas.length, 0);
  }
  const s = sqlFalso();
  assert.equal(await confirmarPagamento(s.sql, { ...ref, transaction_nsu: 98765 }, { fetch: fetchFalso(pago()).fetch }), "pago", "número inteiro vira texto");
});

test("confirmarPagamento: transaction_nsu ou slug já usado em outro pedido não paga duas vezes", async () => {
  const s = sqlFalso({ aplicar: () => { throw Object.assign(new Error("duplicate key"), { code: "23505" }); } });
  assert.equal(await confirmarPagamento(s.sql, ref, { fetch: fetchFalso(pago()).fetch }), "ignorado", "o mesmo pagamento (ou o mesmo slug) em outro pedido");
  assert.equal(sobrou(s), undefined, "reaproveitar um pagamento não vira pedido de devolução");
});

// ---------- ações do usuário ----------
function sqlUsuario(pedido, extra = () => []) {
  const chamadas = [];
  const sql = async (partes, ...valores) => {
    const q = partes.join("?");
    chamadas.push({ q, valores });
    if (q.startsWith("select id, tipo, status, metodo")) return pedido && valores.includes(u.email) ? [pedido] : [];
    if (q.startsWith("select id from pedidos")) return pedido && valores.includes(u.email) ? [{ id: pedido.id }] : [];
    if (q.startsWith("update pedidos set metodo")) return pedido && pedido.status === "aguardando_pagamento" ? [{ checkout_url: pedido.checkout_url, checkout_url_pix: pedido.checkout_url_pix || null }] : [];
    return extra(q, valores);
  };
  return { sql, chamadas };
}
const pend = (o = {}) => ({ id: "p1", tipo: "inicial", status: "aguardando_pagamento", metodo: null, valor: 999, codigo: "FWABCDEF", mensagem_usuario: null, checkout_url: null, ...o });

test("pagar (cartão): cria o link com o preço do servidor e guarda; o 2º clique reaproveita o link", async () => {
  const s = sqlUsuario(pend()), f = fetchFalso({ json: { url: "https://checkout.infinitepay.io/exemplo/abc" } });
  const r = await acaoPagamento(s.sql, u, { acao: "pagar", id: "p1", metodo: "cartao", valor: 1 }, { fetch: f.fetch });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.url, "https://checkout.infinitepay.io/exemplo/abc");
  assert.equal(f.chamadas[0].url, "https://api.checkout.infinitepay.io/links");
  const c = f.chamadas[0].corpo;
  assert.deepEqual(c.items, [{ quantity: 1, price: 1199, description: "Treino personalizado FitWay" }]);
  assert.deepEqual([c.handle, c.order_nsu, c.redirect_url, c.webhook_url], ["exemplo", "p1", "https://exemplo.app/", "https://exemplo.app/api/infinitepay"]);
  assert.deepEqual(c.customer, { name: "Ana", email: "a@x.com" });
  assert.deepEqual(s.chamadas.find((x) => x.q.startsWith("update pedidos set metodo")).valores.slice(0, 2), ["cartao", 1199]);
  assert.match(s.chamadas.find((x) => x.q.startsWith("update pedidos set metodo")).q, /where id = \? and email = \? and status = 'aguardando_pagamento'/);
  const corrida = sqlUsuario(pend(), (q) => (q.startsWith("update pedidos set checkout_url") ? [{ checkout_url: "https://checkout.infinitepay.io/exemplo/primeiro", checkout_url_pix: null }] : []));
  const r2 = await acaoPagamento(corrida.sql, u, { acao: "pagar", id: "p1", metodo: "cartao" }, { fetch: fetchFalso({ json: { url: "https://checkout.infinitepay.io/exemplo/segundo" } }).fetch });
  assert.equal(r2.corpo.url, "https://checkout.infinitepay.io/exemplo/primeiro", "o segundo clique recebe o link que ficou gravado");
  const s2 = sqlUsuario(pend({ checkout_url: "https://checkout.infinitepay.io/exemplo/abc" })), f2 = fetchFalso(pago());
  assert.equal((await acaoPagamento(s2.sql, u, { acao: "pagar", id: "p1", metodo: "cartao" }, { fetch: f2.fetch })).corpo.url, "https://checkout.infinitepay.io/exemplo/abc");
  assert.equal(f2.chamadas.length, 0);
});

test("pagar: resposta sem URL válida, erro de rede ou sem variáveis dá Pagamento indisponível", async () => {
  for (const resp of [{ json: {} }, { json: { url: "javascript:alert(1)" } }, { json: { url: "http://x" } }, { json: { url: "https://x/\"><b>" } }, { status: 500, json: {} }, new Error("rede")]) {
    const s = sqlUsuario(pend());
    const r = await acaoPagamento(s.sql, u, { acao: "pagar", id: "p1", metodo: "cartao" }, { fetch: fetchFalso(resp).fetch });
    assert.equal(r.status, 502, JSON.stringify(resp));
    assert.equal(r.corpo.erro, "Pagamento indisponível no momento.");
    assert.ok(!s.chamadas.some((x) => x.q.startsWith("update pedidos set checkout_url")));
  }
  const antes = process.env.SITE_URL;
  delete process.env.SITE_URL;
  try {
    const s = sqlUsuario(pend()), f = fetchFalso(pago());
    assert.equal((await acaoPagamento(s.sql, u, { acao: "pagar", id: "p1", metodo: "cartao" }, { fetch: f.fetch })).status, 400);
    assert.equal(f.chamadas.length, 0);
  } finally { process.env.SITE_URL = antes; }
  for (const status of ["aguardando_confirmacao", "pago", "cancelado"]) {
    const s = sqlUsuario(pend({ status }));
    assert.equal((await acaoPagamento(s.sql, u, { acao: "pagar", id: "p1", metodo: "cartao" }, { fetch: fetchFalso(pago()).fetch })).status, 400, status);
  }
});

test("confirmar_pagamento: pedido de outra conta é recusado sem chamar o InfinitePay", async () => {
  const s = sqlUsuario(null), f = fetchFalso(pago());
  const r = await acaoPagamento(s.sql, u, { acao: "confirmar_pagamento", ...ref }, { fetch: f.fetch });
  assert.equal(r.status, 404);
  assert.equal(f.chamadas.length, 0);
  const s2 = sqlUsuario(pend({ metodo: "cartao" }), (q) => (q.startsWith("select id, tipo, status, email, transaction_nsu") ? [{ id: "p1", tipo: "inicial", status: "aguardando_pagamento", email: "a@x.com", transaction_nsu: null }]
    : q.startsWith("update pedidos set checado_em") ? [{ id: "p1" }] : q.startsWith("with p as") ? [{ status: "pago" }] : q.startsWith("select status") ? [{ status: "pago" }] : []));
  const r2 = await acaoPagamento(s2.sql, u, { acao: "confirmar_pagamento", ...ref }, { fetch: fetchFalso(pago()).fetch });
  assert.deepEqual(r2.corpo, { resultado: "pago", status: "pago" });
});

// ---------- admin ----------
test("pedido_verificar: só admin; sem retorno guardado avisa; com retorno roda o payment_check de novo", async () => {
  const f = fetchFalso(pago());
  assert.equal((await acaoAdmin(async () => { throw new Error("não devia consultar"); }, u, { op: "pedido_verificar", id: "p1" }, { fetch: f.fetch })).status, 403);
  const vazio = async (partes) => (partes.join("?").startsWith("select checkout_ref") ? [{ checkout_ref: null }] : []);
  const r = await acaoAdmin(vazio, { email: "dono@x.com" }, { op: "pedido_verificar", id: "p1" }, { fetch: f.fetch });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /Não há o que verificar/);
  assert.equal(f.chamadas.length, 0);
  const s = sqlFalso();
  const sql = async (partes, ...v) => {
    const q = partes.join("?");
    if (q.startsWith("select checkout_ref")) return [{ checkout_ref: { slug: "s-abc", transaction_nsu: "tx-123" } }];
    if (q.startsWith("select status")) return [{ status: "pago" }];
    return s.sql(partes, ...v);
  };
  const ok = await acaoAdmin(sql, { email: "dono@x.com" }, { op: "pedido_verificar", id: "p1" }, { fetch: f.fetch });
  assert.equal(ok.status, 200);
  assert.deepEqual(f.chamadas[0].corpo, { handle: "exemplo", order_nsu: "p1", transaction_nsu: "tx-123", slug: "s-abc" });
  const rec = await acaoAdmin(sql, { email: "dono@x.com" }, { op: "pedido_verificar", id: "p1" }, { fetch: fetchFalso(pago({ paid: false })).fetch });
  assert.match(rec.corpo.erro, /não foi feito ou veio com valor menor/);
  const nada = async () => [];
  assert.equal((await acaoAdmin(nada, { email: "dono@x.com" }, { op: "pedido_verificar", id: "p1" }, { fetch: f.fetch })).status, 404);
  const tmp = await acaoAdmin(sql, { email: "dono@x.com" }, { op: "pedido_verificar", id: "p1" }, { fetch: fetchFalso(new Error("rede")).fetch });
  assert.match(tmp.corpo.erro, /não respondeu/);
  // Um order_nsu dentro do retorno guardado nunca troca o pedido verificado.
  const f2 = fetchFalso(pago());
  const torto = async (partes, ...v) => (partes.join("?").startsWith("select checkout_ref") ? [{ checkout_ref: { slug: "s-abc", transaction_nsu: "tx-123", order_nsu: "outro" } }] : sql(partes, ...v));
  await acaoAdmin(torto, { email: "dono@x.com" }, { op: "pedido_verificar", id: "p1" }, { fetch: f2.fetch });
  assert.equal(f2.chamadas[0].corpo.order_nsu, "p1");
});

// ---------- Pix e cartão pelo InfinitePay: meio diferente, valor mínimo, dois links ----------
test("confirmarPagamento: pago com meio diferente do escolhido é aceito; grava o capture_method real e o valor do payment_check", async () => {
  for (const [metodo, tem_pix, cm, amount] of [["cartao", true, "pix", 999], ["pix", true, "credit_card", 999], ["cartao", false, "pix", 1199]]) {
    const s = sqlFalso({ pedido: { metodo, tem_pix } });
    assert.equal(await confirmarPagamento(s.sql, ref, { fetch: fetchFalso(pago({ capture_method: cm, amount, paid_amount: amount })).fetch }), "pago", `${metodo} pago com ${cm}`);
    const w = s.chamadas.find((c) => c.q.startsWith("with p as"));
    assert.ok(w.valores.includes(cm), "capture_method real");
    assert.ok(w.valores.includes(amount), "valor = amount do payment_check");
  }
});

test("confirmarPagamento: valor mínimo é o do link mais barato do pedido; pago abaixo dele é recusado e registrado para devolver", async () => {
  const casos = [
    // [tipo, tem link de Pix?, amount, paid_amount, resultado]
    ["inicial", true, 999, 999, "pago"], ["inicial", true, 998, 998, "recusado"], ["inicial", true, 100, 999, "recusado"],
    ["inicial", true, 999, 998, "recusado"], ["novo_treino", true, 499, 498, "recusado"], // link certo, pago um centavo abaixo
    ["inicial", true, 1199, 999, "recusado"], ["inicial", false, 1199, 1198, "recusado"], // pago menos que o link pago (o de 11,99)
    ["inicial", true, undefined, 998, "recusado"], ["inicial", true, undefined, 1500, "recusado"], // sem amount: não se sabe qual link foi pago
    ["inicial", false, 999, 999, "recusado"], ["inicial", false, 1199, 1199, "pago"],
    ["novo_treino", true, 499, 499, "pago"], ["novo_treino", true, 498, 498, "recusado"], ["novo_treino", false, 599, 599, "pago"], ["novo_treino", false, 499, 499, "recusado"],
  ];
  for (const [tipo, tem_pix, amount, paid_amount, esperado] of casos) {
    const s = sqlFalso({ pedido: { tipo, tem_pix } });
    const nome = `${tipo} ${tem_pix ? "com" : "sem"} link de Pix, ${amount}/${paid_amount}`;
    assert.equal(await confirmarPagamento(s.sql, ref, { fetch: fetchFalso(pago({ amount, paid_amount })).fetch }), esperado, nome);
    assert.equal(aplicou(s), esperado === "pago", nome);
    if (esperado === "recusado") {
      const l = sobrou(s);
      assert.ok(l, `${nome}: dinheiro recebido fica registrado`);
      assert.ok(l.valores.includes("valor_menor") && l.valores.includes(paid_amount), nome);
    }
  }
});

test("confirmarPagamento: os dois links do mesmo pedido confirmam uma vez só; o segundo vira devolução", async () => {
  let status = "aguardando_pagamento";
  const banco = () => sqlFalso({ pedido: { status, tem_pix: true }, aplicar: () => { status = "pago"; return [{ status: "pago" }]; } });
  const a = banco();
  assert.equal(await confirmarPagamento(a.sql, { order_nsu: "p1", transaction_nsu: "tx-pix", slug: "s-pix" }, { fetch: fetchFalso(pago({ amount: 999, paid_amount: 999, capture_method: "pix" })).fetch }), "pago");
  // O segundo chega dentro dos 10 s: temporário (o webhook reenvia depois), sem registrar nada ainda.
  const cedo = sqlFalso({ pedido: { status, tem_pix: true }, livre: false });
  assert.equal(await confirmarPagamento(cedo.sql, { order_nsu: "p1", transaction_nsu: "tx-cartao", slug: "s-cartao" }, { fetch: fetchFalso(pago()).fetch }), "temporario");
  assert.equal(sobrou(cedo), undefined);
  const b = banco();
  assert.equal(await confirmarPagamento(b.sql, { order_nsu: "p1", transaction_nsu: "tx-cartao", slug: "s-cartao" }, { fetch: fetchFalso(pago()).fetch }), "sobra");
  assert.equal(aplicou(b), false);
  assert.ok(sobrou(b).valores.includes("tx-cartao"));
  // Pago num pedido fechado sem paid_amount na resposta: ainda assim fica registrado (com o amount).
  const sem = sqlFalso({ pedido: { status: "cancelado" } });
  assert.equal(await confirmarPagamento(sem.sql, ref, { fetch: fetchFalso(pago({ paid_amount: undefined })).fetch }), "sobra");
  assert.ok(sobrou(sem) && sobrou(sem).valores.includes(1199));
});

// ---------- pagar { id, metodo } ----------
test("pagar: Pix e cartão criam o link com o preço do meio e guardam cada um na sua coluna", async () => {
  for (const [tipo, metodo, preco, coluna] of [["inicial", "pix", 999, "checkout_url_pix"], ["mensalidade", "pix", 999, "checkout_url_pix"], ["novo_treino", "pix", 499, "checkout_url_pix"],
    ["inicial", "cartao", 1199, "checkout_url"], ["novo_treino", "cartao", 599, "checkout_url"]]) {
    const s = sqlUsuario(pend({ tipo })), f = fetchFalso({ json: { url: "https://checkout.infinitepay.io/exemplo/abc" } });
    const r = await acaoPagamento(s.sql, u, { acao: "pagar", id: "p1", metodo, valor: 1 }, { fetch: f.fetch });
    assert.equal(r.status, 200, `${tipo}/${metodo}`);
    assert.equal(r.corpo.url, "https://checkout.infinitepay.io/exemplo/abc");
    assert.equal(f.chamadas[0].corpo.items[0].price, preco, `${tipo}/${metodo}: preço do servidor`);
    const m = s.chamadas.find((x) => x.q.startsWith("update pedidos set metodo"));
    assert.deepEqual(m.valores.slice(0, 2), [metodo, preco]);
    const g = s.chamadas.find((x) => x.q.startsWith("update pedidos set checkout_url"));
    assert.match(g.q, new RegExp(`${coluna} = case when \\? = '${metodo}' then coalesce\\(${coluna}, \\?\\)`), "dois cliques: fica o primeiro link");
  }
});

test("pagar: o link do meio já criado é reaproveitado; trocar de meio cria o do outro sem apagar o primeiro", async () => {
  const comPix = pend({ checkout_url_pix: "https://checkout.infinitepay.io/exemplo/pix" });
  let s = sqlUsuario(comPix), f = fetchFalso({ json: { url: "https://checkout.infinitepay.io/exemplo/novo" } });
  assert.equal((await acaoPagamento(s.sql, u, { acao: "pagar", id: "p1", metodo: "pix" }, { fetch: f.fetch })).corpo.url, "https://checkout.infinitepay.io/exemplo/pix");
  assert.equal(f.chamadas.length, 0, "Abrir o pagamento de novo não cria outro link");
  s = sqlUsuario(comPix); f = fetchFalso({ json: { url: "https://checkout.infinitepay.io/exemplo/cartao" } });
  assert.equal((await acaoPagamento(s.sql, u, { acao: "pagar", id: "p1", metodo: "cartao" }, { fetch: f.fetch })).corpo.url, "https://checkout.infinitepay.io/exemplo/cartao");
  assert.equal(f.chamadas.length, 1);
  const g = s.chamadas.find((x) => x.q.startsWith("update pedidos set checkout_url"));
  assert.match(g.q, /else checkout_url_pix end/, "o link do Pix fica como estava");
});

test("pagar: meio inválido ou pedido fora de aguardando_pagamento é recusado sem chamar o InfinitePay", async () => {
  for (const metodo of ["boleto", "toString", "__proto__", undefined]) {
    const s = sqlUsuario(pend()), f = fetchFalso(pago());
    assert.equal((await acaoPagamento(s.sql, u, { acao: "pagar", id: "p1", metodo }, { fetch: f.fetch })).status, 400, String(metodo));
    assert.equal(f.chamadas.length, 0);
    assert.ok(!s.chamadas.some((x) => x.q.startsWith("update")));
  }
  for (const status of ["aguardando_confirmacao", "pago", "cancelado"]) {
    const s = sqlUsuario(pend({ status })), f = fetchFalso(pago());
    assert.equal((await acaoPagamento(s.sql, u, { acao: "pagar", id: "p1", metodo: "pix" }, { fetch: f.fetch })).status, 400, status);
    assert.equal(f.chamadas.length, 0);
  }
});

test("ações antigas do cartão (pagar_cartao, confirmar_cartao) e cartao_verificar não existem mais", async () => {
  for (const acao of ["pagar_cartao", "confirmar_cartao", "pedido_metodo", "pix_avisei"]) {
    const s = sqlUsuario(pend()), f = fetchFalso(pago());
    const r = await acaoPagamento(s.sql, u, { acao, id: "p1", ...ref }, { fetch: f.fetch });
    assert.equal(r.status, 400, acao);
    assert.equal(r.corpo.erro, "Ação desconhecida.");
    assert.equal(f.chamadas.length, 0);
  }
  const r = await acaoAdmin(async () => [], { email: "dono@x.com" }, { op: "cartao_verificar", id: "p1" });
  assert.equal(r.corpo.erro, "Operação desconhecida.");
});

test("admin, pedido: o meio escolhido é o do link pago (pelo valor); sem pagamento, o último escolhido", async () => {
  const base = { id: "p1", email: "a@x.com", nome: "Ana", tipo: "inicial", status: "pronto", metodo: "cartao", checkout_url: "https://c/1199", checkout_url_pix: "https://c/999" };
  for (const [linha, meio] of [[{ valor: 999, transaction_nsu: "t", capture_method: "credit_card" }, "pix"], [{ valor: 1199, transaction_nsu: "t", capture_method: "pix" }, "cartao"],
    [{ valor: 999, transaction_nsu: "t", checkout_url_pix: null }, "cartao"], [{ valor: 999, transaction_nsu: null, status: "aguardando_pagamento" }, "cartao"], [{ valor: 5000, transaction_nsu: "t" }, "cartao"]]) {
    const r = await acaoAdmin(async () => [{ ...base, ...linha }], { email: "dono@x.com" }, { op: "pedido", id: "p1" });
    assert.equal(r.corpo.meioEscolhido, meio, JSON.stringify(linha));
    assert.equal(r.corpo.captureMethod, linha.capture_method);
    assert.equal(r.corpo.checkout_url_pix, undefined, "os links não vão para o painel, só se existem");
  }
});

test("confirmarPagamento: pagamento já registrado para devolução nunca confirma outro pedido (P8)", async () => {
  const s = sqlFalso();
  const sql = async (partes, ...v) => (partes.join("?").startsWith("select 1 from admin_log") ? [{ "?column?": 1 }] : s.sql(partes, ...v));
  assert.equal(await confirmarPagamento(sql, ref, { fetch: fetchFalso(pago()).fetch }), "recusado");
  assert.equal(aplicou(s), false);
  const c = s.chamadas.find((x) => x.q.startsWith("select 1 from admin_log"));
  assert.ok(!c, "a consulta foi respondida pelo banco de cima");
});

test("pagar: URL do checkout fora de infinitepay.io é recusada", async () => {
  for (const url of ["https://evil.com/x", "https://infinitepay.io.evil.com/x", "https://evilinfinitepay.io/x"]) {
    const s = sqlUsuario(pend());
    assert.equal((await acaoPagamento(s.sql, u, { acao: "pagar", id: "p1", metodo: "pix" }, { fetch: fetchFalso({ json: { url } }).fetch })).status, 502, url);
  }
});
