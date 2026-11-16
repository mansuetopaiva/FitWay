import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
process.env.ADMIN_EMAILS = "dono@x.com"; process.env.TERMO_EMAIL = "contato@exemplo.com";
delete process.env.SMTP_USER; delete process.env.SMTP_SENHA_APP;
const { sql, chamar, R } = await abrir();
const { pedirLink } = await import(R + "api/_senha.js");
const enviados = [];
async function pedir(email) {
  Object.assign(process.env, { SMTP_USER: "f@exemplo.com", SMTP_SENHA_APP: "x", SITE_URL: "https://f.exemplo.com" });
  try { await pedirLink(sql, { email, ip: "1.1.1.1" }, { transporte: { sendMail: async (m) => { enviados.push(m); } }, esperar: async () => {} }); }
  finally { delete process.env.SMTP_USER; delete process.env.SMTP_SENHA_APP; }
  return /nova-senha\/([A-Za-z0-9_-]{43})/.exec(enviados.at(-1).text)[1];
}

test("sem SMTP o Esqueci a senha mostra o aviso com o contato", async () => {
  const n = await navegador(chamar);
  await n.espera(() => n.$("#esqueci"));
  n.clicar("#esqueci");
  await n.espera(() => /indisponível. Escreva para contato@exemplo\.com\./.test(n.texto()));
  n.clicar("#voltarLogin");
  await n.espera(() => n.$("main.login form #senha"));
  assert.deepEqual(n.erros.map(String), []);
});

test("link: o token sai do endereço antes de tudo; senhas diferentes e fracas recusadas; troca entra na conta; link usado não vale", async () => {
  const velho = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "velha12" })).token;
  const tok = await pedir("ana@x.com");
  const vistos = [];
  const espiar = async (b, t) => { vistos.push(JSON.stringify(b)); return chamar(b, t); };
  const n = await navegador(espiar, { hash: "#/nova-senha/" + tok });
  assert.equal(n.w.location.hash, "#/nova-senha", "o endereço já está limpo");
  await n.espera(() => n.$("#novaForm"));
  assert.ok(!vistos.slice(0, 1).some((v) => v.includes(tok)), "a primeira requisição (eu) não leva o token");
  n.$("#nova1").value = "abc"; n.$("#nova2").value = "abc"; n.$("#novaForm .btn").click();
  assert.match(n.$("#novaForm .err").textContent, /6 caracteres/);
  n.$("#nova1").value = "nova123"; n.$("#nova2").value = "nova124"; n.$("#novaForm .btn").click();
  assert.match(n.$("#novaForm .err").textContent, /não são iguais/);
  n.$("#nova2").value = "nova123"; n.$("#novaForm .btn").click();
  await n.espera(() => /Perfil/.test(n.texto()) && n.$("#sair"));
  assert.equal((await chamar({ acao: "eu" }, velho)).status, 401);
  // o mesmo link de novo
  const n2 = await navegador(chamar, { hash: "#/nova-senha/" + tok });
  await n2.espera(() => /Este link não vale mais/.test(n2.texto()) && n2.$("#pedirNovo"));
  assert.ok(!n2.$("#novaForm"), "link usado nem mostra o formulário");
  assert.deepEqual([...n.erros, ...n2.erros].map(String), []);
});

test("Perfil: trocar senha com a atual", async () => {
  const t = (await chamar({ acao: "criar", nome: "Bia", email: "bia@x.com", senha: "velha12" })).token;
  const n = await navegador(chamar, { hash: "#/perfil", token: t });
  await n.espera(() => n.$("#trocarSenha"));
  n.clicar("#trocarSenha");
  await n.espera(() => n.$("#senhaForm"));
  n.$("#senhaAtual").value = "errada"; n.$("#senhaNova1").value = "nova123"; n.$("#senhaNova2").value = "nova123";
  n.$("#senhaForm .btn").click();
  await n.espera(() => /incorreta/.test(n.$("#senhaForm .err").textContent));
  n.$("#senhaAtual").value = "velha12"; n.$("#senhaForm .btn").click();
  await n.espera(() => !n.$("#senhaForm") && /Senha trocada/.test(n.$("#toast").textContent));
  assert.equal((await chamar({ acao: "entrar", email: "bia@x.com", senha: "nova123" })).status, 200);
  assert.deepEqual(n.erros.map(String), []);
});

test("link de outra conta com alguém conectado: avisa e só segue depois de sair", async () => {
  await chamar({ acao: "criar", nome: "Ata", email: "ata@x.com", senha: "velha12" });
  const tok = await pedir("ata@x.com");
  const vit = (await chamar({ acao: "criar", nome: "Vit", email: "vit@x.com", senha: "velha12" })).token;
  const n = await navegador(chamar, { hash: "#/nova-senha/" + tok, token: vit });
  await n.espera(() => n.$("#sairParaLink"));
  assert.match(n.texto(), /Este link é da conta ata@x\.com, mas você está conectado como vit@x\.com/);
  n.clicar("#sairParaLink");
  await n.espera(() => n.$("#novaForm"));
  assert.match(n.texto(), /Conta: ata@x\.com/);
  assert.equal(n.$('#novaForm input[autocomplete="username"]').value, "ata@x.com");
});
