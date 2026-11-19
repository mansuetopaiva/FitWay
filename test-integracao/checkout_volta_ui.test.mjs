// Volta do checkout do InfinitePay (?order_nsu=&transaction_nsu=&slug=): confirmação automática, "Já paguei", resposta temporária e sessão vencida.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
process.env.INFINITEPAY_HANDLE = "exemplo"; process.env.SITE_URL = "https://f.exemplo.com";
const { sql, chamar } = await abrir();
const VOLTA = (id) => `?order_nsu=${id}&transaction_nsu=tx-${id}&slug=slug-${id}`;
const pedido = (id, email) => sql`insert into pedidos (id, email, tipo, status, valor, checkout_url) values (${id}, ${email}, 'mensalidade', 'aguardando_pagamento', 999, 'https://checkout.infinitepay.io/x')`;
const conta = async (email) => (await chamar({ acao: "criar", nome: "Ana", email, senha: "senha123" })).token;
const status = async (id) => (await sql`select status from pedidos where id = ${id}`)[0].status;

// O InfinitePay falso: o servidor (neste mesmo processo) usa o fetch global.
const real = globalThis.fetch;
const infinitepay = (resposta) => { globalThis.fetch = async () => { if (resposta instanceof Error) throw resposta; return { ok: true, status: 200, json: async () => resposta }; }; };
const pago = (id) => ({ success: true, paid: true, paid_amount: 999, amount: 999, capture_method: "pix", order_nsu: id });
test.after(() => { globalThis.fetch = real; });

test("volta paga: a URL fica limpa, mostra 'Confirmando…', depois 'Pagamento confirmado' e o pedido vira pago/pronto", async () => {
  const tk = await conta("a@x.com"); await pedido("PV1", "a@x.com"); infinitepay(pago("PV1"));
  const n = await navegador(chamar, { token: tk, busca: VOLTA("PV1") });
  assert.equal(n.w.location.search, "", "os parâmetros saíram do endereço");
  await n.espera(() => /Pagamento confirmado/.test(n.texto()));
  assert.equal(n.w.location.hash, "#/pagamento/PV1");
  assert.equal(await status("PV1"), "pronto");
  assert.ok(!n.$("[data-pagar]"), "não oferece pagar de novo");
  assert.deepEqual(n.erros.map(String), []);
});

test("resposta temporária: avisa, oferece 'Já paguei, verificar' e confirma na segunda tentativa", async () => {
  const tk = await conta("b@x.com"); await pedido("PV2", "b@x.com"); infinitepay(new Error("rede"));
  const n = await navegador(chamar, { token: tk, busca: VOLTA("PV2") });
  await n.espera(() => /Não conseguimos confirmar agora/.test(n.texto()));
  assert.ok(n.$("[data-verificar]") && n.$("[data-pagar]"), "verificar e abrir de novo");
  assert.equal(await status("PV2"), "aguardando_pagamento");
  infinitepay(pago("PV2")); await sql`update pedidos set checado_em = null where id = 'PV2'`; // o servidor espera 10 s entre consultas
  n.clicar("[data-verificar]");
  await n.espera(() => /Pagamento confirmado/.test(n.texto()));
  assert.equal(await status("PV2"), "pronto");
});

test("pagamento não confirmado (ainda não pago): continua aguardando e oferece verificar", async () => {
  const tk = await conta("c@x.com"); await pedido("PV3", "c@x.com"); infinitepay({ success: true, paid: false });
  const n = await navegador(chamar, { token: tk, busca: VOLTA("PV3") });
  await n.espera(() => /Pagamento ainda não confirmado/.test(n.texto()));
  assert.equal(await status("PV3"), "aguardando_pagamento");
  assert.ok(n.$("[data-verificar]"));
});

test("volta com a sessão vencida: entra na conta e cai na tela do pagamento (não no Perfil), que confirma", async () => {
  await conta("d@x.com"); await pedido("PV4", "d@x.com"); infinitepay(pago("PV4"));
  const n = await navegador(chamar, { busca: VOLTA("PV4") }); // sem cookie
  await n.espera(() => n.$("#email"));
  assert.equal(n.w.location.hash, "#/pagamento/PV4", "a rota sobrevive à tela de login");
  n.$("#email").value = "d@x.com"; n.$("#senha").value = "senha123"; n.$("form .btn").click();
  await n.espera(() => /Pagamento confirmado/.test(n.texto()));
  assert.equal(n.w.location.hash, "#/pagamento/PV4");
  assert.equal(await status("PV4"), "pronto");
});

test("parâmetros inválidos na volta são descartados sem abrir pagamento", async () => {
  const tk = await conta("e@x.com");
  const n = await navegador(chamar, { token: tk, busca: "?order_nsu=../../x&transaction_nsu=t&slug=s&outro=1" });
  await n.espera(() => n.$(".topbar h1"));
  assert.equal(n.w.location.search, "");
  assert.ok(!/pagamento/.test(n.w.location.hash));
});
