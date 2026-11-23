// Telas do 2º fator do admin no app inteiro (jsdom + servidor real sobre PGlite): ativação guiada no 1º login, segundo passo do login,
// código de recuperação, expiração do desafio e geração de novos códigos no Perfil.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
import { senhaHash } from "../api/_senha.js";
import { codigo, passoDe, desbase32, decifrar } from "../api/_totp.js";
process.env.ADMIN_EMAILS = "dono@x.com";
const { sql, chamar } = await abrir();
await sql`insert into usuarios (email, nome, senha) values ('dono@x.com', 'Dono', ${senhaHash("senha123")})`;
const segDoBanco = async () => decifrar((await sql`select segredo_cifrado from admin_2fa`)[0].segredo_cifrado).segredo;
const atual = (seg, d = 0) => codigo(seg, passoDe(Date.now()) + d);
const digitar = (n, campo, v) => { campo.value = v; campo.dispatchEvent(new n.w.Event("input", { bubbles: true })); };
async function senhaCerta(n) {
  await n.espera(() => n.$("#email"));
  n.$("#email").value = "dono@x.com"; n.$("#senha").value = "senha123"; n.$("form .btn").click();
}
// O campo aponta (aria-describedby) para a mensagem com role="alert", está inválido e focado.
function ligado(n, campo, texto) {
  assert.equal(campo.getAttribute("aria-invalid"), "true");
  const msg = (campo.getAttribute("aria-describedby") || "").split(" ").map((i) => n.w.document.getElementById(i)).find((e) => e && e.classList.contains("err"));
  assert.ok(msg, "aria-describedby aponta para a mensagem de erro"); assert.equal(msg.getAttribute("role"), "alert"); assert.match(msg.textContent, texto);
  assert.equal(n.w.document.activeElement, campo, "foco no campo");
}
let guardados;

test("1º login do admin: a senha leva à tela de ativação (chave em grupos, link otpauth, sem sessão); código errado fica no campo; o certo mostra os 10 códigos uma vez", async () => {
  const n = await navegador(chamar);
  await senhaCerta(n);
  await n.espera(() => n.$("#dfCodigo"));
  assert.equal(n.w.document.activeElement.id, "dfTit", "foco no título da etapa"); assert.ok(!n.$(".nav"), "ainda sem o app");
  assert.match(n.$("#dfChave").textContent, /^([A-Z2-7]{4} ){3}[A-Z2-7]{4}/);
  assert.match(n.$(".df-link").getAttribute("href"), /^otpauth:\/\/totp\/FitWay/);
  assert.ok(n.$("#dfCodigo").getAttribute("aria-describedby").split(" ").includes("dfDica"), "a dica do relógio está ligada ao campo");
  assert.equal(n.$("#dfCodigo").getAttribute("autocomplete"), "one-time-code");
  assert.equal((await chamar({ acao: "eu" }, n.token)).status, 401, "nenhuma sessão até o código");
  n.$("#dfForm .btn").click(); ligado(n, n.$("#dfCodigo"), /Digite o código/);
  digitar(n, n.$("#dfCodigo"), "000000"); n.$("#dfForm .btn").click();
  await n.espera(() => /Código incorreto/.test(n.$("#dfForm .err").textContent));
  ligado(n, n.$("#dfCodigo"), /Código incorreto/); assert.equal(n.$("#dfForm .btn").disabled, false);
  const seg = desbase32(n.$("#dfChave").textContent);
  digitar(n, n.$("#dfCodigo"), atual(seg)); n.$("#dfForm .btn").click();
  await n.espera(() => n.$("#dfCodigos"));
  assert.equal(n.w.document.activeElement.id, "dfCodTit");
  guardados = [...n.w.document.querySelectorAll("#dfCodigos li")].map((l) => l.textContent.replace(/\s/g, ""));
  assert.equal(guardados.length, 10); for (const c of guardados) assert.match(c, /^[A-Z2-7]{10}$/);
  assert.match(n.texto(), /não aparecem de novo/i);
  n.clicar("#dfOk");
  await n.espera(() => n.$(".nav") && /Admin/.test(n.$(".nav").textContent));
  assert.ok(!n.w.document.body.textContent.includes(guardados[0]), "os códigos saem da tela");
  assert.deepEqual(n.erros.map(String), []);
});

