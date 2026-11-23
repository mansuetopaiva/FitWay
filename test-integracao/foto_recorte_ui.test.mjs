// Recorte da foto de perfil na tela (jsdom + servidor real em PGlite): abrir, mover, zoom, teclado, foco, salvar, cancelar, falhas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
import { jpeg, urlDe } from "../test/_jpeg.js";
const { sql, chamar } = await abrir();
let n_ = 0;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Perfil em modo de edição, com o canvas e o decodificador de imagem simulados (o jsdom não desenha).
// `falhas`: respostas forçadas da ação "foto", usadas uma a uma.
async function perfil({ falhas = [], bitmap = { width: 1200, height: 800 }, foto = "" } = {}) {
  const email = `p${++n_}@x.com`;
  const token = (await chamar({ acao: "criar", nome: "Ana", email, senha: "senha123" })).token;
  if (foto) await sql`update usuarios set foto = ${foto} where email = ${email}`;
  const chamadas = [];
  const n = await navegador(async (b, t) => {
    chamadas.push(b);
    if (b.acao === "foto" && falhas.length) { const f = falhas.shift(); if (f instanceof Error) throw f; return f; }
    return chamar(b, t);
  }, { token, hash: "#/perfil" });
  const log = { desenhos: [], transf: [], jpeg: [], fechou: 0 };
  const proto = n.w.HTMLCanvasElement.prototype;
  proto.getContext = () => ({ fillRect() {}, drawImage: (...a) => log.desenhos.push(a), transform: (...m) => log.transf.push(m), set fillStyle(v) {}, set imageSmoothingQuality(v) {} });
  proto.toDataURL = (tipo, q) => { log.jpeg.push([tipo, q]); return urlDe(jpeg()); };
  n.w.createImageBitmap = async () => { if (bitmap instanceof Error) throw bitmap; return { ...bitmap, close() { log.fechou++; } }; };
  await n.espera(() => n.$("#editar"));
  n.clicar("#editar"); await n.espera(() => n.$("#trocarFoto"));
  const escolher = async (bytes = jpeg(), { nome = "a.jpg", tipo = "image/jpeg" } = {}) => {
    const input = n.$("#fotoArq");
    Object.defineProperty(input, "files", { value: [new n.w.File([bytes], nome, { type: tipo })], configurable: true });
    input.dispatchEvent(new n.w.Event("change", { bubbles: true }));
  };
  const tecla = (alvo, key, extra = {}) => { const ev = new n.w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }); alvo.dispatchEvent(ev); return ev; };
  const dialogo = () => n.$(".recorte");
  const ativo = () => n.w.document.activeElement;
  const estado = () => ({ zoom: +dialogo().dataset.zoom, cx: +dialogo().dataset.cx, cy: +dialogo().dataset.cy });
  const ponteiro = (alvo, tipo, id, x, y) => { const ev = new n.w.MouseEvent(tipo, { clientX: x, clientY: y, bubbles: true }); Object.defineProperty(ev, "pointerId", { value: id }); alvo.dispatchEvent(ev); };
  return { n, email, token, chamadas, log, escolher, tecla, dialogo, ativo, estado, ponteiro, fotoChamadas: () => chamadas.filter((c) => c.acao === "foto") };
}

test("escolher a foto abre o recorte (dialog modal, foco na área, resto da tela inerte) sem enviar nada", async () => {
  const p = await perfil();
  await p.escolher();
  await p.n.espera(() => p.dialogo());
  const d = p.dialogo();
  assert.equal(d.getAttribute("role"), "dialog"); assert.equal(d.getAttribute("aria-modal"), "true");
  assert.match(p.n.w.document.getElementById(d.getAttribute("aria-labelledby")).textContent, /Ajustar foto de perfil/);
  assert.ok(p.n.w.document.getElementById(d.getAttribute("aria-describedby")));
  assert.equal(p.ativo().id, "recPalco", "foco na área do recorte");
  assert.equal(p.n.$("#app").inert, true); assert.equal(p.n.$("#app").getAttribute("aria-hidden"), "true");
  assert.deepEqual([d.dataset.largura, d.dataset.altura, d.dataset.zoom], ["1200", "800", "100"]);
  for (const id of ["recCancelar", "recSalvar", "recMais", "recMenos", "recZoom"]) assert.ok(p.n.$("#" + id), id);
  assert.equal(p.n.$("label[for=recZoom]").textContent, "Zoom", "a barra tem rótulo de verdade");
  assert.equal(p.n.$("#recMais").getAttribute("aria-label"), "Aumentar zoom"); assert.equal(p.n.$("#recMenos").getAttribute("aria-label"), "Diminuir zoom");
  assert.equal(p.fotoChamadas().length, 0, "nada gravado antes de Salvar");
  assert.deepEqual(p.n.erros.map(String), []);
});

