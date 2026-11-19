// Ranking (criar, entrar, ordem, semana/mês, sair, erros) e treino (iniciar, concluir série, desfazer, carga, finalizar) pela tela.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
import { planoIA, comTermo } from "../test/_fixtures.js";
comTermo();
const { sql, chamar, R } = await abrir();
const { validarPlanoIA } = await import(R + "api/_ia.js");
const { hojeBR } = await import(R + "api/_dados.js");
const soma = (dia, n) => new Date(Date.parse(dia + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const conta = async (nome, email, dados = {}) => {
  const token = (await chamar({ acao: "criar", nome, email, senha: "senha123" })).token;
  if (Object.keys(dados).length) await sql`update usuarios set dados = ${JSON.stringify(dados)}::jsonb where email = ${email}`;
  return token;
};

test("ranking: criar grupo, entrar com o código, ordem por check-ins, semana/mês, sem emails, sair", async () => {
  const hoje = hojeBR();
  const ana = await conta("Ana", "ana@x.com", { checkins: [soma(hoje, -40), hoje] });
  const bia = await conta("Bia", "bia@x.com", { checkins: [] });
  const a = await navegador(chamar, { token: ana, hash: "#/ranking" });
  await a.espera(() => a.$("#criar"));
  a.clicar("#criar");
  await a.espera(() => a.$("#cod"));
  const codigo = a.$("#cod").textContent;
  assert.match(codigo, /^[A-Z2-9]{6}$/);
  assert.match(a.texto(), /1º 🏆 Ana \(você\)/);
  // Bia: código curto (erro local), inexistente (servidor), e o certo
  const b = await navegador(chamar, { token: bia, hash: "#/ranking" });
  await b.espera(() => b.$("#codigo"));
  b.$("#codigo").value = "AB"; b.$("form .btn").click();
  assert.match(b.$(".err").textContent, /6 letras ou números/);
  b.$("#codigo").value = "ZZZZZZ"; b.$("form .btn").click();
  await b.espera(() => /Não encontrei um grupo/.test(b.texto()));
  b.$("#codigo").value = codigo.toLowerCase(); b.$("form .btn").click(); // minúsculas valem
  await b.espera(() => b.$("#cod"));
  const linhas = [...b.w.document.querySelectorAll(".card .row")].map((r) => r.textContent);
  assert.match(linhas[0], /1º 🏆 Ana1/); assert.match(linhas[1], /2º Bia \(você\)0/);
  assert.ok(!/@x\.com/.test(b.texto()), "nunca o email dos outros");
  // Mês: o check-in de 40 dias atrás não conta nem na semana nem no mês; hoje conta nos dois
  b.clicar('[data-r="mes"]');
  assert.match([...b.w.document.querySelectorAll(".card .row")][0].textContent, /Ana1/);
  assert.equal(b.$('[data-r="mes"]').getAttribute("aria-pressed"), "true");
  // Bia sai do grupo e volta à tela de criar
  b.clicar("#sairGrupo");
  await b.espera(() => b.$("#criar"));
  assert.equal((await sql`select grupo from usuarios where email = 'bia@x.com'`)[0].grupo, null);
  assert.ok((await sql`select grupo from usuarios where email = 'ana@x.com'`)[0].grupo);
  assert.deepEqual([...a.erros, ...b.erros].map(String), []);
});

test("treino: iniciar, concluir séries (descanso e avanço), desfazer, salvar carga, finalizar (próximo treino e sessões no servidor)", async () => {
  const { plano } = validarPlanoIA(planoIA(), { criado: new Date().toISOString(), pedido: "P1" });
  const tk = await conta("Cris", "cris@x.com", { plano, proximo: "A", checkins: [], sessoes: 0, cargas: {} });
  await sql`update usuarios set acesso_ate = now() + interval '20 days' where email = 'cris@x.com'`;
  const n = await navegador(chamar, { token: tk, hash: "#/treino/A" });
  await n.espera(() => n.$("#go"));
  assert.match(n.$("#go").textContent, /Iniciar treino/);
  n.clicar('[data-open="0"]'); await n.espera(() => n.$("[data-serie]"));
  n.clicar("[data-serie]"); // série 1 do 1º exercício: inicia o treino e o descanso
  await n.espera(() => /Finalizar treino/.test(n.texto()) && n.$(".rest"));
  assert.ok(n.$("[data-desfaz]"), "dá para desfazer a última série");
  n.clicar("[data-desfaz]"); await n.espera(() => n.$("[data-serie]") && !n.$("[data-desfaz]"));
  for (let i = 0; i < 3; i++) { n.clicar("[data-serie]"); await n.espera(() => n.$(".rest") || n.$(".ex.complete")); }
  await n.espera(() => n.$(".ex.complete"), 3000);
  assert.ok(n.$('[data-open="1"]').getAttribute("aria-expanded") === "true", "abre o próximo exercício sozinho");
  // carga do exercício aberto
  n.clicar("[data-edit]"); await n.espera(() => n.$("#kg"));
  n.$("#kg").value = "20"; n.clicar('[data-kg="ok"]');
  await n.espera(() => /Carga salva: 20kg/.test(n.$("#toast").textContent));
  await pausa(150);
  assert.equal(Object.values((await sql`select dados->'cargas' as c from usuarios where email = 'cris@x.com'`)[0].c)[0], 20);
  // finalizar com exercícios sem concluir (confirm = sim): vai para a lista, próximo treino B, 1 sessão
  await pausa(1600); // o botão ignora toque duplo nos primeiros 1,5 s
  n.clicar("#go");
  await n.espera(() => n.w.location.hash === "#/treinos");
  await pausa(150);
  const [u] = await sql`select dados from usuarios where email = 'cris@x.com'`;
  assert.equal(u.dados.sessoes, 1); assert.equal(u.dados.proximo, "B");
  assert.equal(n.w.localStorage.getItem("mt_sessao_cris@x.com"), null, "a sessão em andamento acabou");
  assert.match(n.$(".wk.next").textContent, /Treino B/);
  assert.deepEqual(n.erros.map(String), []);
});
