import { test } from "node:test";
import assert from "node:assert/strict";
import { ACOES, acaoPagamento, aplicarPagamento, lerE2E } from "../api/_pagamento.js";

const L999 = "https://nubank.com.br/cobrar/exemplo999", L499 = "https://nubank.com.br/cobrar/exemplo499";
Object.assign(process.env, { PIX_LINK_999: L999, PIX_LINK_499: L499, PIX_TITULAR_EXIBIDO: "Fulana", INFINITEPAY_HANDLE: "exemplo", SITE_URL: "https://exemplo.app/" });
const u = { email: "a@x.com", nome: "Ana" };
const E2E = "E" + "1234567890ABCDEFGHIJabcdefghij1";
const JPEG = "data:image/jpeg;base64,QUJD";

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
const pend = (o = {}) => ({ id: "p1", tipo: "inicial", status: "aguardando_pagamento", metodo: null, valor: 999, codigo: "FWABCDEF", mensagem_usuario: null, checkout_url: null, ...o });
const eco = (q, v) => (q.startsWith("update pedidos") ? [{ id: "p1", status: q.includes("'aguardando_confirmacao'") ? "aguardando_confirmacao" : "aguardando_pagamento" }] : []);

test("lerE2E: E + 31 letras ou números; espaços nas pontas saem, no meio não", () => {
  assert.equal(lerE2E(E2E), E2E);
  assert.equal(lerE2E("  " + E2E + "\n"), E2E);
  for (const ruim of [E2E.slice(1), "e" + E2E.slice(1), E2E.slice(0, 31), E2E + "X", E2E.slice(0, 10) + " " + E2E.slice(11), E2E.slice(0, 31) + "-", "", null, 5, undefined])
    assert.equal(lerE2E(ruim), "", JSON.stringify(ruim));
});

