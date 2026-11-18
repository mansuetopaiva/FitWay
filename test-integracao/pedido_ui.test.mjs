// Formulário do treino personalizado, de ponta a ponta no jsdom: usuário novo chega ao Resumo e envia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
process.env.TREINO_IA_ATIVO = "1";
Object.assign(process.env, { TERMO_RESPONSAVEL: "Fulano", TERMO_DOCUMENTO: "CPF 000", TERMO_EMAIL: "c@exemplo.com", TERMO_FORO: "Cidade" });
const { chamar } = await abrir();

test("usuário novo: preenche as 5 etapas, vê o Resumo com a caixa do termo e envia", async () => {
  const t = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "123456" })).token;
  const n = await navegador(chamar, { hash: "#/pedido/inicial", token: t });
  const { w, $ } = n;
  const marcar = (sel) => { const e = $(sel); if (!e) throw new Error("não achei " + sel); e.checked = true; e.dispatchEvent(new w.Event("change", { bubbles: true })); };
  const digitar = (sel, v) => { const e = $(sel); e.value = v; e.dispatchEvent(new w.Event("input", { bubbles: true })); };
  const continuar = async (etapa) => { n.clicar("#pedForm .btn"); await n.espera(() => n.texto().includes(`Etapa ${etapa} de 6`)); };
  await n.espera(() => $("#pedForm"));
  marcar('[name="objetivo"][value="Emagrecer"]'); marcar('[name="objetivo"][value="Ganhar massa muscular"]');
  marcar('[name="nivel"]'); digitar("#p_idade", "30"); marcar('[name="sexo"]'); digitar("#p_altura", "170"); digitar("#p_peso", "70");
  await continuar(2);
  marcar('[name="dias"]'); marcar('[name="minutos"]');
  await continuar(3);
  for (let i = 0; i < 7; i++) marcar(`[name="parq${i}"][value="nao"]`);
  await continuar(4);
  await continuar(5);
  await continuar(6);
  assert.equal($("#pedErr").textContent, "", "sem erro ao chegar no Resumo");
  assert.ok($('[name="termo"]'), "caixa para aceitar o termo");
  assert.match(n.texto(), /Emagrecer, Ganhar massa muscular/);
  n.clicar("#pedForm .btn");
  await n.espera(() => $("#pedErr").textContent);
  assert.match($("#pedErr").textContent, /aceite o Termo/);
  marcar('[name="termo"]'); marcar('[name="cdados"]');
  n.clicar("#pedForm .btn");
  await n.espera(() => w.location.hash.startsWith("#/pagamento/"));
  assert.deepEqual(n.erros.map(String), []);
});
