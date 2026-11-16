// api/infinitepay.js de verdade, com o banco e o fetch simulados (precisa de --experimental-test-module-mocks, já no "npm test").
import { test, mock } from "node:test";
import assert from "node:assert/strict";

process.env.INFINITEPAY_HANDLE = "exemplo";
const chamadas = [];
let responder = () => [];
const sql = async (partes, ...valores) => { const q = partes.join("?"); chamadas.push({ q, valores }); return responder(q, valores); };
mock.module(import.meta.resolve("@neondatabase/serverless"), { exports: { neon: () => sql } });
const { default: handler } = await import("../api/infinitepay.js");

let pc = [];
const resposta = (status, json) => async (url, opc) => { pc.push(JSON.parse(opc.body)); return { ok: status < 300, status, json: async () => json }; };
async function chamar(body, method = "POST") {
  let status = 200;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  await handler({ method, headers: { "content-type": "application/json" }, body }, res);
  return status;
}
const corpo = { invoice_slug: "s-abc", amount: 1199, paid_amount: 1199, installments: 1, capture_method: "credit_card", transaction_nsu: "tx-1", order_nsu: "p1", receipt_url: "https://x", items: [] };
const elegivel = (q) => (q.startsWith("select id, tipo, status, email, transaction_nsu") ? [{ id: "p1", tipo: "inicial", status: "aguardando_pagamento", email: "a@x.com", transaction_nsu: null }]
  : q.startsWith("update pedidos set checado_em") ? [{ id: "p1" }] : q.startsWith("with p as") ? [{ status: "pago" }] : []);

test("webhook: usa o payment_check e nunca o amount nem o paid do corpo", async () => {
  responder = elegivel; chamadas.length = 0; pc = [];
  globalThis.fetch = resposta(200, { success: true, paid: false, amount: 1199, paid_amount: 0 });
  assert.equal(await chamar({ ...corpo, paid: true, paid_amount: 999999 }), 200, "forjado: 200 para não reenviar, mas não paga");
  assert.deepEqual(pc[0], { handle: "exemplo", order_nsu: "p1", transaction_nsu: "tx-1", slug: "s-abc" });
  assert.ok(!chamadas.some((c) => c.q.startsWith("with p as")));
  globalThis.fetch = resposta(200, { success: true, paid: true, amount: 1199, paid_amount: 1199 });
  assert.equal(await chamar(corpo), 200);
  assert.ok(chamadas.some((c) => c.q.startsWith("with p as")));
});

test("webhook: erro temporário do payment_check responde 400 (o InfinitePay reenvia)", async () => {
  responder = elegivel; chamadas.length = 0;
  globalThis.fetch = resposta(503, {});
  assert.equal(await chamar(corpo), 400);
  globalThis.fetch = async () => { throw new Error("rede"); };
  assert.equal(await chamar(corpo), 400);
  responder = () => { throw new Error("banco fora"); };
  assert.equal(await chamar(corpo), 400, "banco fora também é temporário");
});

test("webhook: pedido de Pix ou corpo inválido responde 200 sem chamar o InfinitePay; GET é 405", async () => {
  responder = () => []; pc = [];
  globalThis.fetch = resposta(200, { success: true, paid: true, paid_amount: 1199 });
  assert.equal(await chamar(corpo), 200);
  assert.equal(await chamar("isto não é json"), 200);
  assert.equal(await chamar(JSON.stringify(corpo)), 200, "corpo em texto (pedido de Pix: ignorado)");
  assert.equal(await chamar(null), 200);
  assert.equal(pc.length, 0);
  assert.equal(await chamar(corpo, "GET"), 405);
});

test("webhook: corpo em texto chega ao payment_check", async () => {
  responder = elegivel; pc = [];
  globalThis.fetch = resposta(200, { success: true, paid: true, paid_amount: 1199 });
  assert.equal(await chamar(JSON.stringify(corpo)), 200);
  assert.deepEqual(pc[0], { handle: "exemplo", order_nsu: "p1", transaction_nsu: "tx-1", slug: "s-abc" });
});
