// O IP do login vem de x-vercel-forwarded-for (a Vercel define; o cliente não consegue mudar), não de x-forwarded-for / x-real-ip,
// que o cliente pode inventar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
const { sql, chamar } = await abrir();
await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "certa123" }, null, { "x-vercel-forwarded-for": "9.9.9.9" });
const entrar = (hs, email = "ana@x.com", senha = "errada1") => chamar({ acao: "entrar", email, senha }, null, hs);

test("IP falso em x-forwarded-for e x-real-ip não muda o IP contado", async () => {
  await sql`delete from login_tentativas`;
  for (let i = 0; i < 20; i++) await entrar({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": `1.1.1.${i}, 2.2.2.2`, "x-real-ip": `3.3.3.${i}` }, `x${i}@x.com`);
  const chaves = (await sql`select chave, falhas from login_tentativas where chave like 'i:%'`);
  assert.deepEqual(chaves.map((c) => [c.chave, c.falhas]), [["i:198.51.100.7", 20]], "uma só chave, a da Vercel");
  const preso = await entrar({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "5.5.5.5" }, "ana@x.com", "certa123");
  assert.equal(preso.status, 401, "o IP da Vercel está bloqueado, mesmo com outro IP inventado");
  const livre = await entrar({ "x-vercel-forwarded-for": "198.51.100.8", "x-forwarded-for": "198.51.100.7", "x-real-ip": "198.51.100.7" }, "ana@x.com", "certa123");
  assert.equal(livre.status, 200, "outro IP da Vercel entra, mesmo imitando o IP bloqueado nos outros cabeçalhos");
});