test("Esc e Cancelar fecham, devolvem o foco ao botão Trocar foto e mantêm a foto anterior sem tocar no servidor", async () => {
  const antes = urlDe(jpeg({ w: 160, h: 160 }));
  const p = await perfil({ foto: antes });
  for (const fechar of [(x) => x.tecla(x.ativo(), "Escape"), (x) => x.n.clicar("#recCancelar")]) {
    await p.escolher(); await p.n.espera(() => p.dialogo());
    fechar(p);
    await p.n.espera(() => !p.dialogo());
    assert.equal(p.ativo().id, "trocarFoto"); assert.equal(p.n.$("#app").inert, false);
    assert.equal(p.n.$(".avatar").getAttribute("src"), antes, "a foto continua a mesma");
  }
  assert.equal(p.fotoChamadas().length, 0);
  assert.equal((await sql`select foto from usuarios where email = ${p.email}`)[0].foto, antes);
});

test("teclado: setas movem (e param na borda), + e − dão zoom (nunca abaixo de 100%), aria-live anuncia o zoom", async () => {
  const p = await perfil();
  await p.escolher(); await p.n.espera(() => p.dialogo());
  const palco = p.n.$("#recPalco");
  assert.deepEqual(p.estado(), { zoom: 100, cx: 600, cy: 400 });
  p.tecla(palco, "ArrowRight"); await p.n.espera(() => p.estado().cx < 600); // a foto anda para a direita: a janela, para a esquerda
  const x1 = p.estado().cx;
  for (let i = 0; i < 60; i++) p.tecla(palco, "ArrowRight");
  await p.n.espera(() => p.estado().cx === 400, 2000); // 1200x800 no 1x: a janela de 800 não passa da borda esquerda
  for (let i = 0; i < 10; i++) p.tecla(palco, "ArrowUp");
  await pausa(60); assert.equal(p.estado().cy, 400, "no 1x, imagem de paisagem não anda na vertical");
  assert.ok(x1 < 600 && x1 > 400);
  p.tecla(palco, "+"); await p.n.espera(() => p.estado().zoom === 125);
  assert.equal(p.n.$("#recZoom").value, "125"); assert.equal(p.n.$("#recZoom").getAttribute("aria-valuetext"), "125%");
  await p.n.espera(() => /Zoom 125%/.test(p.n.$("#recVivo").textContent));
  assert.equal(p.n.$("#recVivo").getAttribute("aria-live"), "polite");
  p.tecla(palco, "-"); p.tecla(palco, "-"); p.tecla(palco, "-");
  await p.n.espera(() => p.estado().zoom === 100); assert.equal(p.n.$("#recMenos").disabled, true, "no mínimo, − fica desligado");
  p.n.clicar("#recMais"); await p.n.espera(() => p.estado().zoom === 125);
  p.n.$("#recZoom").value = "300"; p.n.$("#recZoom").dispatchEvent(new p.n.w.Event("input", { bubbles: true }));
  await p.n.espera(() => p.estado().zoom === 300);
  p.n.$("#recZoom").value = "900"; p.n.$("#recZoom").dispatchEvent(new p.n.w.Event("input", { bubbles: true }));
  await p.n.espera(() => p.estado().zoom === 400); assert.equal(p.n.$("#recMais").disabled, true);
});

test("mouse e dedos: arrastar move, a roda dá zoom no ponto do cursor, a pinça com dois dedos dá zoom", async () => {
  const p = await perfil();
  await p.escolher(); await p.n.espera(() => p.dialogo());
  const palco = p.n.$("#recPalco");
  p.ponteiro(palco, "pointerdown", 1, 100, 100); p.ponteiro(palco, "pointermove", 1, 140, 100);
  await p.n.espera(() => p.estado().cx < 600);
  assert.ok(Math.abs(p.estado().cx - (600 - 40 / (300 / 800))) < 1, "40 px de tela = 107 px da foto (moldura de 300 px, foto de 800 px de lado menor)");
  p.ponteiro(palco, "pointermove", 1, 9999, 100); await p.n.espera(() => p.estado().cx === 400); // não passa da borda
  p.ponteiro(palco, "pointerup", 1, 9999, 100);
  const roda = new p.n.w.WheelEvent("wheel", { deltaY: -200, clientX: 150, clientY: 150, bubbles: true, cancelable: true });
  assert.equal(palco.dispatchEvent(roda), false, "a roda não rola a página");
  await p.n.espera(() => p.estado().zoom > 140 && p.estado().zoom < 160);
  // pinça: dois dedos afastando de 100 para 200 px dobram o zoom
  p.ponteiro(palco, "pointerdown", 1, 100, 150); p.ponteiro(palco, "pointerdown", 2, 200, 150);
  const z0 = p.estado().zoom;
  p.ponteiro(palco, "pointermove", 2, 300, 150);
  await p.n.espera(() => p.estado().zoom > z0 * 1.8);
  p.ponteiro(palco, "pointerup", 2, 300, 150); p.ponteiro(palco, "pointerup", 1, 100, 150);
});

