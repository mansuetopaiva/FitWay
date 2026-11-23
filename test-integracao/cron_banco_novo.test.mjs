// A tarefa diária cria o schema se for a primeira a falar com o banco (antes: "relation does not exist" até alguém abrir o app).
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
process.env.CRON_SECRET = "segredo-do-cron-com-bastante-tamanho-1234567890";
const { sql, R } = await abrir({ semSchema: true }); // banco vazio: o app nunca rodou
const cron = (await import(R + "api/cron.js?" + Math.random())).default;

test("cron num banco novo cria as tabelas e roda a limpeza com resumo zerado", async () => {
  assert.equal((await sql`select to_regclass('login_tentativas') as t`)[0].t, null, "começa sem tabelas");
  let st = 200, corpo;
  await cron({ method: "GET", headers: { authorization: "Bearer " + process.env.CRON_SECRET } }, { status(x) { st = x; return this; }, json(x) { corpo = x; return this; } });
  assert.equal(st, 200, JSON.stringify(corpo));
  assert.equal(corpo.pedidos_cancelados, 0);
  assert.ok((await sql`select to_regclass('login_tentativas') as t`)[0].t);
  assert.equal((await sql`select count(*)::int as n from admin_log where acao = 'limpeza_diaria'`)[0].n, 1);
});
