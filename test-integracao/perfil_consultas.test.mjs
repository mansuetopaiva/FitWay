// Perfil: entrar na tela consulta o pedido uma vez; repintar (Editar, Cancelar, Trocar senha) usa o que já veio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
const { chamar } = await abrir();

test("Editar, Cancelar e Trocar senha não repetem a consulta do pedido", async () => {
  const tk = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" })).token;
  const acoes = [];
  const n = await navegador(async (b, t) => { acoes.push(b.acao); return chamar(b, t); }, { token: tk, hash: "#/perfil" });
  await n.espera(() => n.$("#editar") && n.$("#ia"));
  await new Promise((r) => setTimeout(r, 200));
  const consultas = () => acoes.filter((a) => a === "pedido_status").length;
  assert.equal(consultas(), 1, "ao entrar");
  n.clicar("#editar"); await n.espera(() => n.$("#nome"));
  n.clicar("#cancelar"); await n.espera(() => n.$("#editar"));
  n.clicar("#trocarSenha"); await n.espera(() => n.$("#senhaAtual"));
  n.clicar("#senhaCancelar"); await n.espera(() => n.$("#trocarSenha"));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(consultas(), 1, "depois de 3 repinturas");
  assert.ok(n.$("#ia") && /Treino personalizado/.test(n.$("#ia").textContent), "o cartão do treino continua desenhado");
  assert.deepEqual(n.erros.map(String), []);
});
