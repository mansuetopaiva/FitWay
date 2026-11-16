import { test } from "node:test";
import assert from "node:assert/strict";
import { acaoPagamento, confirmarCartao } from "../api/_pagamento.js";
import { acaoAdmin } from "../api/_admin.js";

Object.assign(process.env, { INFINITEPAY_HANDLE: "exemplo", SITE_URL: "https://exemplo.app/", PIX_LINK_999: "https://nubank.com.br/cobrar/x", ADMIN_EMAILS: "dono@x.com" });
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
// Banco falso para confirmarCartao. pedido: a linha que o select devolve (null = não é pedido de cartão);
// livre: o limite de 10 s deixa consultar; aplicar: resposta do UPDATE do pagamento.
function sqlFalso({ pedido = {}, livre = true, aplicar = () => [{ status: "pago" }] } = {}) {
  const linha = pedido && { id: "p1", tipo: "inicial", status: "aguardando_pagamento", email: "a@x.com", transaction_nsu: null, ...pedido };
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
const sobrou = (s) => s.chamadas.find((c) => c.q.includes("'cartao_sem_pedido'"));

test("confirmarCartao: pago de verdade grava com transaction_nsu, slug e capture_method, saindo só de status aberto", async () => {
  const s = sqlFalso(), f = fetchFalso(pago());
  assert.equal(await confirmarCartao(s.sql, ref, { fetch: f.fetch }), "pago");
  assert.equal(f.chamadas[0].url, "https://api.checkout.infinitepay.io/payment_check");
  assert.deepEqual(f.chamadas[0].corpo, { handle: "exemplo", order_nsu: "p1", transaction_nsu: "tx-123", slug: "s-abc" });
  const w = s.chamadas.find((c) => c.q.startsWith("with p as"));
  for (const v of ["tx-123", "s-abc", "credit_card", "infinitepay", 1199]) assert.ok(w.valores.includes(v), String(v));
  assert.ok(w.valores.some((v) => Array.isArray(v) && v.join() === "aguardando_pagamento,aguardando_confirmacao"), "de: só status aberto");
  assert.match(w.q, /\(\?::text is null or transaction_nsu is null\)/, "pedido já pago com um transaction_nsu não é pago de novo");
  assert.ok(guardouRef(s), "guarda o retorno para o admin verificar de novo");
  assert.match(s.chamadas[0].q, /\(metodo = 'cartao' or checkout_url is not null\)/);
});

test("confirmarCartao: corpo forjado, valor menor (pago ou do item) e order_nsu de outro pedido são recusados", async () => {
  for (const r of [pago({ paid: false }), pago({ success: false }), pago({ paid: "true" }), pago({ paid_amount: 1198 }), pago({ paid_amount: "1199" }),
    pago({ paid_amount: undefined }), pago({ amount: 599, paid_amount: 1250 }), pago({ order_nsu: "outro" }), { json: null }, { status: 404, json: {} }]) {
    const s = sqlFalso(), f = fetchFalso(r);
    assert.equal(await confirmarCartao(s.sql, ref, { fetch: f.fetch }), "recusado", JSON.stringify(r));
    assert.equal(aplicou(s), false);
    assert.equal(sobrou(s), undefined);
  }
  for (const r of [pago({ success: false }), pago({ order_nsu: "outro" })]) {
    const s = sqlFalso();
    await confirmarCartao(s.sql, ref, { fetch: fetchFalso(r).fetch });
    assert.equal(guardouRef(s), false, "um par que o InfinitePay não reconhece não troca o retorno guardado");
  }
  const s = sqlFalso({ pedido: { tipo: "novo_treino" } }), f = fetchFalso(pago({ amount: 599, paid_amount: 599 }));
  assert.equal(await confirmarCartao(s.sql, ref, { fetch: f.fetch }), "pago", "novo treino: 5,99 basta");
  const juros = sqlFalso();
  assert.equal(await confirmarCartao(juros.sql, ref, { fetch: fetchFalso(pago({ paid_amount: 1350, installments: 12 })).fetch }), "pago", "juros do parcelamento: paid_amount maior vale");
  const semAmount = sqlFalso();
  assert.equal(await confirmarCartao(semAmount.sql, ref, { fetch: fetchFalso(pago({ amount: undefined })).fetch }), "pago", "só paid_amount quando amount não vem");
});

test("confirmarCartao: erro temporário (rede, 5xx, 429, JSON quebrado) não grava nada", async () => {
  for (const r of [new Error("rede"), { status: 500, json: {} }, { status: 503, json: {} }, { status: 429, json: {} }, { status: 200 }]) {
    const s = sqlFalso();
    assert.equal(await confirmarCartao(s.sql, ref, { fetch: fetchFalso(r).fetch }), "temporario");
    assert.equal(aplicou(s), false);
  }
});

test("confirmarCartao: no máximo uma consulta ao InfinitePay a cada 10 s por pedido", async () => {
  const s = sqlFalso({ livre: false }), f = fetchFalso(pago());
  assert.equal(await confirmarCartao(s.sql, ref, { fetch: f.fetch }), "temporario", "o webhook responde 400 e o InfinitePay reenvia depois");
  assert.equal(f.chamadas.length, 0);
  assert.match(s.chamadas[1].q, /checado_em is null or checado_em < now\(\) - interval '10 seconds'/);
});

test("confirmarCartao: pedido que não é de cartão, inexistente ou com este pagamento já aplicado é ignorado sem chamar o InfinitePay", async () => {
  for (const pedido of [null, { status: "pronto", transaction_nsu: "tx-123" }]) {
    const s = sqlFalso({ pedido }), f = fetchFalso(pago());
    assert.equal(await confirmarCartao(s.sql, ref, { fetch: f.fetch }), "ignorado");
    assert.equal(f.chamadas.length, 0);
  }
});

test("confirmarCartao: cartão pago num pedido fechado (cancelado, pago por Pix) fica no admin_log para devolver; não pago, nada", async () => {
  for (const status of ["cancelado", "pronto", "pago"]) {
    const s = sqlFalso({ pedido: { status, transaction_nsu: null } }), f = fetchFalso(pago({ paid_amount: 1199 }));
    assert.equal(await confirmarCartao(s.sql, ref, { fetch: f.fetch }), "sobra", status);
    assert.equal(aplicou(s), false);
    const l = sobrou(s);
    assert.match(l.q, /insert into admin_log .*'cartao_sem_pedido'.*where not exists \(select 1 from pedidos where transaction_nsu = \? or checkout_slug = \?\)\s*and not exists \(select 1 from admin_log where acao = 'cartao_sem_pedido'/s, "uma vez por pagamento");
    assert.ok(l.valores.includes("tx-123") && l.valores.includes(1199) && l.valores.includes("a@x.com"));
  }
  const s = sqlFalso({ pedido: { status: "cancelado" } });
  assert.equal(await confirmarCartao(s.sql, ref, { fetch: fetchFalso(pago({ paid: false })).fetch }), "recusado");
  assert.equal(sobrou(s), undefined);
  // Fechou entre a leitura e a gravação (Pix confirmado ao mesmo tempo): também fica registrado.
  const corrida = sqlFalso({ aplicar: () => [] });
  assert.equal(await confirmarCartao(corrida.sql, ref, { fetch: fetchFalso(pago()).fetch }), "sobra");
  assert.ok(sobrou(corrida));
});

test("confirmarCartao: formato inválido nunca chega ao banco nem ao InfinitePay", async () => {
  for (const r of [{ ...ref, order_nsu: "a b" }, { ...ref, transaction_nsu: "" }, { ...ref, slug: "x/../y" }, { ...ref, slug: { $ne: 1 } },
    { ...ref, transaction_nsu: "x".repeat(101) }, { ...ref, order_nsu: undefined }, { ...ref, transaction_nsu: 1.5 }]) {
    const s = sqlFalso(), f = fetchFalso(pago());
    assert.equal(await confirmarCartao(s.sql, r, { fetch: f.fetch }), "ignorado", JSON.stringify(r));
    assert.equal(s.chamadas.length + f.chamadas.length, 0);
  }
  const s = sqlFalso();
  assert.equal(await confirmarCartao(s.sql, { ...ref, transaction_nsu: 98765 }, { fetch: fetchFalso(pago()).fetch }), "pago", "número inteiro vira texto");
});

test("confirmarCartao: transaction_nsu ou slug já usado em outro pedido não paga duas vezes", async () => {
  const s = sqlFalso({ aplicar: () => { throw Object.assign(new Error("duplicate key"), { code: "23505" }); } });
  assert.equal(await confirmarCartao(s.sql, ref, { fetch: fetchFalso(pago()).fetch }), "ignorado", "o mesmo pagamento (ou o mesmo slug) em outro pedido");
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
    if (q.startsWith("update pedidos set metodo = 'cartao'")) return pedido ? [{ id: pedido.id, checkout_url: pedido.checkout_url }] : [];
    return extra(q, valores);
  };
  return { sql, chamadas };
}
const pend = (o = {}) => ({ id: "p1", tipo: "inicial", status: "aguardando_pagamento", metodo: null, valor: 999, codigo: "FWABCDEF", mensagem_usuario: null, checkout_url: null, ...o });

test("pagar_cartao: cria o link com o preço do servidor e guarda; o 2º clique reaproveita o link", async () => {
  const s = sqlUsuario(pend()), f = fetchFalso({ json: { url: "https://checkout.infinitepay.io/exemplo/abc" } });
  const r = await acaoPagamento(s.sql, u, { acao: "pagar_cartao", id: "p1", valor: 1 }, { fetch: f.fetch });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.url, "https://checkout.infinitepay.io/exemplo/abc");
  assert.equal(f.chamadas[0].url, "https://api.checkout.infinitepay.io/links");
  const c = f.chamadas[0].corpo;
  assert.deepEqual(c.items, [{ quantity: 1, price: 1199, description: "Treino personalizado FitWay" }]);
  assert.deepEqual([c.handle, c.order_nsu, c.redirect_url, c.webhook_url], ["exemplo", "p1", "https://exemplo.app/", "https://exemplo.app/api/infinitepay"]);
  assert.deepEqual(c.customer, { name: "Ana", email: "a@x.com" });
  assert.deepEqual(s.chamadas.find((x) => x.q.startsWith("update pedidos set metodo = 'cartao'")).valores[0], 1199);
  assert.match(s.chamadas.find((x) => x.q.startsWith("update pedidos set checkout_url")).q, /checkout_url = coalesce\(checkout_url, \?\)/, "dois cliques: fica o primeiro link");
  assert.match(s.chamadas.find((x) => x.q.startsWith("update pedidos set metodo = 'cartao'")).q, /where id = \? and email = \? and status = 'aguardando_pagamento'/);
  const corrida = sqlUsuario(pend(), (q) => (q.startsWith("update pedidos set checkout_url") ? [{ checkout_url: "https://checkout.infinitepay.io/exemplo/primeiro" }] : []));
  const r2 = await acaoPagamento(corrida.sql, u, { acao: "pagar_cartao", id: "p1" }, { fetch: fetchFalso({ json: { url: "https://checkout.infinitepay.io/exemplo/segundo" } }).fetch });
  assert.equal(r2.corpo.url, "https://checkout.infinitepay.io/exemplo/primeiro", "o segundo clique recebe o link que ficou gravado");
  const s2 = sqlUsuario(pend({ checkout_url: "https://checkout.infinitepay.io/exemplo/abc" })), f2 = fetchFalso(pago());
  assert.equal((await acaoPagamento(s2.sql, u, { acao: "pagar_cartao", id: "p1" }, { fetch: f2.fetch })).corpo.url, "https://checkout.infinitepay.io/exemplo/abc");
  assert.equal(f2.chamadas.length, 0);
});

test("pagar_cartao: resposta sem URL válida, erro de rede ou sem variáveis dá Pagamento indisponível", async () => {
  for (const resp of [{ json: {} }, { json: { url: "javascript:alert(1)" } }, { json: { url: "http://x" } }, { json: { url: "https://x/\"><b>" } }, { status: 500, json: {} }, new Error("rede")]) {
    const s = sqlUsuario(pend());
    const r = await acaoPagamento(s.sql, u, { acao: "pagar_cartao", id: "p1" }, { fetch: fetchFalso(resp).fetch });
    assert.equal(r.status, 502, JSON.stringify(resp));
    assert.equal(r.corpo.erro, "Pagamento indisponível no momento.");
    assert.ok(!s.chamadas.some((x) => x.q.startsWith("update pedidos set checkout_url")));
  }
  const antes = process.env.SITE_URL;
  delete process.env.SITE_URL;
  try {
    const s = sqlUsuario(pend()), f = fetchFalso(pago());
    assert.equal((await acaoPagamento(s.sql, u, { acao: "pagar_cartao", id: "p1" }, { fetch: f.fetch })).status, 400);
    assert.equal(f.chamadas.length, 0);
  } finally { process.env.SITE_URL = antes; }
  for (const status of ["aguardando_confirmacao", "pago", "cancelado"]) {
    const s = sqlUsuario(pend({ status }));
    assert.equal((await acaoPagamento(s.sql, u, { acao: "pagar_cartao", id: "p1" }, { fetch: fetchFalso(pago()).fetch })).status, 400, status);
  }
});

test("confirmar_cartao: pedido de outra conta é recusado sem chamar o InfinitePay", async () => {
  const s = sqlUsuario(null), f = fetchFalso(pago());
  const r = await acaoPagamento(s.sql, u, { acao: "confirmar_cartao", ...ref }, { fetch: f.fetch });
  assert.equal(r.status, 404);
  assert.equal(f.chamadas.length, 0);
  const s2 = sqlUsuario(pend({ metodo: "cartao" }), (q) => (q.startsWith("select id, tipo, status, email, transaction_nsu") ? [{ id: "p1", tipo: "inicial", status: "aguardando_pagamento", email: "a@x.com", transaction_nsu: null }]
    : q.startsWith("update pedidos set checado_em") ? [{ id: "p1" }] : q.startsWith("with p as") ? [{ status: "pago" }] : q.startsWith("select status") ? [{ status: "pago" }] : []));
  const r2 = await acaoPagamento(s2.sql, u, { acao: "confirmar_cartao", ...ref }, { fetch: fetchFalso(pago()).fetch });
  assert.deepEqual(r2.corpo, { resultado: "pago", status: "pago" });
});

// ---------- admin ----------
test("cartao_verificar: só admin; sem retorno guardado avisa; com retorno roda o payment_check de novo", async () => {
  const f = fetchFalso(pago());
  assert.equal((await acaoAdmin(async () => { throw new Error("não devia consultar"); }, u, { op: "cartao_verificar", id: "p1" }, { fetch: f.fetch })).status, 403);
  const vazio = async (partes) => (partes.join("?").startsWith("select checkout_ref") ? [{ checkout_ref: null }] : []);
  const r = await acaoAdmin(vazio, { email: "dono@x.com" }, { op: "cartao_verificar", id: "p1" }, { fetch: f.fetch });
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
  const ok = await acaoAdmin(sql, { email: "dono@x.com" }, { op: "cartao_verificar", id: "p1" }, { fetch: f.fetch });
  assert.equal(ok.status, 200);
  assert.deepEqual(f.chamadas[0].corpo, { handle: "exemplo", order_nsu: "p1", transaction_nsu: "tx-123", slug: "s-abc" });
  const rec = await acaoAdmin(sql, { email: "dono@x.com" }, { op: "cartao_verificar", id: "p1" }, { fetch: fetchFalso(pago({ paid: false })).fetch });
  assert.match(rec.corpo.erro, /não foi feito ou veio com valor menor/);
  const nada = async () => [];
  assert.equal((await acaoAdmin(nada, { email: "dono@x.com" }, { op: "cartao_verificar", id: "p1" }, { fetch: f.fetch })).status, 404);
  const tmp = await acaoAdmin(sql, { email: "dono@x.com" }, { op: "cartao_verificar", id: "p1" }, { fetch: fetchFalso(new Error("rede")).fetch });
  assert.match(tmp.corpo.erro, /não respondeu/);
  // Um order_nsu dentro do retorno guardado nunca troca o pedido verificado.
  const f2 = fetchFalso(pago());
  const torto = async (partes, ...v) => (partes.join("?").startsWith("select checkout_ref") ? [{ checkout_ref: { slug: "s-abc", transaction_nsu: "tx-123", order_nsu: "outro" } }] : sql(partes, ...v));
  await acaoAdmin(torto, { email: "dono@x.com" }, { op: "cartao_verificar", id: "p1" }, { fetch: f2.fetch });
  assert.equal(f2.chamadas[0].corpo.order_nsu, "p1");
});
