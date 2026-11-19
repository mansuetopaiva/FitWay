// Formulário do pedido: o estado (etapa, fotos) só muda depois que a tela é desenhada; se o desenho falha, volta ao que era.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { formulario as formularioBase } from "./_formulario.mjs";
process.env.TREINO_IA_ATIVO = "1";
Object.assign(process.env, { TERMO_RESPONSAVEL: "Fulano", TERMO_DOCUMENTO: "CPF 000", TERMO_EMAIL: "c@exemplo.com", TERMO_FORO: "Cidade" });
const { chamar } = await abrir();
const formulario = (ate, adaptar) => formularioBase(chamar, ate, adaptar);

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

test("foto lida devagar: se a pessoa já saiu da etapa das fotos, a foto não entra (sem consentimento) nem quebra a tela", async () => {
  const n = await formulario(4);
  n.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  n.w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,/9j/AAAA";
  let abrirFoto; n.w.createImageBitmap = () => new Promise((r) => { abrirFoto = () => r({ width: 10, height: 10 }); });
  const arq = n.$("#f_frente");
  Object.defineProperty(arq, "files", { value: [new n.w.File(["x"], "f.jpg", { type: "image/jpeg" })], configurable: true });
  arq.dispatchEvent(new n.w.Event("change", { bubbles: true }));
  await n.continuar(5); // sai da etapa das fotos antes de a foto ficar pronta
  abrirFoto();
  await new Promise((r) => setTimeout(r, 100));
  assert.match(n.texto(), /Etapa 5 de 6/);
  await n.continuar(6);
  assert.match(n.texto(), /Fotos\s*Nenhuma/, "nenhuma foto no pedido");
  assert.deepEqual(n.erros.map(String), []);
});

test("termo mudou com o formulário aberto: recarrega o termo, pede o aceite de novo e mantém as respostas", async () => {
  const n = await formulario(6);
  const { $ } = n;
  assert.match($(".ped-termo").textContent, /Cidade/);
  n.marcar('[name="termo"]'); n.marcar('[name="cdados"]');
  process.env.TERMO_FORO = "Outra Cidade Nova"; // o termo muda no servidor depois de o Resumo abrir
  try {
    n.clicar("#pedForm .btn");
    await n.espera(() => /O termo foi atualizado/.test($("#pedErr").textContent));
    assert.match($(".ped-termo").textContent, /Outra Cidade Nova/, "mostra o termo novo");
    assert.equal($('[name="termo"]').checked, false, "o aceite do texto antigo não vale");
    assert.match(n.texto(), /Emagrecer|Definir|Ganhar|Saúde|Resumo/);
    assert.match(n.texto(), /Etapa 6 de 6/);
    assert.match($(".ped-res").textContent, /30 anos/, "as respostas continuam");
    n.marcar('[name="termo"]');
    n.clicar("#pedForm .btn");
    await n.espera(() => n.w.location.hash.startsWith("#/pagamento/"));
    assert.deepEqual(n.erros.map(String), []);
  } finally { process.env.TERMO_FORO = "Cidade"; }
});

// Duas fotos para a mesma posição lendo ao mesmo tempo: vale a última escolhida, mesmo que a anterior termine depois.
async function duasLeituras(voltarEntre) {
  const n = await formulario(4);
  let ultimo = 0;
  n.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage(img) { ultimo = img.width; } });
  n.w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,/9j/" + (ultimo === 10 ? "AAAA" : "BBBB");
  const abrir = [];
  n.w.createImageBitmap = (arq) => new Promise((r) => abrir.push(() => r({ width: arq.name === "a.jpg" ? 10 : 20, height: 10 })));
  const escolher = (nome) => {
    const arq = n.$("#f_frente");
    Object.defineProperty(arq, "files", { value: [new n.w.File(["x"], nome, { type: "image/jpeg" })], configurable: true });
    arq.dispatchEvent(new n.w.Event("change", { bubbles: true }));
  };
  escolher("a.jpg");
  if (voltarEntre) { await n.continuar(5); n.clicar("#voltar"); await n.espera(() => /Etapa 4 de 6/.test(n.texto())); }
  escolher("b.jpg");
  abrir[1](); await n.espera(() => n.$(".ped-foto img"));
  abrir[0](); await new Promise((r) => setTimeout(r, 100));
  assert.match(n.$(".ped-foto img").src, /BBBB$/, "fica a foto escolhida por último");
  assert.deepEqual(n.erros.map(String), []);
}
test("foto trocada enquanto a anterior ainda lê: vale a última escolhida", () => duasLeituras(false));
test("a pessoa sai da etapa, volta e troca a foto enquanto a anterior ainda lê: vale a última escolhida", () => duasLeituras(true));
