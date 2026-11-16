import { test } from "node:test";
import assert from "node:assert/strict";
import { ACOES, acaoPagamento, aplicarPagamento } from "../api/_pagamento.js";

Object.assign(process.env, { INFINITEPAY_HANDLE: "exemplo", SITE_URL: "https://exemplo.app/" });
const u = { email: "a@x.com", nome: "Ana" };

// Banco simulado: "pedido" é a linha que o select do pedido devolve; o resto responde por prefixo da consulta.
function sqlFalso(pedido, responder = () => []) {
  const chamadas = [];
  const sql = async (partes, ...valores) => {
    const q = partes.join("?");
    chamadas.push({ q, valores });
    if (q.startsWith("select id, tipo, status, metodo")) return pedido && valores.includes(u.email) ? [pedido] : [];
    return responder(q, valores);
  };
  return { sql, chamadas };
}
const pend = (o = {}) => ({ id: "p1", tipo: "inicial", status: "aguardando_pagamento", metodo: null, valor: 999, ...o });
const eco = (q) => (q.startsWith("update pedidos") ? [{ id: "p1", status: "aguardando_pagamento" }] : []);

test("pagamento: só pedido da própria conta; devolve os meios com o valor, sem link do Pix, recebedor nem código", async () => {
  let s = sqlFalso(null);
  assert.equal((await acaoPagamento(s.sql, u, { acao: "pagamento", id: "p1" })).status, 404);
  assert.ok(s.chamadas[0].valores.includes("a@x.com"), "o select filtra pelo email da sessão");
  s = sqlFalso(pend({ tipo: "novo_treino" }));
  const r = await acaoPagamento(s.sql, u, { acao: "pagamento", id: "p1" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.metodos, [{ metodo: "pix", valor: 499 }, { metodo: "cartao", valor: 599 }]);
  assert.deepEqual(Object.keys(r.corpo).sort(), ["metodos", "pedido"]);
  assert.deepEqual(Object.keys(r.corpo.pedido).sort(), ["id", "metodo", "status", "tipo", "valor"], "nem o link guardado nem o código voltam pela tela");
  for (const id of [undefined, "a b", "x".repeat(41), 5]) assert.equal((await acaoPagamento(s.sql, u, { acao: "pagamento", id })).status, 400);
});




test("nenhuma ação do usuário grava pago", async () => {
  for (const acao of ACOES) {
    const s = sqlFalso(pend({ metodo: "pix" }), eco);
    const fetch = async () => ({ ok: true, status: 200, json: async () => ({ url: "https://checkout.exemplo/x", success: false, paid: false }) });
    await acaoPagamento(s.sql, u, { acao, id: "p1", metodo: "pix", order_nsu: "p1", transaction_nsu: "t1", slug: "s1" }, { fetch });
    for (const c of s.chamadas) {
      assert.doesNotMatch(c.q, /status = '(pago|pronto)'|status = \?/, `${acao}: ${c.q.slice(0, 60)}`);
      assert.ok(!c.valores.includes("pago") && !c.valores.includes("pronto"), acao);
    }
  }
});

test("aplicarPagamento: pedido, acesso e log numa instrução; UPDATE condicional pelo status de origem", async () => {
  const casos = [["inicial", "pago", 30, 999], ["mensalidade", "pronto", 30, 1199], ["novo_treino", "pago", 0, 599]];
  for (const [tipo, status, dias, valor] of casos) {
    const chamadas = [];
    const sql = async (partes, ...valores) => { chamadas.push({ q: partes.join("?"), valores }); return [{ status }]; };
    const x = await aplicarPagamento(sql, { id: "p1", tipo }, { quem: "infinitepay", de: ["aguardando_pagamento"], valor, transaction_nsu: "tx-1", capture_method: "pix" });
    assert.equal(x.status, status);
    assert.equal(chamadas.length, 1);
    const [w] = chamadas;
    assert.match(w.q, /update pedidos set status = .*where id = \? and status = any\(\?::text\[\]\) and tipo = \?.*update usuarios set acesso_ate = greatest\(now\(\), acesso_ate\).*insert into admin_log/s);
    assert.deepEqual(w.valores.slice(0, 3), [status, valor, "infinitepay"], "valor pago, vindo do payment_check");
    assert.doesNotMatch(w.q, /metodo = \?/, "o meio escolhido não muda");
    assert.ok(w.valores.includes("tx-1"));
    assert.ok(w.valores.filter((v) => v === dias).length >= 2, `${tipo}: dias`);
  }
  const sql = async () => [];
  assert.equal(await aplicarPagamento(sql, { id: "p1", tipo: "inicial" }, { quem: "x", valor: 999, de: ["aguardando_pagamento"] }), null, "segunda vez: nada");
  assert.equal(await aplicarPagamento(sql, { id: "p1", tipo: "toString" }, { quem: "x", valor: 999, de: [] }), null);
  for (const valor of [undefined, 0, -1, 9.5, "999"]) assert.equal(await aplicarPagamento(async () => { throw new Error("não devia gravar"); }, { id: "p1", tipo: "inicial" }, { quem: "x", valor, de: [] }), null, String(valor));
});


