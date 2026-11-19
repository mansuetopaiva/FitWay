// As telas pedem as fotos do próprio app: miniatura (t.webp) nas listas e o quadro no treino aberto, nunca o JPEG inteiro de outro site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
import { planoIA, comTermo } from "../test/_fixtures.js";
comTermo();
const { sql, chamar, R } = await abrir();
const { validarPlanoIA } = await import(R + "api/_ia.js");

test("lista de treinos usa a miniatura; treino aberto usa o quadro 0 e a miniatura dos exercícios", async () => {
  const tk = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" })).token;
  const { plano } = validarPlanoIA(planoIA(), { criado: new Date().toISOString(), pedido: "P1" });
  await sql`update usuarios set dados = ${JSON.stringify({ plano, proximo: "A" })}::jsonb, acesso_ate = now() + interval '20 days' where email = 'ana@x.com'`;
  const n = await navegador(chamar, { token: tk, hash: "#/treinos" });
  await n.espera(() => n.$(".thumb"));
  for (const i of n.w.document.querySelectorAll(".thumb")) assert.match(i.getAttribute("src"), /^img\/ex\/[\w-]+\/t\.webp$/);
  n.ir("#/treino/A");
  await n.espera(() => n.$("[data-open]"));
  n.clicar('[data-open="0"]'); // abre o 1º exercício: aparece o quadro grande
  await n.espera(() => n.$(".gif"));
  assert.match(n.$(".gif").getAttribute("src"), /^img\/ex\/Leg_Press\/0\.webp$/);
  for (const i of n.w.document.querySelectorAll(".thumb")) assert.match(i.getAttribute("src"), /^img\/ex\/[\w-]+\/t\.webp$/);
});
