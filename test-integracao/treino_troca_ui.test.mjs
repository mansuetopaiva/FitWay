// Treino em andamento e o plano trocado por baixo (IA pronta, renovação): a sessão antiga não pode apontar para um treino que não existe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
import { planoIA, comTermo } from "../test/_fixtures.js";
comTermo();
const { sql, chamar, R } = await abrir();
const { validarPlanoIA } = await import(R + "api/_ia.js");
const plano = (pedido, nTreinos) => {
  const p = planoIA(); p.treinos = ["A", "B", "C"].slice(0, nTreinos).map((n) => ({ ...p.treinos[0], nome: "Treino " + n }));
  return validarPlanoIA(p, { criado: new Date().toISOString(), pedido }).plano;
};
const gravar = (p) => sql`update usuarios set dados = ${JSON.stringify({ plano: p, proximo: "A", checkins: [], sessoes: 0, cargas: {} })}::jsonb, acesso_ate = now() + interval '20 days' where email = 'ana@x.com'`;

test("plano novo com menos treinos chega durante o treino: a sessão é descartada e abrir outro treino não quebra", async () => {
  const token = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" })).token;
  await gravar(plano("P1", 3));
  const n = await navegador(chamar, { token, hash: "#/treino/C" });
  await n.espera(() => n.$("#go"));
  n.clicar("#go"); // inicia o treino C
  await n.espera(() => /Finalizar treino/.test(n.texto()));
  await gravar(plano("P2", 2)); // a renovação/IA troca o plano: agora só existem A e B
  n.ir("#/perfil");
  await n.espera(() => n.$("#ia") && /Treino personalizado/.test(n.texto()));
  await new Promise((r) => setTimeout(r, 300));
  n.ir("#/treino/A");
  await n.espera(() => /Treino A/.test(n.texto()));
  assert.ok(n.$("#go") && /Iniciar treino/.test(n.$("#go").textContent), "sem treino em andamento");
  assert.deepEqual(n.erros.map(String), []);
  assert.equal(n.w.localStorage.getItem("mt_sessao_ana@x.com"), null, "a sessão guardada também sai");
});

test("o mesmo plano que só renova o acesso não derruba o treino em andamento", async () => {
  const p = plano("P3", 3); await gravar(p);
  const token = (await chamar({ acao: "entrar", email: "ana@x.com", senha: "senha123" })).token;
  const n = await navegador(chamar, { token, hash: "#/treino/B" });
  await n.espera(() => n.$("#go"));
  n.clicar("#go");
  await n.espera(() => /Finalizar treino/.test(n.texto()));
  await sql`update usuarios set acesso_ate = now() + interval '50 days' where email = 'ana@x.com'`;
  n.ir("#/perfil"); await n.espera(() => n.$("#ia")); await new Promise((r) => setTimeout(r, 300));
  n.ir("#/treino/B");
  await n.espera(() => /Finalizar treino/.test(n.texto()));
  assert.deepEqual(n.erros.map(String), []);
});
