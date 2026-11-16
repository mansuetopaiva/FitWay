import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
process.env.ADMIN_EMAILS = "dono@x.com";
const { sql, R } = await abrir();
const { acaoAdmin } = await import(R + "api/_admin.js");
const dono = { email: "dono@x.com" };
const dia = 864e5;

async function cenario(email, acessoDias, plano) {
  await sql`insert into usuarios (email, nome, senha, dados, acesso_ate) values (${email}, 'A', 'x', ${JSON.stringify(plano ? { plano } : {})}::jsonb,
    ${acessoDias === null ? null : new Date(Date.now() + acessoDias * dia).toISOString()}::timestamptz)`;
}
const pedido = (id, email, tipo, status) => sql`insert into pedidos (id, email, tipo, status, valor, pago_em) values (${id}, ${email}, ${tipo}, ${status}, 999, now())`;
const acesso = async (e) => (await sql`select acesso_ate from usuarios where email = ${e}`)[0].acesso_ate;
const diasRestantes = async (e) => Math.round((new Date(await acesso(e)) - Date.now()) / dia);

test("tira só os 30 dias daquele pedido; dois cliques não tiram 60", async () => {
  await cenario("a@x.com", 60, { pedido: "i1", origem: "ia" }); // inicial + mensalidade
  await pedido("i1", "a@x.com", "inicial", "pronto"); await pedido("m1", "a@x.com", "mensalidade", "pronto");
  let r = await acaoAdmin(sql, dono, { op: "pedido_estornar", id: "m1", motivo: "desistencia" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(await diasRestantes("a@x.com"), 30);
  r = await acaoAdmin(sql, dono, { op: "pedido_estornar", id: "m1", motivo: "desistencia" });
  assert.equal(r.status, 400);
  assert.equal(await diasRestantes("a@x.com"), 30);
  const [u] = await sql`select dados from usuarios where email = 'a@x.com'`;
  assert.ok(u.dados.plano, "a mensalidade não gerou o treino: ele fica");
  const [p] = await sql`select status, estornado_em, estornado_por from pedidos where id = 'm1'`;
  assert.equal(p.status, "cancelado"); assert.ok(p.estornado_em); assert.equal(p.estornado_por, "dono@x.com");
  const [l] = await sql`select detalhes from admin_log where acao = 'pedido_estornado'`;
  assert.equal(l.detalhes.motivo, "Desistência em 7 dias"); assert.equal(l.detalhes.valor, 999); assert.equal(l.detalhes.dias, 30);
});

test("nunca deixa acesso_ate antes de now(); sem acesso não inventa acesso", async () => {
  await cenario("b@x.com", 10, null); await pedido("b1", "b@x.com", "inicial", "pago");
  await acaoAdmin(sql, dono, { op: "pedido_estornar", id: "b1", motivo: "duplicado" });
  const a = new Date(await acesso("b@x.com"));
  assert.ok(a <= new Date() && a > Date.now() - 60000, "fica em now()");
  await cenario("c@x.com", -5, null); await pedido("c1", "c@x.com", "mensalidade", "pronto");
  const antes = await acesso("c@x.com");
  await acaoAdmin(sql, dono, { op: "pedido_estornar", id: "c1", motivo: "duplicado" });
  assert.equal(String(await acesso("c@x.com")), String(antes), "vencido não volta para now()");
  await cenario("d@x.com", null, null); await pedido("d1", "d@x.com", "mensalidade", "pronto");
  await acaoAdmin(sql, dono, { op: "pedido_estornar", id: "d1", motivo: "duplicado" });
  assert.equal(await acesso("d@x.com"), null);
});

test("treino sai só se for o do pedido estornado; novo treino não mexe nos dias", async () => {
  await cenario("e@x.com", 20, { pedido: "n1", origem: "ia", treinos: [] }); await pedido("n1", "e@x.com", "novo_treino", "pronto");
  await acaoAdmin(sql, dono, { op: "pedido_estornar", id: "n1", motivo: "outro", texto: "erro" });
  const [u] = await sql`select dados from usuarios where email = 'e@x.com'`;
  assert.equal(u.dados.plano, undefined);
  assert.equal(await diasRestantes("e@x.com"), 20);
  const [l] = await sql`select detalhes from admin_log where acao = 'pedido_estornado' and detalhes->>'pedido' = 'n1'`;
  assert.equal(l.detalhes.treino_removido, true); assert.equal(l.detalhes.texto, "erro");
  await cenario("f@x.com", 20, { pedido: "outro", origem: "ia" }); await pedido("f1", "f@x.com", "novo_treino", "pronto");
  await acaoAdmin(sql, dono, { op: "pedido_estornar", id: "f1", motivo: "duplicado" });
  assert.ok((await sql`select dados from usuarios where email = 'f@x.com'`)[0].dados.plano);
});

test("não estorna pedido aberto nem cancelado", async () => {
  await cenario("g@x.com", 0, null); await pedido("g1", "g@x.com", "inicial", "aguardando_pagamento");
  assert.equal((await acaoAdmin(sql, dono, { op: "pedido_estornar", id: "g1", motivo: "duplicado" })).status, 400);
});

test("marcar como devolvido tira da lista do resumo, uma vez", async () => {
  await sql`insert into admin_log (admin_email, acao, alvo_email, detalhes) values ('infinitepay', 'cartao_sem_pedido', 'a@x.com', '{"transaction_nsu":"tx9","paid_amount":999,"motivo":"pedido_fechado"}')`;
  let r = await acaoAdmin(sql, dono, { op: "resumo" });
  assert.equal(r.corpo.cartaoSemPedido.length, 1);
  assert.equal((await acaoAdmin(sql, dono, { op: "devolucao_marcar", transaction_nsu: "tx9" })).status, 200);
  assert.equal((await acaoAdmin(sql, dono, { op: "devolucao_marcar", transaction_nsu: "tx9" })).status, 400);
  r = await acaoAdmin(sql, dono, { op: "resumo" });
  assert.equal(r.corpo.cartaoSemPedido.length, 0);
  assert.equal(r.corpo.receitaMes, 999 * 2, "pedidos estornados não contam (só i1 e c... restantes)");
});

test("estornar o novo treino devolve o treino do pedido pronto anterior; cancelado depois de pago também estorna", async () => {
  await cenario("h@x.com", 20, { pedido: "hn", origem: "ia", nome: "B" });
  await sql`insert into pedidos (id, email, tipo, status, valor, pago_em, gerado_em, plano_gerado) values
    ('hi', 'h@x.com', 'inicial', 'pronto', 999, now() - interval '60 days', now() - interval '60 days', '{"pedido":"hi","origem":"ia","nome":"A"}'),
    ('hn', 'h@x.com', 'novo_treino', 'pronto', 499, now(), now(), '{"pedido":"hn","origem":"ia","nome":"B"}')`;
  assert.equal((await acaoAdmin(sql, dono, { op: "pedido_estornar", id: "hn", motivo: "desistencia" })).status, 200);
  const [u] = await sql`select dados from usuarios where email = 'h@x.com'`;
  assert.equal(u.dados.plano.nome, "A"); assert.equal(u.dados.proximo, "A");
  await cenario("k@x.com", 30, null);
  await sql`insert into pedidos (id, email, tipo, status, valor, pago_em) values ('kc', 'k@x.com', 'mensalidade', 'cancelado', 999, now())`;
  assert.equal((await acaoAdmin(sql, dono, { op: "pedido_estornar", id: "kc", motivo: "desistencia" })).status, 200);
  assert.equal(await diasRestantes("k@x.com") + 0, 0);
  await sql`insert into pedidos (id, email, tipo, status, valor) values ('kn', 'k@x.com', 'mensalidade', 'cancelado', 999)`;
  assert.equal((await acaoAdmin(sql, dono, { op: "pedido_estornar", id: "kn", motivo: "desistencia" })).status, 400, "cancelado sem pagamento não");
});
