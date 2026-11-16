// Lacunas das telas de senha (jsdom + servidor real no PGlite). Email "ligado" sem SMTP: api/_email.js trocado por um
// módulo com transporte falso; SMTP_USER/SMTP_SENHA_APP ficam fora do env.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
delete process.env.SMTP_USER; delete process.env.SMTP_SENHA_APP;
process.env.SITE_URL = "https://f.exemplo.com"; process.env.ADMIN_EMAILS = "dono@x.com";
const R0 = fileURLToPath(new URL("../", import.meta.url)); // raiz do repositório
const real = await import(R0 + "api/_email.js?real");
const enviados = [];
const transporte = { sendMail: async (m) => { enviados.push(m); return {}; } };
mock.module(pathToFileURL(R0 + "api/_email.js").href, { exports: { ...real, emailDisponivel: () => true, transporteGmail: () => transporte } });
const { sql, chamar, R } = await abrir();
const { pedirLink, MSG_PEDIDO } = await import(R + "api/_senha.js");
const tokenDe = (m) => /nova-senha\/([A-Za-z0-9_-]{43})/.exec(m.text)[1];
async function pedir(email) { await pedirLink(sql, { email, ip: "1.1.1.1" }, { transporte, esperar: async () => {} }); return tokenDe(enviados.at(-1)); }

test("Esqueci a senha: com e sem conta a tela mostra a mesma mensagem; o link do email funciona", async () => {
  await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "velha12" });
  const telas = [];
  for (const email of ["ana@x.com", "ninguem@x.com"]) {
    const n = await navegador(chamar);
    await n.espera(() => n.$("#esqueci"));
    n.$("#email").value = email; n.clicar("#esqueci");
    await n.espera(() => n.$("#esqForm"));
    assert.equal(n.$("#email").value, email, "leva o email digitado no login");
    n.$("#esqForm .btn").click();
    await n.espera(() => n.$("#esqOk"), 8000);
    telas.push(n.$("#esqOk").textContent);
    assert.deepEqual(n.erros.map(String), []);
  }
  assert.deepEqual(telas, [MSG_PEDIDO, MSG_PEDIDO]);
  const tok = tokenDe(enviados.at(-1));
  assert.deepEqual(enviados.at(-1).to, { address: "ana@x.com" });
  const n = await navegador(chamar, { hash: "#/nova-senha/" + tok });
  await n.espera(() => n.$("#novaForm"));
  assert.match(n.texto(), /Conta: ana@x\.com/);
});

test("link colado numa aba já aberta: o token sai do endereço e o formulário abre", async () => {
  await chamar({ acao: "criar", nome: "Col", email: "col@x.com", senha: "velha12" });
  const tok = await pedir("col@x.com");
  const n = await navegador(chamar);
  await n.espera(() => n.$("#esqueci"));
  n.ir("#/nova-senha/" + tok);
  await n.espera(() => n.$("#novaForm"));
  assert.equal(n.w.location.hash, "#/nova-senha");
  assert.ok(!n.w.location.href.includes(tok));
});

test("Mostrar senhas troca o tipo dos campos de senha", async () => {
  await chamar({ acao: "criar", nome: "Ver", email: "ver@x.com", senha: "velha12" });
  const n = await navegador(chamar, { hash: "#/nova-senha/" + (await pedir("ver@x.com")) });
  await n.espera(() => n.$("#novaVer"));
  const tipos = () => ["#nova1", "#nova2"].map((s) => n.$(s).type);
  assert.deepEqual(tipos(), ["password", "password"]);
  n.$("#novaVer").checked = true; n.$("#novaVer").dispatchEvent(new n.w.Event("change"));
  assert.deepEqual(tipos(), ["text", "text"]);
});

test("senha trocada mas sem sessão nova: avisa e volta para o login", async () => {
  await chamar({ acao: "criar", nome: "Sem", email: "sem@x.com", senha: "velha12" });
  const tok = await pedir("sem@x.com");
  const falha = async (b, t) => b.acao === "senha_nova" ? { status: 200, corpo: { semSessao: true, mensagem: "Senha trocada. Entre com a senha nova." } } : chamar(b, t);
  const n = await navegador(falha, { hash: "#/nova-senha/" + tok });
  await n.espera(() => n.$("#novaForm"));
  n.$("#nova1").value = "nova123"; n.$("#nova2").value = "nova123"; n.$("#novaForm .btn").click();
  await n.espera(() => n.$("main.login form #senha") && /Entre com a senha nova/.test(n.$("#toast").textContent));
  assert.deepEqual(n.erros.map(String), []);
});
