// Foto de perfil no servidor: entrada não confiável. Valida o formato, as dimensões e a estrutura do JPEG e tira os metadados (EXIF, GPS).
import { test } from "node:test";
import assert from "node:assert/strict";
import { limparFotoPerfil, MAX_CHARS } from "../api/_foto.js";
import { jpeg, urlDe } from "./_jpeg.js";

const bytes = (r) => Buffer.from(r.foto.split(",")[1], "base64");

test("JPEG quadrado de 512 px é aceito e volta igual quando não tem metadados", () => {
  const b = jpeg(); const r = limparFotoPerfil(urlDe(b));
  assert.equal(r.erro, undefined); assert.deepEqual(bytes(r), b);
});

test("EXIF/GPS (APP1), XMP e comentário são removidos; perfil de cor (APP2) e a imagem ficam", () => {
  const b = jpeg({ app1: "Exif\0\0GPS-LATITUDE-23.55-S", xmp: "<x:xmpmeta>local</x:xmpmeta>", com: "câmera do fulano", icc: "perfil" });
  const r = limparFotoPerfil(urlDe(b));
  assert.equal(r.erro, undefined);
  const s = bytes(r).toString("latin1");
  for (const m of ["Exif", "GPS", "xmpmeta", "fulano"]) assert.ok(!s.includes(m), "sobrou " + m);
  assert.ok(s.includes("ICC_PROFILE") && s.includes("JFIF"));
  assert.ok(bytes(r).length < b.length);
  assert.deepEqual([...bytes(r).subarray(-2)], [0xff, 0xd9], "termina em EOI");
  assert.equal(limparFotoPerfil(r.foto).foto, r.foto, "limpar de novo não muda nada");
});

test("a foto antiga de 160 px continua válida", () => assert.equal(limparFotoPerfil(urlDe(jpeg({ w: 160, h: 160 }))).erro, undefined));

test("recusa o que não é JPEG quadrado de 64 a 1024 px, bem formado, com tamanho dentro do limite", () => {
  const ok = jpeg();
  const casos = {
    "não é texto": 123, "vazio": "data:image/jpeg;base64,", "png": "data:image/png;base64," + ok.toString("base64"),
    "svg": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "sem prefixo": ok.toString("base64"), "base64 inválido": "data:image/jpeg;base64,@@@@" ,
    "base64 com lixo no fim": urlDe(ok) + "<script>", "não começa com SOI": urlDe(Buffer.from("MZ" + "A".repeat(200))),
    "largo demais": urlDe(jpeg({ w: 2000, h: 2000 })), "pequeno demais": urlDe(jpeg({ w: 32, h: 32 })), "não quadrado": urlDe(jpeg({ w: 512, h: 300 })),
    "sem dimensões": urlDe(jpeg({ semSof: true })), "sem EOI": urlDe(jpeg({ semEoi: true })), "truncado": urlDe(ok.subarray(0, 40)),
    "tamanho acima do limite": urlDe(jpeg({ entropia: MAX_CHARS })),
  };
  for (const [nome, v] of Object.entries(casos)) assert.ok(limparFotoPerfil(v).erro, nome);
});

test("marcador com tamanho que passa do fim do arquivo é recusado (não lê fora)", () => {
  const b = jpeg(); b.writeUInt16BE(60000, 4); // tamanho do APP0 absurdo
  assert.ok(limparFotoPerfil(urlDe(b)).erro);
});
