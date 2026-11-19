// Ao trocar de tela o foco vai para o título (leitor de tela e Tab seguem dali); repintar a mesma tela não rouba o foco; tudo se alcança pelo teclado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
import { planoIA, comTermo } from "../test/_fixtures.js";
comTermo();
const { sql, chamar, R } = await abrir();
const { validarPlanoIA } = await import(R + "api/_ia.js");

test("trocar de tela leva o foco ao título; repintar a mesma tela mantém o foco onde a pessoa está", async () => {
  const tk = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" })).token;
  const { plano } = validarPlanoIA(planoIA(), { criado: new Date().toISOString(), pedido: "P1" });
  await sql`update usuarios set dados = ${JSON.stringify({ plano, proximo: "A" })}::jsonb, acesso_ate = now() + interval '20 days' where email = 'ana@x.com'`;
  const n = await navegador(chamar, { token: tk, hash: "#/inicio" });
  const ativo = () => n.w.document.activeElement;
  await n.espera(() => n.$("#ck"));
  for (const [hash, titulo] of [["#/ranking", "Ranking"], ["#/perfil", "Perfil"], ["#/treinos", "Treinos"]]) {
    n.ir(hash);
    await n.espera(() => ativo().tagName === "H1" && ativo().textContent === titulo);
    assert.equal(ativo().getAttribute("tabindex"), "-1");
  }
  // Perfil: Editar abre o formulário e o foco vai para o nome (não volta ao topo nem ao título)
  n.ir("#/perfil"); await n.espera(() => n.$("#editar"));
  n.clicar("#editar"); await n.espera(() => n.$("#nome"));
  assert.equal(ativo().id, "nome");
  // Treino: abrir outro treino leva o foco ao nome do treino; abrir um exercício mantém o foco no exercício
  n.ir("#/treino/A"); await n.espera(() => n.$(".switch b"));
  assert.equal(ativo(), n.$(".switch b"));
  n.clicar('[data-open="0"]'); await n.espera(() => n.$(".gif"));
  assert.ok(ativo().matches("[data-open]"), "o foco continua no exercício aberto");
  n.ir("#/treino/B"); await n.espera(() => n.$(".switch b") && /Treino B/.test(n.$(".switch b").textContent));
  assert.equal(ativo(), n.$(".switch b"));
  assert.deepEqual(n.erros.map(String), []);
});

test("sair e entrar de novo: a tela que abre já tem o foco no título (o login leva ao primeiro campo)", async () => {
  await chamar({ acao: "criar", nome: "Bia", email: "bia@x.com", senha: "senha123" });
  const n = await navegador(chamar);
  await n.espera(() => n.$("#email"));
  assert.equal(n.w.document.activeElement.id, "email");
  n.$("#email").value = "bia@x.com"; n.$("#senha").value = "senha123"; n.$("form .btn").click();
  await n.espera(() => n.$(".topbar h1"));
  await n.espera(() => n.w.document.activeElement.tagName === "H1");
});

test("todo controle é alcançável por teclado: nenhum botão ou link com tabindex negativo, e os campos têm rótulo", async () => {
  const tk = (await chamar({ acao: "criar", nome: "Cris", email: "cris@x.com", senha: "senha123" })).token;
  const n = await navegador(chamar, { token: tk, hash: "#/perfil" });
  await n.espera(() => n.$("#editar"));
  for (const sel of ["#/perfil", "#/ranking", "#/suporte"]) {
    n.ir(sel); await n.espera(() => n.$(".topbar h1"));
    await new Promise((r) => setTimeout(r, 100));
    for (const e of n.w.document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea")) {
      assert.notEqual(e.getAttribute("tabindex"), "-1", `${e.tagName}#${e.id} fora da ordem do teclado em ${sel}`);
      if (e.matches("input, select, textarea") && !e.closest(".sr, [hidden]")) assert.ok(e.labels && e.labels.length || e.getAttribute("aria-label"), `${e.tagName}#${e.id || e.name} sem rótulo em ${sel}`);
      if (e.matches("button, a") && !e.textContent.trim()) assert.ok(e.getAttribute("aria-label"), `${e.tagName}#${e.id || e.className} só com ícone e sem aria-label em ${sel}`);
    }
  }
});
