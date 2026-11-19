// 409 é só "outra conta entrou neste navegador". Email repetido e grupo cheio são recusas comuns (400): o app não recarrega,
// o formulário mantém o que a pessoa digitou e a mensagem fica no lugar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
process.env.ADMIN_EMAILS = "dono@x.com";
const { sql, chamar } = await abrir();
const parar = (ms) => new Promise((r) => setTimeout(r, ms));

test("cadastro com email que já tem conta: mensagem no lugar, campos mantidos, sem recarregar", async () => {
  await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" });
  const n = await navegador(chamar);
  await n.espera(() => n.$("[data-mode=criar]"));
  n.clicar("[data-mode=criar]");
  n.$("#nome").value = "Outra Ana"; n.$("#email").value = "ana@x.com"; n.$("#senha").value = "outra123";
  n.$("form .btn").click();
  await n.espera(() => /Já existe uma conta/.test(n.$(".err").textContent));
  await parar(1600); // o recarregamento antigo vinha 1,2 s depois
  assert.match(n.$(".err").textContent, /Já existe uma conta/);
  assert.equal(n.$("#nome").value, "Outra Ana"); assert.equal(n.$("#email").value, "ana@x.com"); assert.equal(n.$("#senha").value, "outra123");
  assert.deepEqual(n.erros.map(String), [], "nenhuma navegação (reload) foi tentada");
});

test("servidor: email repetido e grupo cheio respondem 400; só a troca de conta responde 409, com trocaConta", async () => {
  assert.equal((await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" })).status, 400);
  const dono = (await chamar({ acao: "criar", nome: "Bia", email: "bia@x.com", senha: "senha123" })).token;
  const hoje = new Date(), d = (x) => x.toISOString().slice(0, 10);
  const rank = (b) => chamar({ acao: "ranking", semana: d(hoje), mes: d(hoje), ...b }, dono);
  const { corpo } = await rank({ op: "criar" });
  for (let i = 0; i < 49; i++) await sql`insert into usuarios (email, nome, senha, grupo) values (${"m" + i + "@x.com"}, 'M', 'x', ${corpo.codigo})`;
  const outro = (await chamar({ acao: "criar", nome: "Caio", email: "caio@x.com", senha: "senha123" })).token;
  const cheio = await chamar({ acao: "ranking", op: "entrar", codigo: corpo.codigo, semana: d(hoje), mes: d(hoje) }, outro);
  assert.equal(cheio.status, 400); assert.match(cheio.corpo.erro, /cheio/);
  const troca = await chamar({ acao: "eu", conta: "outra@x.com" }, dono);
  assert.equal(troca.status, 409); assert.equal(troca.corpo.trocaConta, true);
});
