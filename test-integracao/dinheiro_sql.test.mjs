// SQL real (PGlite) do dinheiro e da entrega: dias de acesso ao pagar e gravação do plano gerado no aluno.
// O banco falso dos testes unitários não roda estas duas instruções; aqui elas rodam em Postgres de verdade.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { planoIA, comTermo } from "../test/_fixtures.js";
comTermo();
process.env.INFINITEPAY_HANDLE = "handle-teste";
const { sql, R } = await abrir();
const { aplicarPagamento, confirmarPagamento } = await import(R + "api/_pagamento.js");
const { gerarSeDevido } = await import(R + "api/_ia.js");
const dia = 864e5, ABERTO = ["aguardando_pagamento", "aguardando_confirmacao"];

const aluno = (email, acessoDias, dados = {}) => sql`insert into usuarios (email, nome, senha, dados, acesso_ate) values (${email}, 'A', 'x', ${JSON.stringify(dados)}::jsonb,
  ${acessoDias === null ? null : new Date(Date.now() + acessoDias * dia).toISOString()}::timestamptz)`;
const pedido = (id, email, tipo, status = "aguardando_pagamento", extra = {}) => sql`insert into pedidos (id, email, tipo, status, valor, respostas, checkout_url)
  values (${id}, ${email}, ${tipo}, ${status}, 999, ${JSON.stringify(extra.respostas || null)}::jsonb, 'https://checkout.infinitepay.io/x')`;
const dias = async (email) => { const [u] = await sql`select acesso_ate from usuarios where email = ${email}`; return u.acesso_ate && (new Date(u.acesso_ate) - Date.now()) / dia; };
const status = async (id) => (await sql`select status from pedidos where id = ${id}`)[0].status;
const paga = (id, tipo, extra = {}) => aplicarPagamento(sql, { id, tipo }, { quem: "infinitepay", de: ABERTO, valor: 999, ...extra });
const perto = (x, esperado, msg) => assert.ok(Math.abs(x - esperado) < 0.01, `${msg}: ${x} dias, esperado ${esperado}`);

test("inicial: sem acesso ganha 30 dias a partir de agora; o pedido vai para 'pago' (falta gerar o treino)", async () => {
  await aluno("a@x.com", null); await pedido("a1", "a@x.com", "inicial");
  const r = await paga("a1", "inicial");
  assert.equal(r.status, "pago");
  perto(await dias("a@x.com"), 30, "inicial");
});

test("mensalidade com acesso ativo soma 30 dias ao que sobra; vencida soma a partir de agora; vai para 'pronto'", async () => {
  await aluno("b@x.com", 10); await pedido("b1", "b@x.com", "mensalidade");
  assert.equal((await paga("b1", "mensalidade")).status, "pronto");
  perto(await dias("b@x.com"), 40, "ativo");
  await aluno("c@x.com", -20); await pedido("c1", "c@x.com", "mensalidade");
  await paga("c1", "mensalidade");
  perto(await dias("c@x.com"), 30, "vencido");
});

test("novo treino não mexe nos dias e fica 'pago' para gerar", async () => {
  await aluno("d@x.com", 12); await pedido("d1", "d@x.com", "novo_treino");
  assert.equal((await paga("d1", "novo_treino")).status, "pago");
  perto(await dias("d@x.com"), 12, "novo treino");
});

test("pagar duas vezes o mesmo pedido (cliques ou webhook repetido) soma os dias uma vez só", async () => {
  await aluno("e@x.com", 5); await pedido("e1", "e@x.com", "mensalidade");
  assert.ok(await paga("e1", "mensalidade", { transaction_nsu: "t-e" }));
  assert.equal(await paga("e1", "mensalidade", { transaction_nsu: "t-e" }), null);
  assert.equal(await paga("e1", "mensalidade"), null);
  perto(await dias("e@x.com"), 35, "dobrado");
  const l = await sql`select 1 from admin_log where acao = 'pedido_pago' and detalhes->>'pedido' = 'e1'`;
  assert.equal(l.length, 1);
});

