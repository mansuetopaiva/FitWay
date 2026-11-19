// Abre o formulário do pedido numa conta nova e anda até a etapa pedida (1 a 6): ajuda dos testes de UI do pedido.
import { navegador } from "./navegador.mjs";
let conta = 0;

// `adaptar(corpo da requisição, resposta)` muda a resposta do servidor (para provocar falhas).
export async function formulario(chamar, ate, adaptar = (b, r) => r, { rascunho } = {}) {
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
  if (ate > 5) await continuar(6);
  return { ...n, marcar, digitar, continuar, email, token: t };
}
