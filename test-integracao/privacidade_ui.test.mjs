import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
process.env.ADMIN_EMAILS = "dono@x.com";
delete process.env.TERMO_RESPONSAVEL; delete process.env.TERMO_EMAIL;
const { chamar } = await abrir();

test("sem login: links no login e no cadastro, e a política abre", async () => {
  const n = await navegador(chamar);
  await n.espera(() => n.$("main.login form"));
  assert.ok(n.$('.login-links a[href="#/privacidade"]'));
  assert.ok(!n.$(".login-aceite"));
  n.clicar('[data-mode="criar"]');
  assert.match(n.$(".login-aceite").textContent, /Ao criar a conta, você concorda com a Política de privacidade\./);
  n.ir("#/privacidade");
  await n.espera(() => /POLÍTICA DE PRIVACIDADE — FITWAY/.test(n.texto()));
  assert.match(n.texto(), /mantido pelo responsável pelo FitWay/);
  assert.doesNotMatch(n.texto(), /\{\{/);
  assert.match(n.texto(), /Versão de 16\/11\/2026/);
  n.clicar('a[href="#/"]');
  await n.espera(() => n.$("main.login form"));
  // cadastro e depois o link do Perfil
  n.clicar('[data-mode="criar"]');
  n.$("#nome").value = "Bia"; n.$("#email").value = "bia@x.com"; n.$("#senha").value = "123456";
  n.$("form .btn").click();
  await n.espera(() => n.$('#app a[href="#/privacidade"]') && /Perfil/.test(n.texto()));
  n.ir("#/privacidade");
  await n.espera(() => /POLÍTICA DE PRIVACIDADE/.test(n.texto()) && n.$('a[href="#/perfil"]'));
  assert.deepEqual(n.erros.map(String), []);
});