test("webhook do InfinitePay: paga o pedido uma vez; o mesmo webhook de novo é ignorado", async () => {
  await aluno("f@x.com", 0); await pedido("f1", "f@x.com", "mensalidade");
  const fetch = async () => ({ ok: true, json: async () => ({ success: true, paid: true, paid_amount: 999, amount: 999, capture_method: "pix", order_nsu: "f1" }) });
  const ref = { order_nsu: "f1", transaction_nsu: "tx-f1", slug: "slug-f1" };
  assert.equal(await confirmarPagamento(sql, ref, { fetch }), "pago");
  assert.equal(await confirmarPagamento(sql, ref, { fetch }), "ignorado");
  assert.equal(await status("f1"), "pronto");
  perto(await dias("f@x.com"), 30, "webhook");
});

const respostas = () => ({
  objetivo: ["Definir"], nivel: "Nunca treinei", idade: 40, sexo: "Masculino", altura: 180, peso: 90,
  dias: 4, minutos: 45, parq: Array(7).fill(false), liberacao: false, observacoes: "", consentimentos: { dados: true },
});
const iaOk = (contador) => async () => { contador.n++; await new Promise((r) => setTimeout(r, 15)); return { stop_reason: "end_turn", model: "m", content: [{ type: "text", text: JSON.stringify(planoIA()) }] }; };

// Limite: a proteção é o UPDATE condicional (where status = 'pago'); no Postgres real a 2ª chamada espera o bloqueio da linha e
// reavalia o where já com 'gerando'. O PGlite tem uma conexão só e enfileira as consultas: aqui se prova que a condição é
// exclusiva (a 2ª não acha a linha), não a concorrência de verdade entre conexões.
test("plano gerado é gravado no aluno certo, em dados.plano, com proximo 'A', sem apagar o resto; uma só chamada à IA", async () => {
  await aluno("g@x.com", 30, { checkins: ["2026-11-01"], cargas: { x: 1 } }); await aluno("h@x.com", 30, { plano: { origem: "pdf" } });
  await pedido("g1", "g@x.com", "inicial", "pago", { respostas: respostas() });
  const c = { n: 0 };
  const r = await Promise.all([gerarSeDevido(sql, "g1", { ia: iaOk(c) }), gerarSeDevido(sql, "g1", { ia: iaOk(c) })]);
  assert.deepEqual(r.sort(), [false, true]); assert.equal(c.n, 1);
  assert.equal(await status("g1"), "pronto");
  const [u] = await sql`select dados from usuarios where email = 'g@x.com'`;
  assert.equal(u.dados.plano.pedido, "g1"); assert.equal(u.dados.plano.origem, "ia"); assert.equal(u.dados.proximo, "A");
  assert.equal(u.dados.plano.treinos.length, 2);
  assert.deepEqual(u.dados.checkins, ["2026-11-01"]); assert.deepEqual(u.dados.cargas, { x: 1 });
  const [o] = await sql`select dados from usuarios where email = 'h@x.com'`;
  assert.deepEqual(o.dados, { plano: { origem: "pdf" } }, "outro aluno não muda");
  const [p] = await sql`select plano_gerado from pedidos where id = 'g1'`;
  assert.equal(p.plano_gerado.pedido, "g1");
});

test("novo treino troca o plano antigo; falha da IA devolve o pedido para 'pago' e depois 'erro', sem tocar no plano", async () => {
  await aluno("i@x.com", 30, { plano: { origem: "ia", pedido: "velho" }, proximo: "B" }); await pedido("i1", "i@x.com", "novo_treino", "pago", { respostas: respostas() });
  const falha = async () => ({ stop_reason: "refusal", content: [] });
  assert.equal(await gerarSeDevido(sql, "i1", { ia: falha }), false); assert.equal(await status("i1"), "pago");
  assert.equal(await gerarSeDevido(sql, "i1", { ia: falha }), false); assert.equal(await status("i1"), "erro");
  assert.equal((await sql`select dados from usuarios where email = 'i@x.com'`)[0].dados.plano.pedido, "velho");
  await sql`update pedidos set status = 'pago', tentativas = 0 where id = 'i1'`;
  assert.equal(await gerarSeDevido(sql, "i1", { ia: iaOk({ n: 0 }) }), true);
  const [u] = await sql`select dados from usuarios where email = 'i@x.com'`;
  assert.equal(u.dados.plano.pedido, "i1"); assert.equal(u.dados.proximo, "A");
});