test("pagamento: só pedido da própria conta; devolve meios com o valor, link do Pix e recebedor", async () => {
  let s = sqlFalso(null);
  assert.equal((await acaoPagamento(s.sql, u, { acao: "pagamento", id: "p1" })).status, 404);
  assert.ok(s.chamadas[0].valores.includes("a@x.com"), "o select filtra pelo email da sessão");
  s = sqlFalso(pend({ tipo: "novo_treino" }));
  const r = await acaoPagamento(s.sql, u, { acao: "pagamento", id: "p1" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.metodos, [{ metodo: "pix", valor: 499 }, { metodo: "cartao", valor: 599 }]);
  assert.deepEqual(r.corpo.pix, { link: L499, recebedor: "Fulana" });
  assert.equal(r.corpo.pedido.checkout_url, undefined, "o link do cartão não volta pela tela");
  for (const id of [undefined, "a b", "x".repeat(41), 5]) assert.equal((await acaoPagamento(s.sql, u, { acao: "pagamento", id })).status, 400);
});

test("pagamento: sem o link do valor do pedido, o Pix não aparece e pedido_metodo recusa o Pix", async () => {
  const antes = process.env.PIX_LINK_499;
  delete process.env.PIX_LINK_499;
  try {
    const s = sqlFalso(pend({ tipo: "novo_treino" }), eco);
    const r = await acaoPagamento(s.sql, u, { acao: "pagamento", id: "p1" });
    assert.deepEqual(r.corpo.metodos.map((m) => m.metodo), ["cartao"]);
    assert.equal(r.corpo.pix, null);
    assert.equal((await acaoPagamento(s.sql, u, { acao: "pedido_metodo", id: "p1", metodo: "pix" })).status, 400);
    assert.ok(!s.chamadas.some((c) => c.q.startsWith("update")), "nada gravado");
  } finally { process.env.PIX_LINK_499 = antes; }
});

test("pedido_metodo: trocar de meio recalcula o valor no servidor, só em aguardando_pagamento", async () => {
  for (const [metodo, valor] of [["pix", 999], ["cartao", 1199]]) {
    const s = sqlFalso(pend(), eco);
    const r = await acaoPagamento(s.sql, u, { acao: "pedido_metodo", id: "p1", metodo, valor: 1 });
    assert.equal(r.status, 200, metodo);
    const w = s.chamadas.find((c) => c.q.startsWith("update pedidos"));
    assert.deepEqual(w.valores.slice(0, 2), [metodo, valor], "valor de PRECOS, nunca do navegador");
    assert.match(w.q, /and email = \? and status = 'aguardando_pagamento'/);
  }
  for (const metodo of ["boleto", "toString", "__proto__", undefined]) {
    const s = sqlFalso(pend(), eco);
    assert.equal((await acaoPagamento(s.sql, u, { acao: "pedido_metodo", id: "p1", metodo })).status, 400, String(metodo));
  }
  for (const status of ["aguardando_confirmacao", "pago", "pronto", "cancelado"]) {
    const s = sqlFalso(pend({ status }), eco);
    assert.equal((await acaoPagamento(s.sql, u, { acao: "pedido_metodo", id: "p1", metodo: "cartao" })).status, 400, status);
    assert.ok(!s.chamadas.some((c) => c.q.startsWith("update")), `${status}: nada muda`);
  }
  // Pagou entre o select e o update: o UPDATE condicional não acha a linha.
  const s = sqlFalso(pend(), () => []);
  assert.equal((await acaoPagamento(s.sql, u, { acao: "pedido_metodo", id: "p1", metodo: "pix" })).status, 400);
});

test("pix_avisei: comprovante obrigatório, nome de 2 a 80, ID opcional no formato; só Pix da própria conta", async () => {
  const ok = { acao: "pix_avisei", id: "p1", pagador_nome: "  Ana   Souza ", comprovante: JPEG };
  let s = sqlFalso(pend({ metodo: "pix" }), eco);
  let r = await acaoPagamento(s.sql, u, ok);
  assert.equal(r.status, 200);
  let w = s.chamadas.find((c) => c.q.startsWith("update pedidos"));
  assert.match(w.q, /set status = 'aguardando_confirmacao'.*aviso_em = now\(\), mensagem_usuario = null/s);
  assert.match(w.q, /email = \? and metodo = 'pix' and status = 'aguardando_pagamento'/);
  assert.deepEqual(w.valores.slice(0, 3), ["Ana Souza", JPEG, null]);
  assert.ok(w.valores.includes("a@x.com"));

  s = sqlFalso(pend({ metodo: "pix" }), eco);
  r = await acaoPagamento(s.sql, u, { ...ok, pix_e2e: " " + E2E + " " });
  assert.equal(r.status, 200);
  assert.equal(s.chamadas.find((c) => c.q.startsWith("update pedidos")).valores[2], E2E, "ID informado vai para pix_e2e_informado");
  s = sqlFalso(pend({ metodo: "pix" }), eco);
  assert.equal((await acaoPagamento(s.sql, u, { ...ok, pix_e2e: "   " })).status, 200, "em branco é o mesmo que não informar");

  for (const ruim of [{ comprovante: undefined }, { comprovante: "" }, { comprovante: "data:image/png;base64,QUJD" }, { comprovante: JPEG + "\"><script>" },
    { comprovante: "data:image/jpeg;base64," + "A".repeat(409700) }, { pagador_nome: "A" }, { pagador_nome: "x".repeat(81) }, { pagador_nome: 5 },
    { pix_e2e: "E123" }, { pix_e2e: E2E.slice(0, 10) + " " + E2E.slice(11) }, { pix_e2e: 5 }]) {
    s = sqlFalso(pend({ metodo: "pix" }), eco);
    assert.equal((await acaoPagamento(s.sql, u, { ...ok, ...ruim })).status, 400, JSON.stringify(ruim).slice(0, 60));
    assert.ok(!s.chamadas.some((c) => c.q.startsWith("update")), "nada gravado");
  }
  // Pedido de cartão, já avisado ou de outra conta: o UPDATE condicional não acha a linha.
  s = sqlFalso(pend({ metodo: "cartao" }), () => []);
  assert.equal((await acaoPagamento(s.sql, u, ok)).status, 400);
  s = sqlFalso(null, eco);
  assert.equal((await acaoPagamento(s.sql, u, ok)).status, 404, "outra conta");
});

test("nenhuma ação do usuário grava pago", async () => {
  for (const acao of ACOES) {
    const s = sqlFalso(pend({ metodo: "pix" }), eco);
    const fetch = async () => ({ ok: true, status: 200, json: async () => ({ url: "https://checkout.exemplo/x", success: false, paid: false }) });
    await acaoPagamento(s.sql, u, { acao, id: "p1", metodo: "pix", pagador_nome: "Ana", comprovante: JPEG, order_nsu: "p1", transaction_nsu: "t1", slug: "s1" }, { fetch });
    for (const c of s.chamadas) {
      assert.doesNotMatch(c.q, /status = '(pago|pronto)'|status = \?/, `${acao}: ${c.q.slice(0, 60)}`);
      assert.ok(!c.valores.includes("pago") && !c.valores.includes("pronto"), acao);
    }
  }
});

test("aplicarPagamento: pedido, acesso e log numa instrução; UPDATE condicional pelo status de origem", async () => {
  const casos = [["inicial", "pago", 30, 999], ["mensalidade", "pronto", 30, 999], ["novo_treino", "pago", 0, 499]];
  for (const [tipo, status, dias, valor] of casos) {
    const chamadas = [];
    const sql = async (partes, ...valores) => { chamadas.push({ q: partes.join("?"), valores }); return [{ status }]; };
    const x = await aplicarPagamento(sql, { id: "p1", tipo }, { quem: "dono@x.com", metodo: "pix", de: ["aguardando_confirmacao", "aguardando_pagamento"], pix_e2e: E2E, exigirAcesso: true });
    assert.equal(x.status, status);
    assert.equal(chamadas.length, 1);
    const [w] = chamadas;
    assert.match(w.q, /update pedidos set status = .*where id = \? and status = any\(\?::text\[\]\) and tipo = \?.*update usuarios set acesso_ate = greatest\(now\(\), acesso_ate\).*insert into admin_log/s);
    assert.deepEqual(w.valores.slice(0, 4), [status, "pix", valor, "dono@x.com"]);
    assert.ok(w.valores.includes(E2E));
    assert.ok(w.valores.filter((v) => v === dias).length >= 2, `${tipo}: dias`);
  }
  const sql = async () => [];
  assert.equal(await aplicarPagamento(sql, { id: "p1", tipo: "inicial" }, { quem: "x", metodo: "pix", de: ["aguardando_pagamento"] }), null, "segunda vez: nada");
  assert.equal(await aplicarPagamento(sql, { id: "p1", tipo: "toString" }, { quem: "x", metodo: "pix", de: [] }), null);
  assert.equal(await aplicarPagamento(sql, { id: "p1", tipo: "inicial" }, { quem: "x", metodo: "boleto", de: [] }), null);
});

test("pagamento: sem PIX_TITULAR_EXIBIDO o recebedor vem vazio; pedido antigo sem código ganha um ao abrir", async () => {
  const antes = process.env.PIX_TITULAR_EXIBIDO;
  delete process.env.PIX_TITULAR_EXIBIDO;
  try {
    const s = sqlFalso(pend({ codigo: null }), (q, v) => (q.startsWith("update pedidos set codigo") ? [{ codigo: v[0] }] : []));
    const r = await acaoPagamento(s.sql, u, { acao: "pagamento", id: "p1" });
    assert.deepEqual(r.corpo.pix, { link: L999, recebedor: "" });
    assert.match(r.corpo.pedido.codigo, /^FW[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    assert.match(s.chamadas.find((c) => c.q.startsWith("update pedidos set codigo")).q, /coalesce\(codigo, \?\)/, "nunca troca um código que já existe");
  } finally { process.env.PIX_TITULAR_EXIBIDO = antes; }
});

test("dataDoE2E: lê a data do ID e recusa datas impossíveis", async () => {
  const { dataDoE2E } = await import("../api/_pagamento.js");
  assert.equal(dataDoE2E("E18236120202611161430AbC123def45").toISOString(), "2026-11-16T14:30:00.000Z");
  for (const ruim of ["E18236120202613161430AbC123def45", "E18236120202602301430AbC123def45", "E18236120202611162530AbC123def45", "E1823612X202611161430AbC123def45", "", null])
    assert.equal(dataDoE2E(ruim), null, String(ruim));
});
