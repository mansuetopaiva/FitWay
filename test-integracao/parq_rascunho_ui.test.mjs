// Formulário do pedido: PAR-Q com "Sim" (liberação médica) e rascunho salvo no aparelho.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { formulario as formularioBase } from "./_formulario.mjs";
process.env.TREINO_IA_ATIVO = "1";
Object.assign(process.env, { TERMO_RESPONSAVEL: "Fulano", TERMO_DOCUMENTO: "CPF 000", TERMO_EMAIL: "c@exemplo.com", TERMO_FORO: "Cidade" });
const { sql, chamar } = await abrir();
const formulario = (ate) => formularioBase(chamar, ate);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test("PAR-Q com Sim: aparece o aviso com a caixa de liberação; sem marcar não avança (erro ligado à caixa); marcando avança; voltar para Não some o aviso", async () => {
  const n = await formulario(3); // etapa 3 (Saúde)
  for (let i = 0; i < 7; i++) n.marcar(`[name="parq${i}"][value="nao"]`);
  assert.ok(!n.$("#avisoParq"), "tudo Não: sem aviso");
  n.marcar('[name="parq2"][value="sim"]');
  await n.espera(() => n.$("#avisoParq"));
  assert.match(n.$("#avisoParq").textContent, /liberação médica/);
  n.clicar("#pedForm .btn");
  assert.match(n.$("#pedErr").textContent, /respondeu Sim/);
  assert.equal(n.$('[name="liberacao"]').getAttribute("aria-invalid"), "true");
  assert.equal(n.w.document.activeElement, n.$('[name="liberacao"]'));
  assert.match(n.texto(), /Etapa 3 de 6/);
  n.marcar('[name="liberacao"]');
  await n.continuar(4);
  // volta e muda a resposta: o aviso some quando não há mais Sim
  n.clicar("#voltar"); await n.espera(() => /Etapa 3 de 6/.test(n.texto()));
  assert.ok(n.$("#avisoParq") && n.$('[name="liberacao"]').checked, "a marca da liberação voltou");
  n.marcar('[name="parq2"][value="nao"]');
  await n.espera(() => !n.$("#avisoParq"));
});

test("PAR-Q com Sim e liberação: o Resumo mostra as perguntas e a liberação, e o pedido é criado com os dois", async () => {
  const n = await formulario(3);
  for (let i = 0; i < 7; i++) n.marcar(`[name="parq${i}"][value="${i === 0 || i === 4 ? "sim" : "nao"}"]`);
  await n.espera(() => n.$("#avisoParq"));
  n.marcar('[name="liberacao"]');
  await n.continuar(4); await n.continuar(5); await n.continuar(6);
  assert.match(n.texto(), /PAR-Q\s*Sim nas perguntas 1, 5/);
  assert.match(n.texto(), /Liberação médica\s*Sim/);
  n.marcar('[name="termo"]'); n.marcar('[name="cdados"]');
  n.clicar("#pedForm .btn");
  await n.espera(() => n.w.location.hash.startsWith("#/pagamento/"));
  const [p] = await sql`select respostas from pedidos where email = ${n.email}`;
  assert.equal(p.respostas.parq[0], true); assert.equal(p.respostas.parq[4], true); assert.equal(p.respostas.parq[1], false);
  assert.equal(p.respostas.liberacao, true);
  assert.deepEqual(n.erros.map(String), []);
});

test("rascunho: o que foi digitado volta ao reabrir o formulário (na etapa em que parou), mas os aceites do termo e dos dados não", async () => {
  const n = await formulario(6);
  n.marcar('[name="termo"]'); n.marcar('[name="cdados"]');
  const chave = Object.keys(n.w.localStorage).find((k) => k.startsWith("fw_pedido_inicial_"));
  assert.ok(chave, "rascunho guardado: " + Object.keys(n.w.localStorage));
  const guardado = JSON.parse(n.w.localStorage.getItem(chave));
  assert.equal(guardado.f.idade, 30); assert.ok(!("consentimentos" in guardado.f) && !("termo" in guardado.f), "aceites não vão para o aparelho");
  n.ir("#/perfil"); await n.espera(() => n.$("#editar"));
  n.ir("#/pedido/inicial"); await n.espera(() => n.$("#pedForm"));
  assert.match(n.texto(), /Etapa 5 de 6/, "volta no máximo até a etapa 5, nunca direto no Resumo");
  n.clicar("#pedForm .btn"); await n.espera(() => /Etapa 6 de 6/.test(n.texto()));
  assert.match(n.texto(), /30 anos/); assert.match(n.texto(), /170 cm/);
  assert.equal(n.$('[name="termo"]').checked, false); assert.equal(n.$('[name="cdados"]').checked, false);
  // ao enviar, o rascunho é apagado
  n.marcar('[name="termo"]'); n.marcar('[name="cdados"]'); n.clicar("#pedForm .btn");
  await n.espera(() => n.w.location.hash.startsWith("#/pagamento/"));
  assert.equal(n.w.localStorage.getItem(chave), null, "enviado: sem rascunho de saúde no aparelho");
});

test("rascunho: campos de texto de saúde voltam; rascunho de outra conta não aparece; PAR-Q de tamanho antigo é refeito", async () => {
  const n = await formulario(3);
  n.digitar("#p_lesoes", "joelho direito");
  const chave = Object.keys(n.w.localStorage).find((k) => k.startsWith("fw_pedido_inicial_"));
  n.ir("#/perfil"); await n.espera(() => n.$("#editar"));
  n.ir("#/pedido/inicial"); await n.espera(() => n.$("#pedForm"));
  await n.espera(() => /Etapa 3 de 6/.test(n.texto()));
  assert.equal(n.$("#p_lesoes").value, "joelho direito");
  // rascunho antigo, com 5 respostas de PAR-Q (o questionário hoje tem 7): as respostas são refeitas e a etapa não passa em branco
  const r = JSON.parse(n.w.localStorage.getItem(chave)); r.f.parq = [false, false, false, false, false]; r.etapa = 2;
  n.w.localStorage.setItem(chave, JSON.stringify(r));
  n.ir("#/perfil"); await n.espera(() => n.$("#editar"));
  n.ir("#/pedido/inicial"); await n.espera(() => /Etapa 3 de 6/.test(n.texto()));
  assert.equal(n.w.document.querySelectorAll('[name^="parq"][value="nao"]').length, 7);
  assert.equal(n.w.document.querySelectorAll('[name^="parq"]:checked').length, 0, "nada marcado: tem de responder de novo");
  n.clicar("#pedForm .btn");
  assert.match(n.$("#pedErr").textContent, /Responda a pergunta 1/);
  // rascunho de outra conta no mesmo aparelho não é lido (a chave leva o email)
  n.w.localStorage.setItem("fw_pedido_inicial_outra@x.com", JSON.stringify({ f: { idade: 99, lesoes: "de outra pessoa" }, etapa: 3 }));
  n.ir("#/perfil"); await n.espera(() => n.$("#editar"));
  n.ir("#/pedido/inicial"); await n.espera(() => /Etapa 3 de 6/.test(n.texto()));
  assert.ok(!/de outra pessoa/.test(n.$("#p_lesoes").value));
});
