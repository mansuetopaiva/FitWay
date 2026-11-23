// O Perfil espera o treino ficar pronto: a 1ª consulta é completa, as seguintes (a cada 4 s) são polls leves; quando o treino fica pronto, uma resposta completa e o poll para.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
import { planoIA, comTermo } from "../test/_fixtures.js";
comTermo();
process.env.TREINO_IA_ATIVO = "1";
const { sql, chamar, R } = await abrir();
const { validarPlanoIA } = await import(R + "api/_ia.js");

test("poll leve enquanto gera; resposta completa (com o plano) uma vez quando fica pronto; depois o poll para", async () => {
  const tk = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" })).token;
  await sql`insert into pedidos (id, email, tipo, status, valor, atualizado, pago_em) values ('P1', 'ana@x.com', 'inicial', 'gerando', 999, now(), now())`;
  const reqs = [], resps = [];
  const n = await navegador(async (b, t) => { const r = await chamar(b, t); if (b.acao === "pedido_status") { reqs.push(b); resps.push(r.corpo); } return r; }, { token: tk, hash: "#/perfil", rapido: true });
  await n.espera(() => reqs.filter((b) => b.poll).length >= 3, 5000);
  assert.equal(reqs[0].poll, undefined, "a primeira consulta é a completa");
  assert.ok(resps[0].precos && "pode" in resps[0]);
  for (const r of resps.slice(1)) if (r.poll) assert.deepEqual(Object.keys(r).sort(), ["pedido", "poll"], "o poll devolve só o status");
  assert.match(n.texto(), /Treino personalizado/);
  // o treino fica pronto (gerado por outro lado): o próximo poll traz tudo
  const { plano } = validarPlanoIA(planoIA(), { criado: new Date().toISOString(), pedido: "P1" });
  await sql`update pedidos set status = 'pronto', plano_gerado = ${JSON.stringify(plano)}::jsonb, gerado_em = now() where id = 'P1'`;
  await sql`update usuarios set dados = ${JSON.stringify({ plano, proximo: "A" })}::jsonb, acesso_ate = now() + interval '30 days' where email = 'ana@x.com'`;
  await n.espera(() => resps.some((r) => !r.poll && r.pedido && r.pedido.status === "pronto" && r.plano), 5000);
  const depois = reqs.length;
  await new Promise((r) => setTimeout(r, 400)); // 10 ciclos de 4 s em escala
  assert.ok(reqs.length - depois <= 1, "depois de pronto o poll para: " + (reqs.length - depois));
  assert.deepEqual(n.erros.map(String), []);
});
