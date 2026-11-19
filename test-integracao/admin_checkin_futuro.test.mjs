// Admin: o total e o último check-in ignoram datas depois de hoje (em Brasília), na lista e no detalhe do usuário.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
process.env.ADMIN_EMAILS = "dono@x.com";
const { sql, R } = await abrir();
const { acaoAdmin } = await import(R + "api/_admin.js");
const { hojeBR } = await import(R + "api/_dados.js");
const soma = (dia, n) => new Date(Date.parse(dia + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

test("total e último check-in ignoram datas futuras já gravadas (lista e detalhe)", async () => {
  const hoje = hojeBR(), ontem = soma(hoje, -1);
  await sql`insert into usuarios (email, nome, senha, dados) values ('a@x.com', 'Ana', 'x', ${JSON.stringify({ checkins: [ontem, hoje, soma(hoje, 1), "2099-01-01"] })}::jsonb)`;
  const dono = { email: "dono@x.com" };
  const lista = (await acaoAdmin(sql, dono, { op: "usuarios", busca: "a@x.com" })).corpo.itens[0];
  assert.equal(lista.checkins, 2); assert.equal(lista.ultimoCheckin, hoje);
  const d = (await acaoAdmin(sql, dono, { op: "usuario", email: "a@x.com" })).corpo;
  assert.equal(d.checkins, 2); assert.equal(d.ultimoCheckin, hoje);
});