test("Tab fica preso dentro do recorte (volta ao primeiro depois do último e vice-versa)", async () => {
  const p = await perfil();
  await p.escolher(); await p.n.espera(() => p.dialogo());
  const ordem = [...p.dialogo().querySelectorAll("button, input, [tabindex='0']")].filter((x) => !x.disabled);
  assert.equal(ordem[0].id, "recPalco"); assert.equal(ordem.at(-1).id, "recSalvar");
  ordem.at(-1).focus(); assert.equal(p.tecla(p.ativo(), "Tab").defaultPrevented, true); assert.equal(p.ativo().id, "recPalco");
  assert.equal(p.tecla(p.ativo(), "Tab", { shiftKey: true }).defaultPrevented, true); assert.equal(p.ativo().id, "recSalvar");
  const fora = p.n.w.document.createElement("button"); p.n.w.document.body.appendChild(fora); fora.focus(); // foco que escapa para fora volta para dentro
  assert.ok(p.dialogo().contains(p.ativo()), "o foco foi puxado de volta para dentro");
});

test("Enter salva: 512x512, JPEG 0,85, só o quadrado visível; o servidor guarda; o recorte fecha e o foco volta ao botão", async () => {
  const p = await perfil();
  await p.escolher(); await p.n.espera(() => p.dialogo());
  p.tecla(p.n.$("#recPalco"), "Enter");
  await p.n.espera(() => !p.dialogo());
  assert.equal(p.fotoChamadas().length, 1);
  const [orig, sx, sy, lado, lado2, dx, dy, dw, dh] = p.log.desenhos.at(-1);
  assert.deepEqual([sx, sy, lado, lado2, dx, dy, dw, dh], [200, 0, 800, 800, 0, 0, 512, 512], "o quadrado central de 800x800, escalado para 512x512");
  assert.ok(orig);
  assert.deepEqual(p.log.jpeg.at(-1), ["image/jpeg", 0.85]);
  const gravada = (await sql`select foto from usuarios where email = ${p.email}`)[0].foto;
  assert.ok(gravada.startsWith("data:image/jpeg;base64,"));
  assert.equal(p.n.$(".avatar").getAttribute("src"), gravada);
  assert.equal(p.ativo().id, "trocarFoto"); assert.match(p.n.$("#toast").textContent, /Foto atualizada/);
  assert.deepEqual(p.n.erros.map(String), []);
});

test("falha de rede ou recusa do servidor: o recorte continua aberto, com a mensagem, e dá para tentar de novo", async () => {
  const p = await perfil({ falhas: [new Error("rede"), { status: 400, corpo: { erro: "Imagem inválida. Tente outra foto." } }] });
  await p.escolher(); await p.n.espera(() => p.dialogo());
  p.n.clicar("#recSalvar");
  await p.n.espera(() => /Sem conexão/.test(p.n.$("#recErr").textContent));
  assert.ok(p.dialogo(), "continua aberto"); assert.equal(p.n.$("#recSalvar").disabled, false); assert.equal(p.n.$("#recSalvar").textContent, "Salvar");
  assert.equal(p.n.$("#recErr").getAttribute("role"), "alert");
  assert.equal(p.ativo().id, "recSalvar");
  p.n.clicar("#recSalvar");
  await p.n.espera(() => /Imagem inválida/.test(p.n.$("#recErr").textContent));
  assert.ok(p.dialogo());
  p.n.clicar("#recSalvar");
  await p.n.espera(() => !p.dialogo());
  assert.equal(p.fotoChamadas().length, 3);
  assert.ok((await sql`select foto from usuarios where email = ${p.email}`)[0].foto, "só o terceiro envio gravou");
});

test("foto que não serve (tipo, tamanho, ilegível, pequena demais): mensagem clara, sem recorte e sem envio", async () => {
  const p = await perfil();
  const toast = () => p.n.$("#toast").textContent;
  await p.escolher(Buffer.from("texto"), { nome: "a.txt", tipo: "text/plain" });
  await p.n.espera(() => /JPEG, PNG ou WebP/.test(toast()));
  await p.escolher(Buffer.alloc(13 * 1024 * 1024, 1));
  await p.n.espera(() => /grande demais \(máximo 12 MB\)/.test(toast()));
  await p.escolher(jpeg()); // decodificador falha
  p.n.w.createImageBitmap = async () => { throw new Error("corrompida"); };
  await p.escolher(jpeg());
  await p.n.espera(() => /Não consegui abrir esta imagem/.test(toast()));
  p.n.w.createImageBitmap = async () => ({ width: 100, height: 100 });
  await p.escolher(jpeg());
  await p.n.espera(() => /pequena demais/.test(toast()));
  await pausa(80);
  assert.ok(!p.dialogo()); assert.equal(p.fotoChamadas().length, 0); assert.ok(!p.n.$("#app").inert);
});

