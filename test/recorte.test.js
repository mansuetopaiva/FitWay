// Recorte da foto de perfil: a lógica pura (js/recorte.js): zoom mínimo, limites do arrasto, âncora do zoom, EXIF.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { jpeg } from "./_jpeg.js";

const janela = { document: undefined };
vm.runInNewContext(readFileSync(fileURLToPath(new URL("../js/recorte.js", import.meta.url)), "utf8"), { window: janela });
const R = janela.FitWayRecorte;
const perto = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} != ${b}`);

// Nunca aparece fundo vazio: a janela inteira fica dentro da imagem.
const dentro = (e) => { const r = R.recorte(e); return r.sx >= -1e-9 && r.sy >= -1e-9 && r.sx + r.lado <= e.iw + 1e-9 && r.sy + r.lado <= e.ih + 1e-9 && r.lado > 0; };

test("zoom mínimo cobre a moldura: no 1x, o lado menor da imagem inteiro aparece (paisagem, retrato e quadrada)", () => {
  for (const [iw, ih] of [[4000, 3000], [3000, 4000], [800, 800], [128, 4000]]) {
    const e = R.novo(iw, ih, 320);
    perto(R.recorte(e).lado, Math.min(iw, ih), `${iw}x${ih}`);
    perto(R.escala(e) * Math.min(iw, ih), 320, "a escala cobre a moldura");
    assert.ok(dentro(e));
  }
});

test("começa centralizado; arrastar anda até a borda e para ali, nos quatro lados, no 1x e no 2x", () => {
  const e = R.novo(4000, 3000, 300); // paisagem: só dá para mover na horizontal no 1x
  perto(e.cx, 2000, "centro x"); perto(e.cy, 1500, "centro y");
  R.mover(e, 99999, 99999); // imagem toda para a direita/baixo = janela no canto esquerdo/topo
  perto(e.cx, 1500, "borda esquerda: a janela de 3000 começa em 0"); perto(e.cy, 1500, "no 1x não anda na vertical");
  R.mover(e, -99999, -99999);
  perto(e.cx, 2500, "borda direita"); assert.ok(dentro(e));
  R.zoomar(e, 2); // janela de 1500
  R.mover(e, 99999, 99999); perto(e.cx, 750, "2x esquerda"); perto(e.cy, 750, "2x topo");
  R.mover(e, -99999, -99999); perto(e.cx, 3250, "2x direita"); perto(e.cy, 2250, "2x base"); assert.ok(dentro(e));
});

test("arrastar anda na proporção da escala: 100 px de tela = 100/escala px da imagem, no sentido contrário", () => {
  const e = R.novo(2000, 2000, 400); R.zoomar(e, 2); // escala = 400/2000*2 = 0.4
  const antes = e.cx; R.mover(e, 40, 0);
  perto(antes - e.cx, 100, "40 px de tela = 100 px de imagem");
});

test("zoom limitado entre 1 e o máximo (nunca abaixo do mínimo que cobre); valores absurdos não quebram", () => {
  const e = R.novo(3000, 2000, 300);
  for (const z of [0, -5, 0.3, 1, 2.5, 4, 9, 1e9]) { R.zoomar(e, z); assert.ok(e.zoom >= 1 && e.zoom <= R.ZOOM_MAX, "zoom " + z + " -> " + e.zoom); assert.ok(dentro(e)); }
  R.zoomar(e, 1);
  perto(R.recorte(e).lado, 2000, "de volta ao 1x");
});

test("zoom com âncora: o ponto da imagem sob a âncora não sai do lugar (quando não bate na borda)", () => {
  const e = R.novo(4000, 4000, 400); R.zoomar(e, 2);
  const ponto = (ax, ay) => ({ x: e.cx + (ax - 200) / R.escala(e), y: e.cy + (ay - 200) / R.escala(e) });
  const antes = ponto(300, 100);
  R.zoomar(e, 3, 300, 100);
  const depois = ponto(300, 100);
  perto(depois.x, antes.x, "x", 1e-6); perto(depois.y, antes.y, "y", 1e-6);
  // âncora num canto: o ajuste mantém a janela dentro da imagem em vez de abrir fundo vazio
  const f = R.novo(1000, 1000, 400); R.zoomar(f, 4, 0, 0); assert.ok(dentro(f));
});

test("qualquer sequência de arrastos e zooms deixa a janela dentro da imagem (propriedade, 2000 sorteios)", () => {
  let sem = 12345; const rnd = () => (sem = (sem * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 2000; k++) {
    const e = R.novo(Math.round(100 + rnd() * 5000), Math.round(100 + rnd() * 5000), Math.round(150 + rnd() * 250));
    for (let j = 0; j < 8; j++) {
      if (rnd() < 0.5) R.mover(e, (rnd() - 0.5) * 2000, (rnd() - 0.5) * 2000);
      else R.zoomar(e, rnd() * 6, rnd() * e.lado, rnd() * e.lado);
      assert.ok(dentro(e), JSON.stringify(e));
    }
  }
});

// ---------- EXIF ----------
function exif(o, { little = true } = {}) {
  const u16 = (n) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n) => (little ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(2),
    ...u16(0x010f), ...u16(2), ...u32(1), ...u32(0), // outra tag antes (fabricante)
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(o), 0, 0, ...u32(0)];
  const corpo = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.from(tiff)]);
  return corpo.toString("latin1");
}
const comExif = (o, opc) => new Uint8Array(jpeg({ app1: exif(o, opc), w: 4000, h: 3000 }));

test("orientação EXIF: lê 1 a 8, em little e big endian; sem EXIF ou lixo vale 1", () => {
  for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) for (const little of [true, false]) assert.equal(R.orientacao(comExif(o, { little })), o, `${o} ${little}`);
  assert.equal(R.orientacao(new Uint8Array(jpeg())), 1, "sem EXIF");
  assert.equal(R.orientacao(comExif(9)), 1, "valor fora de 1-8");
  assert.equal(R.orientacao(new Uint8Array([1, 2, 3])), 1, "não é JPEG");
  assert.equal(R.orientacao(new Uint8Array(jpeg({ app1: "Exif\0\0II*\0\xff\xff\xff\xff" }))), 1, "offset do IFD fora do arquivo");
  assert.deepEqual({ ...R.dimensoesJpeg(comExif(6)) }, { w: 4000, h: 3000 }); // {...}: o objeto vem de outro contexto do vm
  assert.equal(R.dimensoesJpeg(new Uint8Array([0xff, 0xd8])), null);
});

test("transformação da orientação: tamanho trocado de 5 a 8, e os cantos da imagem crua caem nos cantos certos", () => {
  const w = 40, h = 30;
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  // [orientação, onde cai o canto superior esquerdo cru, largura, altura finais] (EXIF: 6 = girar 90° horário; 8 = 90° anti-horário)
  const esperado = { 1: [[0, 0], w, h], 2: [[w, 0], w, h], 3: [[w, h], w, h], 4: [[0, h], w, h], 5: [[0, 0], h, w], 6: [[h, 0], h, w], 7: [[h, w], h, w], 8: [[0, w], h, w] };
  for (const [o, [tl, L, A]] of Object.entries(esperado)) {
    const t = R.transformacao(+o, w, h);
    assert.equal(t.largura, L, "largura " + o); assert.equal(t.altura, A, "altura " + o);
    assert.deepEqual(ap(t.matriz, 0, 0), tl, "canto superior esquerdo " + o);
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) { const [px, py] = ap(t.matriz, x, y); assert.ok(px >= 0 && px <= L && py >= 0 && py <= A, `canto ${x},${y} em ${o}`); }
    assert.equal(new Set([[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => ap(t.matriz, x, y).join())).size, 4, "os 4 cantos continuam distintos em " + o);
  }
  const t99 = R.transformacao(99, 5, 6); assert.deepEqual([[...t99.matriz], t99.largura, t99.altura], [[1, 0, 0, 1, 0, 0], 5, 6]);
});