test("2º login: só o campo do código (sem a chave); código errado ligado ao campo; o certo entra no app", async () => {
  await sql`update admin_2fa set ultimo_passo = 0`;
  const n = await navegador(chamar);
  await senhaCerta(n);
  await n.espera(() => n.$("#dfCodigo"));
  assert.ok(!n.$("#dfChave") && !n.$(".df-link"), "sem chave na 2ª vez");
  assert.equal((await chamar({ acao: "eu" }, n.token)).status, 401);
  digitar(n, n.$("#dfCodigo"), "123 456"); n.$("#dfForm .btn").click();
  await n.espera(() => /Código incorreto/.test(n.$("#dfForm .err").textContent));
  ligado(n, n.$("#dfCodigo"), /Código incorreto/);
  digitar(n, n.$("#dfCodigo"), atual(await segDoBanco())); n.$("#dfForm .btn").click();
  await n.espera(() => n.$(".nav") && /Admin/.test(n.$(".nav").textContent));
  assert.ok(!n.$("#dfCodigos"), "códigos só na ativação"); assert.equal(n.w.location.hash, "#/perfil");
  assert.deepEqual(n.erros.map(String), []);
});

test("código de recuperação entra uma vez; desafio vencido volta ao login com a mensagem; Voltar leva ao login", async () => {
  const n = await navegador(chamar);
  await senhaCerta(n); await n.espera(() => n.$("#dfCodigo"));
  digitar(n, n.$("#dfCodigo"), guardados[0].toLowerCase()); n.$("#dfForm .btn").click();
  await n.espera(() => n.$(".nav") && /Admin/.test(n.$(".nav").textContent));
  await n.espera(() => /Restam 9/.test(n.$("#toast").textContent));
  const m = await navegador(chamar);
  await senhaCerta(m); await m.espera(() => m.$("#dfCodigo"));
  digitar(m, m.$("#dfCodigo"), guardados[0]); m.$("#dfForm .btn").click();
  await m.espera(() => /Código incorreto/.test(m.$("#dfForm .err").textContent));
  await sql`update login_desafios set expira = now() - interval '1 second'`;
  digitar(m, m.$("#dfCodigo"), guardados[1]); m.$("#dfForm .btn").click();
  await m.espera(() => m.$("#email") && /expirou/.test(m.$(".err").textContent));
  assert.ok(!m.$(".nav"));
  await senhaCerta(m); await m.espera(() => m.$("#dfVoltar")); m.clicar("#dfVoltar");
  await m.espera(() => m.$("#email") && m.$("[data-mode=criar]"));
  assert.deepEqual([...n.erros, ...m.erros].map(String), []);
});

test("Perfil do admin: mostra quantos códigos restam e gera novos com senha atual + código; avisa quando restam poucos", async () => {
  await sql`update admin_2fa set ultimo_passo = 0`; await sql`delete from login_tentativas`;
  const d = (await chamar({ acao: "entrar", email: "dono@x.com", senha: "senha123" }, null, { "x-real-ip": "7.7.7.7" })).corpo.desafio;
  const tk = (await chamar({ acao: "entrar_2fa", desafio: d, codigo: atual(await segDoBanco()) }, null, { "x-real-ip": "7.7.7.7" })).token;
  await sql`update admin_recuperacao set usado_em = now() where hash in (select hash from admin_recuperacao where usado_em is null limit 7)`;
  const n = await navegador(chamar, { token: tk, hash: "#/perfil" });
  await n.espera(() => n.$("#dfCard") && /Restam 2/.test(n.$("#dfCard").textContent));
  assert.match(n.$("#dfCard").textContent, /poucos códigos/i);
  assert.equal(n.$("#dfNovos").getAttribute("aria-expanded"), "false");
  n.clicar("#dfNovos");
  assert.equal(n.$("#dfNovos").getAttribute("aria-expanded"), "true"); assert.equal(n.w.document.activeElement.id, "dfSenha");
  assert.equal(n.$("#dfSenha").getAttribute("autocomplete"), "current-password");
  n.$("#dfNovosForm .btn").click(); ligado(n, n.$("#dfSenha"), /senha atual/i);
  digitar(n, n.$("#dfSenha"), "errada1"); digitar(n, n.$("#dfCodNovo"), "000000"); n.$("#dfNovosForm .btn").click();
  await n.espera(() => /Código incorreto/.test(n.$("#dfNovosForm .err").textContent));
  await sql`update admin_2fa set ultimo_passo = 0`;
  digitar(n, n.$("#dfSenha"), "senha123"); digitar(n, n.$("#dfCodNovo"), atual(await segDoBanco()));
  n.$("#dfNovosForm .btn").click();
  await n.espera(() => n.$("#dfCodigos"));
  assert.equal(n.$("#dfCodigos").querySelectorAll("li").length, 10); assert.match(n.$("#dfCard").textContent, /Restam 10/);
  assert.ok(!n.$("#dfNovosForm"), "formulário fechado"); assert.equal(n.w.document.activeElement.id, "dfCodTit");
  assert.deepEqual(n.erros.map(String), []);
});
