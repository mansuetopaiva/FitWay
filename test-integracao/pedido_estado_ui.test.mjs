// Formulário do pedido: o estado (etapa, fotos) só muda depois que a tela é desenhada; se o desenho falha, volta ao que era.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
process.env.TREINO_IA_ATIVO = "1";
Object.assign(process.env, { TERMO_RESPONSAVEL: "Fulano", TERMO_DOCUMENTO: "CPF 000", TERMO_EMAIL: "c@exemplo.com", TERMO_FORO: "Cidade" });
const { chamar } = await abrir();
let conta = 0;

// Abre o formulário numa conta nova e anda até a etapa pedida (1 a 6). `adaptar` muda a resposta do servidor (para provocar falhas).
async function formulario(ate, adaptar = (b, r) => r) {
  const email = `u${++conta}@x.com`;
  const t = (await chamar({ acao: "criar", nome: "Ana", email, senha: "123456" })).token;
  const n = await navegador(async (b, tk) => adaptar(b, await chamar(b, tk)), { hash: "#/pedido/inicial", token: t });
  const { w, $ } = n;
  const marcar = (sel) => { const e = $(sel); if (!e) throw new Error("não achei " + sel); e.checked = true; e.dispatchEvent(new w.Event("change", { bubbles: true })); };
  const digitar = (sel, v) => { const e = $(sel); e.value = v; e.dispatchEvent(new w.Event("input", { bubbles: true })); };
  const continuar = async (etapa) => { n.clicar("#pedForm .btn"); await n.espera(() => n.texto().includes(`Etapa ${etapa} de 6`)); };
  await n.espera(() => $("#pedForm"));
  marcar('[name="objetivo"]'); marcar('[name="nivel"]'); digitar("#p_idade", "30"); marcar('[name="sexo"]'); digitar("#p_altura", "170"); digitar("#p_peso", "70");
  if (ate > 1) await continuar(2);
  if (ate > 2) { marcar('[name="dias"]'); marcar('[name="minutos"]'); await continuar(3); }
  if (ate > 3) { for (let i = 0; i < 7; i++) marcar(`[name="parq${i}"][value="nao"]`); await continuar(4); }
  if (ate > 4) await continuar(5);
  return { ...n, marcar, digitar, continuar };
}

test("o Resumo falha ao ser desenhado: a etapa não avança, a tela fica inteira e o próximo Continuar não acusa o termo", async () => {
  const n = await formulario(5, (b, r) => { if (b.acao === "pedido_status" && b.form) delete r.corpo.precos; return r; }); // o Resumo lê st.precos
  n.clicar("#pedForm .btn");
  await n.espera(() => /Não consegui abrir/.test(n.texto()));
  assert.match(n.texto(), /Etapa 5 de 6/);
  assert.ok(n.$("#p_observacoes"), "a etapa 5 continua na tela");
  n.clicar("#pedForm .btn"); // tenta de novo: a etapa guardada tem de ser a 5, não a 6
  await n.espera(() => /Não consegui abrir/.test(n.texto()));
  assert.ok(!/aceite o Termo/.test(n.texto()), "a validação é a da etapa 5");
  assert.match(n.texto(), /Etapa 5 de 6/);
});
