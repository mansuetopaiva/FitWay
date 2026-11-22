// Foto de perfil pelo handler real (PGlite): grava a versão sem metadados, recusa o que não é JPEG quadrado, e a foto só vem no "eu".
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
import { jpeg, urlDe } from "../test/_jpeg.js";
const { sql, chamar } = await abrir();
const login = async (email) => (await chamar({ acao: "criar", nome: "Ana", email, senha: "senha123" })).token;

test("foto nova de 512 px: grava sem EXIF/GPS, devolve a versão limpa e o eu a mostra", async () => {
  const t = await login("a@x.com");
  const r = await chamar({ acao: "foto", foto: urlDe(jpeg({ app1: "Exif\0\0GPS-23.55-46.63" })) }, t);
  assert.equal(r.status, 200);
  const guardada = (await sql`select foto from usuarios where email = 'a@x.com'`)[0].foto;
  assert.equal(guardada, r.corpo.foto);
  assert.ok(!Buffer.from(guardada.split(",")[1], "base64").toString("latin1").includes("GPS"), "o banco não guarda a localização");
  assert.equal((await chamar({ acao: "eu" }, t)).corpo.foto, guardada);
});

test("recusa PNG, SVG, JPEG fora do quadrado e lixo: 400 e a foto anterior fica", async () => {
  const t = await login("b@x.com");
  const antiga = urlDe(jpeg({ w: 160, h: 160 }));
  await chamar({ acao: "foto", foto: antiga }, t);
  for (const f of ["data:image/png;base64,iVBORw0KGgo=", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", urlDe(jpeg({ w: 512, h: 300 })), urlDe(jpeg({ w: 4000, h: 4000 })), "x".repeat(200000), null, 7, { a: 1 }]) {
    const r = await chamar({ acao: "foto", foto: f }, t);
    assert.equal(r.status, 400, String(f).slice(0, 30)); assert.match(r.corpo.erro, /Imagem inválida/);
  }
  assert.equal((await sql`select foto from usuarios where email = 'b@x.com'`)[0].foto, antiga);
});

test("foto antiga de 160 px continua aparecendo; '' remove; sem login é 401", async () => {
  const t = await login("c@x.com");
  const antiga = urlDe(jpeg({ w: 160, h: 160 }));
  await sql`update usuarios set foto = ${antiga} where email = 'c@x.com'`; // como estava gravada antes da mudança
  assert.equal((await chamar({ acao: "eu" }, t)).corpo.foto, antiga);
  assert.equal((await chamar({ acao: "perfil", nome: "Ana Maria" }, t)).status, 200, "outras ações seguem sem a foto na sessão");
  assert.equal((await chamar({ acao: "foto", foto: "" }, t)).status, 200);
  assert.equal((await chamar({ acao: "eu" }, t)).corpo.foto, "");
  assert.equal((await chamar({ acao: "foto", foto: antiga })).status, 401);
});

test("o login devolve a foto", async () => {
  const t = await login("d@x.com");
  const f = (await chamar({ acao: "foto", foto: urlDe(jpeg()) }, t)).corpo.foto;
  assert.equal((await chamar({ acao: "entrar", email: "d@x.com", senha: "senha123" })).corpo.foto, f);
});