test("orientação EXIF: foto de celular deitada (EXIF 6 e o navegador não girou) é girada aqui; já girada pelo navegador não gira de novo", async () => {
  const exif = (o) => { const t = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0]; return "Exif\0\0" + Buffer.from(t).toString("latin1"); };
  const cru = jpeg({ app1: exif(6), w: 4000, h: 3000 });
  let p = await perfil({ bitmap: { width: 4000, height: 3000 } }); // o navegador devolveu os pixels crus
  await p.escolher(cru); await p.n.espera(() => p.dialogo());
  assert.deepEqual([p.dialogo().dataset.largura, p.dialogo().dataset.altura], ["3000", "4000"], "girada para retrato");
  assert.equal(p.log.transf.length, 1); assert.deepEqual(p.log.transf[0], [0, 1, -1, 0, 3000, 0]);
  p = await perfil({ bitmap: { width: 3000, height: 4000 } }); // o navegador já girou
  await p.escolher(cru); await p.n.espera(() => p.dialogo());
  assert.deepEqual([p.dialogo().dataset.largura, p.dialogo().dataset.altura], ["3000", "4000"]); assert.equal(p.log.transf.length, 0);
  p = await perfil({ bitmap: { width: 4000, height: 3000 } }); // sem EXIF: fica como está
  await p.escolher(jpeg({ w: 4000, h: 3000 })); await p.n.espera(() => p.dialogo());
  assert.deepEqual([p.dialogo().dataset.largura, p.dialogo().dataset.altura], ["4000", "3000"]);
});

test("foto QUADRADA com EXIF 6: não gira duas vezes quando o navegador já aplica o EXIF (antes girava sempre); gira quando o teste do navegador mostra que ele não aplica", async () => {
  const exif = (o) => { const t = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0]; return "Exif\0\0" + Buffer.from(t).toString("latin1"); };
  const quadrada = jpeg({ app1: exif(6), w: 1000, h: 1000 });
  // o navegador aplica o EXIF (a sonda de 2x1 volta como 1x2): sem giro
  let p = await perfil({ bitmap: { width: 1000, height: 1000 } });
  p.n.w.HTMLCanvasElement.prototype.toBlob = (f) => f(new p.n.w.Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]));
  p.n.w.createImageBitmap = async (a) => (a.name ? { width: 1000, height: 1000 } : { width: 1, height: 2 });
  await p.escolher(quadrada); await p.n.espera(() => p.dialogo());
  assert.equal(p.log.transf.length, 0, "o navegador já girou: não gira de novo");
  // o navegador NÃO aplica o EXIF (a sonda de 2x1 continua 2x1): gira
  p = await perfil({ bitmap: { width: 1000, height: 1000 } });
  p.n.w.HTMLCanvasElement.prototype.toBlob = (f) => f(new p.n.w.Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]));
  p.n.w.createImageBitmap = async (a) => (a.name ? { width: 1000, height: 1000 } : { width: 2, height: 1 });
  await p.escolher(quadrada); await p.n.espera(() => p.dialogo());
  assert.equal(p.log.transf.length, 1); assert.deepEqual(p.log.transf[0], [0, 1, -1, 0, 1000, 0]);
});

test("fechar o recorte solta a foto da memória (bitmap.close); ponteiro perdido não deixa um dedo fantasma que trava o arrastar", async () => {
  const p = await perfil();
  await p.escolher(); await p.n.espera(() => p.dialogo());
  const palco = p.n.$("#recPalco");
  p.ponteiro(palco, "pointerdown", 1, 100, 100); p.ponteiro(palco, "pointerdown", 2, 200, 100); // pinça começou
  p.ponteiro(palco, "lostpointercapture", 2, 200, 100); // o segundo dedo saiu sem pointerup
  const z = p.estado().zoom;
  p.ponteiro(palco, "pointermove", 1, 140, 100);
  await p.n.espera(() => p.estado().cx < 600);
  assert.equal(p.estado().zoom, z, "voltou a ser arrasto de um dedo, sem zoom");
  p.n.clicar("#recCancelar"); await p.n.espera(() => !p.dialogo());
  assert.equal(p.log.fechou, 1, "a imagem decodificada foi liberada");
});
