// Cadastro recusado: email de admin sem conta e email que já tem conta recebem a mesma resposta (status e texto).
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
process.env.ADMIN_EMAILS = "dono@x.com";
const { sql, chamar } = await abrir();

test("admin sem conta e email já cadastrado: mesma resposta; nada é criado para o admin; o texto manda para Entrar", async () => {
  await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" });
  const existente = await chamar({ acao: "criar", nome: "Outra", email: "ana@x.com", senha: "outra123" });
  const admin = await chamar({ acao: "criar", nome: "Dono", email: "dono@x.com", senha: "senha123" });
  assert.deepEqual({ status: admin.status, corpo: admin.corpo }, { status: existente.status, corpo: existente.corpo });
  assert.equal(admin.status, 400); assert.equal(admin.token, undefined);
  assert.match(admin.corpo.erro, /use a aba Entrar/i);
  assert.equal((await sql`select count(*)::int as n from usuarios where email = 'dono@x.com'`)[0].n, 0, "ninguém vira admin por cadastro");
  assert.equal((await chamar({ acao: "entrar", email: "ana@x.com", senha: "senha123" })).status, 200, "a conta existente continua com a senha original");
});
