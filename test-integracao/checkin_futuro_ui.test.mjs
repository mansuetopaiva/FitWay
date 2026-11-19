// Aparelho com o relógio adiantado: o servidor descarta o check-in futuro e o app mostra o que o servidor guardou, não o que ficou só no aparelho.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
import { planoIA, comTermo } from "../test/_fixtures.js";
comTermo();
const { sql, chamar, R } = await abrir();
const { validarPlanoIA } = await import(R + "api/_ia.js");

test("check-in com data futura: o servidor descarta; o app tira da tela, do aparelho e avisa", async () => {
  const tk = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" })).token;
  const { plano } = validarPlanoIA(planoIA(), { criado: new Date().toISOString(), pedido: "P1" });
  await sql`update usuarios set dados = ${JSON.stringify({ plano, proximo: "A" })}::jsonb, acesso_ate = now() + interval '20 days' where email = 'ana@x.com'`;
  const n = await navegador(chamar, { token: tk, hash: "#/inicio" });
  await n.espera(() => n.$("#ck"));
  const Real = n.w.Date, dia2 = 2 * 864e5;
  n.w.Date = class extends Real { constructor(...a) { a.length ? super(...a) : super(Real.now() + dia2); } static now() { return Real.now() + dia2; } }; // relógio 2 dias adiantado
  n.clicar("#ck");
  assert.match(n.$("#ck").textContent, /feito/, "no instante do clique, o aparelho mostra feito");
  await n.espera(() => /não foi registrada/i.test(n.$("#toast").textContent));
  await n.espera(() => /Fazer check-in de hoje/.test(n.$("#ck").textContent));
  assert.deepEqual((await sql`select dados->'checkins' as c from usuarios where email = 'ana@x.com'`)[0].c ?? [], []);
  assert.equal(n.w.localStorage.getItem("mt_data_ana@x.com"), null, "nada pendente só no aparelho");
});
