// Erros de formulário ligados ao campo: aria-invalid + aria-describedby para a mensagem (role="alert"), foco no campo, e a marca some ao digitar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
process.env.TREINO_IA_ATIVO = "1";
Object.assign(process.env, { TERMO_RESPONSAVEL: "Fulano", TERMO_DOCUMENTO: "CPF 000", TERMO_EMAIL: "c@exemplo.com", TERMO_FORO: "Cidade" });
Object.assign(process.env, { SMTP_USER: "f@exemplo.com", SMTP_SENHA_APP: "x", SITE_URL: "https://f.exemplo.com" }); // só para o formulário do Esqueci a senha existir; nenhum email é enviado
const { chamar } = await abrir();

// O campo aponta (aria-describedby) para uma mensagem com role="alert" e o texto esperado; está inválido e focado.
function ligado(n, campo, texto) {
  assert.equal(campo.getAttribute("aria-invalid"), "true", "aria-invalid em " + (campo.id || campo.name));
  const ids = (campo.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
  const msg = ids.map((i) => n.w.document.getElementById(i)).find((e) => e && e.classList.contains("err"));
  assert.ok(msg, "aria-describedby aponta para a mensagem de erro: " + ids);
  assert.equal(msg.getAttribute("role"), "alert");
  assert.match(msg.textContent, texto);
  assert.equal(n.w.document.activeElement, campo, "foco no campo com erro");
}

test("login e cadastro: nome, email e senha", async () => {
  const n = await navegador(chamar);
  await n.espera(() => n.$("#email"));
  const enviar = () => n.$("form .btn").click();
  n.$("#email").value = "sem-arroba"; n.$("#senha").value = "abc"; enviar();
  ligado(n, n.$("#email"), /email válido/);
  n.$("#email").value = "a@b.com"; n.$("#email").dispatchEvent(new n.w.Event("input", { bubbles: true }));
  assert.equal(n.$("#email").getAttribute("aria-invalid"), null, "digitar tira a marca");
  enviar();
  ligado(n, n.$("#senha"), /pelo menos 6/);
  assert.equal(n.$("#email").getAttribute("aria-invalid"), null, "só o campo com erro fica marcado");
  // corrigido e enviado de novo: a ligação com a mensagem antiga é desfeita (nada de aria-describedby apontando para um <p> vazio)
  const idErro = n.$(".err").id;
  assert.ok(idErro && n.$("#senha").getAttribute("aria-describedby").includes(idErro));
  n.$("#senha").value = "senha123"; enviar();
  await n.espera(() => /Email ou senha incorretos/.test(n.$(".err").textContent));
  assert.equal(n.$("#senha").getAttribute("aria-invalid"), null);
  assert.ok(!(n.$("#senha").getAttribute("aria-describedby") || "").includes(idErro), "o campo não aponta mais para a mensagem de outro erro");
  n.clicar("[data-mode=criar]");
  n.$("#senha").value = "senha123"; n.$("#email").value = "novo@x.com"; enviar();
  ligado(n, n.$("#nome"), /Digite seu nome/);
});

test("Esqueci a senha, trocar senha no Perfil e ranking", async () => {
  const n = await navegador(chamar);
  await n.espera(() => n.$("#esqueci"));
  n.clicar("#esqueci");
  await n.espera(() => n.$("#esqForm"));
  n.$("#email").value = "xx"; n.$("#esqForm .btn").click(); ligado(n, n.$("#email"), /email válido/);
  const tk = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" })).token;
  const m = await navegador(chamar, { token: tk, hash: "#/perfil" });
  await m.espera(() => m.$("#trocarSenha"));
  m.clicar("#trocarSenha");
  m.$("#senhaAtual").value = "senha123"; m.$("#senhaNova1").value = "nova123"; m.$("#senhaNova2").value = "diferente";
  m.$("#senhaAtual").form.querySelector(".btn").click();
  ligado(m, m.$("#senhaNova2"), /não são iguais/);
  const r = await navegador(chamar, { token: tk, hash: "#/ranking" });
  await r.espera(() => r.$("#entrar") || r.$("#codigo"));
  if (!r.$("#codigo")) r.clicar("#entrar");
  await r.espera(() => r.$("#codigo"));
  r.$("#codigo").value = "AB"; r.$("form .btn").click();
  ligado(r, r.$("#codigo"), /6 letras/);
});

test("formulário do pedido e suporte", async () => {
  const tk = (await chamar({ acao: "criar", nome: "Bia", email: "bia@x.com", senha: "senha123" })).token;
  const n = await navegador(chamar, { token: tk, hash: "#/pedido/inicial" });
  await n.espera(() => n.$("#pedForm"));
  n.$("#pedForm .btn").click();
  ligado(n, n.$('[name="objetivo"]'), /pelo menos um objetivo/);
  const s = await navegador(chamar, { token: tk, hash: "#/suporte/novo" });
  await s.espera(() => s.$("#supForm"));
  s.$("#supForm .btn").click();
  ligado(s, s.$("[name=assunto]"), /Escolha o assunto/);
  s.$("[name=assunto]").checked = true; s.$("#supForm .btn").click();
  ligado(s, s.$("#supTexto"), /Escreva a mensagem/);
});
