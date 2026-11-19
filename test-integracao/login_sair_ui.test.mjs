// Login e Sair pela tela: erro e sucesso, destino, e o que Sair apaga (rascunho de saúde no aparelho, sessão no servidor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
process.env.ADMIN_EMAILS = "dono@x.com";
const { sql, chamar } = await abrir();
await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" });

test("login com senha errada mostra a mensagem e não entra; com a certa entra no Perfil (conta sem treino) e conta uma consulta de pedido só", async () => {
  const acoes = [];
  const n = await navegador(async (b, t) => { acoes.push(b.acao); return chamar(b, t); });
  await n.espera(() => n.$("#email"));
  n.$("#email").value = "ana@x.com"; n.$("#senha").value = "errada1"; n.$("form .btn").click();
  await n.espera(() => /Email ou senha incorretos/.test(n.$(".err").textContent));
  assert.ok(n.$("#senha"), "continua no login");
  assert.equal(n.$("form .btn").disabled, false, "o botão volta");
  n.$("#senha").value = "senha123"; n.$("form .btn").click();
  await n.espera(() => n.w.location.hash === "#/perfil" && n.$("#sair"));
  assert.equal(acoes.filter((a) => a === "pedido_status").length, 1, "o Perfil consulta o pedido uma vez, não duas");
  assert.deepEqual(n.erros.map(String), []);
});

test("Sair apaga o rascunho do formulário (dados de saúde) do aparelho, encerra a sessão no servidor e volta ao login", async () => {
  const token = (await chamar({ acao: "entrar", email: "ana@x.com", senha: "senha123" })).token;
  const n = await navegador(chamar, { token, hash: "#/perfil" });
  await n.espera(() => n.$("#sair"));
  n.w.localStorage.setItem("fw_pedido_inicial_ana@x.com", JSON.stringify({ f: { lesoes: "joelho" }, etapa: 2 }));
  n.w.localStorage.setItem("fw_pedido_novo_treino_ana@x.com", "{}");
  n.w.localStorage.setItem("outra_chave", "fica");
  n.clicar("#sair");
  await n.espera(() => n.$("#email") && n.$("[data-mode=criar]"));
  const chaves = Object.keys(n.w.localStorage);
  assert.ok(!chaves.some((k) => k.startsWith("fw_pedido_")), "rascunhos apagados: " + chaves);
  assert.equal(n.w.localStorage.getItem("outra_chave"), "fica", "o resto não é tocado");
  assert.equal((await chamar({ acao: "eu" }, n.token)).status, 401, "a sessão acabou no servidor");
  assert.deepEqual(n.erros.map(String), []);
});

test("conta de admin entra pelo login e vê a aba Admin; sair esconde o painel", async () => {
  await sql`insert into usuarios (email, nome, senha) select 'dono@x.com', 'Dono', senha from usuarios where email = 'ana@x.com'`;
  const n = await navegador(chamar);
  await n.espera(() => n.$("#email"));
  n.$("#email").value = "dono@x.com"; n.$("#senha").value = "senha123"; n.$("form .btn").click();
  await n.espera(() => n.$(".nav") && /Admin/.test(n.$(".nav").textContent));
  n.ir("#/perfil"); await n.espera(() => n.$("#sair"));
  n.clicar("#sair");
  await n.espera(() => n.$("#email"));
  assert.ok(!n.$(".nav"));
});
