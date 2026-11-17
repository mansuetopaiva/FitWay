// Tela de pagamento com preço único: um botão "Pagar R$ X" e a frase do checkout. Não clica (não chama o InfinitePay).
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
process.env.INFINITEPAY_HANDLE = "exemplo"; process.env.SITE_URL = "https://f.exemplo.com";
const { sql, chamar } = await abrir();

test("um botão só, com o preço do tipo; sem a escolha de meio", async () => {
  const t = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "123456" })).token;
  for (const [id, tipo, preco] of [["PA", "inicial", "R$ 9,99"], ["PB", "novo_treino", "R$ 4,99"]]) {
    await sql`delete from pedidos`;
    await sql`insert into pedidos (id, email, tipo, status, valor) values (${id}, 'ana@x.com', ${tipo}, 'aguardando_pagamento', 1)`;
    const n = await navegador(chamar, { hash: "#/pagamento/" + id, token: t });
    await n.espera(() => n.$("[data-pagar]"));
    assert.equal(n.w.document.querySelectorAll("[data-pagar]").length, 1);
    assert.equal(n.$("[data-pagar]").textContent.trim(), "Pagar " + preco);
    assert.match(n.texto(), /Você escolhe Pix ou cartão na página segura da InfinitePay e volta para cá depois de pagar\./);
    assert.doesNotMatch(n.texto(), /Como quer pagar|Cartão de crédito —|11,99|5,99/);
    assert.deepEqual(n.erros.map(String), []);
  }
});

test("sem as variáveis: Pagamento indisponível", async () => {
  const t = (await chamar({ acao: "criar", nome: "Bia", email: "bia@x.com", senha: "123456" })).token;
  await sql`insert into pedidos (id, email, tipo, status, valor) values ('PC', 'bia@x.com', 'inicial', 'aguardando_pagamento', 999)`;
  delete process.env.INFINITEPAY_HANDLE;
  try {
    const n = await navegador(chamar, { hash: "#/pagamento/PC", token: t });
    await n.espera(() => /Pagamento indisponível no momento/.test(n.texto()));
    assert.ok(!n.$("[data-pagar]"));
  } finally { process.env.INFINITEPAY_HANDLE = "exemplo"; }
});
