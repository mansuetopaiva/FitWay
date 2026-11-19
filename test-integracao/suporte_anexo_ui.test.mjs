// Anexo do suporte lido devagar: se a pessoa já trocou de tela, a imagem não aparece em outro chamado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
const { chamar } = await abrir();

test("anexo ainda sendo preparado quando a pessoa sai do formulário: o formulário seguinte abre sem imagem", async () => {
  const tk = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "123456" })).token;
  const n = await navegador(chamar, { hash: "#/suporte/novo", token: tk });
  await n.espera(() => n.$("#supArq"));
  n.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  n.w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,/9j/AAAA";
  let abrirImg; n.w.createImageBitmap = () => new Promise((r) => { abrirImg = () => r({ width: 10, height: 10 }); });
  const arq = n.$("#supArq");
  Object.defineProperty(arq, "files", { value: [new n.w.File(["x"], "f.jpg", { type: "image/jpeg" })], configurable: true });
  arq.onchange({ target: arq });
  n.ir("#/suporte"); await n.espera(() => /Seus chamados/.test(n.texto()));
  n.ir("#/suporte/novo"); await n.espera(() => n.$("#supArq") && n.$("#supAnexar"));
  abrirImg();
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(n.$("#supAnexar") && !n.$(".sup-previa"), "o formulário novo não herda a imagem");
  assert.deepEqual(n.erros.map(String), []);
});
