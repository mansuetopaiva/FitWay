// Partida a frio: com o schema da versão atual já aplicado, o backend não recria as tabelas (1 comando em vez de dezenas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
const { sql, chamar, comandos, partidaAFrio } = await abrir();

test("a primeira partida cria o schema (muitos comandos); a segunda, com o schema já aplicado, usa no máximo 2", async () => {
  assert.ok(comandos() > 20, "a primeira partida aplicou o schema: " + comandos());
  const antes = comandos();
  const outra = await partidaAFrio();
  const r = await outra({ acao: "eu" }); // sem cookie: só o schema() roda
  assert.equal(r.status, 401);
  assert.ok(comandos() - antes <= 2, "comandos na partida a frio: " + (comandos() - antes));
  // O banco continua inteiro: a conta criada por uma instância vale na outra.
  await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" });
  assert.equal((await outra({ acao: "entrar", email: "ana@x.com", senha: "senha123" })).status, 200);
});

test("versão diferente da gravada (schema mudou no deploy): a partida aplica o schema de novo", async () => {
  await sql`update schema_versao set versao = 'antiga'`;
  const antes = comandos();
  const outra = await partidaAFrio();
  await outra({ acao: "eu" });
  assert.ok(comandos() - antes > 20, "reaplicou: " + (comandos() - antes));
  assert.notEqual((await sql`select versao from schema_versao`)[0].versao, "antiga");
  const dep = comandos();
  await (await partidaAFrio())({ acao: "eu" });
  assert.ok(comandos() - dep <= 2, "e a seguinte volta a pular");
});
