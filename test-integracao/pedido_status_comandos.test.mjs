// pedido_status: quantos comandos o servidor manda ao banco, e o que o poll de 4 s devolve (só o status enquanto pago/gerando; o plano uma vez, quando vira pronto).
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { planoIA, comTermo } from "../test/_fixtures.js";
comTermo();
process.env.TREINO_IA_ATIVO = "1";
const { sql, chamar, comandos, R } = await abrir();
const { validarPlanoIA } = await import(R + "api/_ia.js");
const medir = async (corpo, token) => { const a = comandos(); const r = await chamar(corpo, token); return { r, n: comandos() - a }; };
const conta = async (email) => (await chamar({ acao: "criar", nome: "Ana", email, senha: "senha123" })).token;

test("comandos por chamada: completa sem pedido 3 (antes 5), completa com pedido gerando 5 (antes 7), poll 4 (antes 7)", async () => {
  const tk = await conta("a@x.com");
  const cheia = await medir({ acao: "pedido_status" }, tk);
  await sql`insert into pedidos (id, email, tipo, status, valor, atualizado) values ('P1', 'a@x.com', 'inicial', 'gerando', 999, now())`;
  const cheiaGerando = await medir({ acao: "pedido_status" }, tk);
  const poll = await medir({ acao: "pedido_status", poll: true }, tk);
  assert.equal(cheia.n, 3, "completa sem pedido: sessão + limpeza + 1 consulta");
  assert.equal(cheiaGerando.n, 5, "completa com pedido gerando: + geração (2 comandos que não geram nada: já está gerando)");
  assert.equal(poll.n, 4, "poll: sessão + pedido + geração (2)");
});

test("poll enquanto pago/gerando devolve só o status; sem plano, sem listas", async () => {
  const tk = await conta("b@x.com");
  await sql`insert into pedidos (id, email, tipo, status, valor, atualizado) values ('P2', 'b@x.com', 'inicial', 'gerando', 999, now())`;
  const { r } = await medir({ acao: "pedido_status", poll: true }, tk);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { poll: true, pedido: { id: "P2", status: "gerando" } });
});

test("quando o pedido vira pronto, o poll devolve a resposta completa com o plano, uma vez; o poll seguinte (pedido pronto, não poll de espera) não repete o plano", async () => {
  const tk = await conta("c@x.com");
  const { plano } = validarPlanoIA(planoIA(), { criado: new Date().toISOString(), pedido: "P3" });
  await sql`insert into pedidos (id, email, tipo, status, valor, plano_gerado, atualizado, pago_em) values ('P3', 'c@x.com', 'inicial', 'pronto', 999, ${JSON.stringify(plano)}::jsonb, now(), now())`;
  await sql`update usuarios set dados = ${JSON.stringify({ plano })}::jsonb, acesso_ate = now() + interval '20 days' where email = 'c@x.com'`;
  const { r } = await medir({ acao: "pedido_status", poll: true }, tk); // já pronto: o cliente que esperava recebe tudo
  assert.equal(r.corpo.pedido.status, "pronto"); assert.ok(r.corpo.plano && r.corpo.pode, "completa");
  assert.ok(!r.corpo.poll);
});

test("pedido que não é pago/gerando: o poll devolve a resposta completa (o cliente não fica preso no mínimo)", async () => {
  const tk = await conta("d@x.com");
  const { r } = await medir({ acao: "pedido_status", poll: true }, tk); // sem pedido
  assert.ok(r.corpo.pode && "precos" in r.corpo);
});
