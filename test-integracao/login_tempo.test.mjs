// Tempo do login: conta inexistente e senha errada levam o mesmo tempo (o hash falso não pode custar mais na primeira tentativa de cada instância).
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
const { chamar, partidaAFrio } = await abrir();
await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "certa123" }, null, { "x-vercel-forwarded-for": "9.9.9.9" });
let ipn = 0;
const medir = async (c, email) => { const t0 = process.hrtime.bigint(); const r = await c({ acao: "entrar", email, senha: "errada1" }, null, { "x-vercel-forwarded-for": "10.7." + (ipn >> 8) + "." + (ipn++ & 255) }); assert.equal(r.status, 401); return Number(process.hrtime.bigint() - t0) / 1e6; };
const mediana = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

test("a PRIMEIRA tentativa de uma instância nova leva o mesmo tempo com conta inexistente e com senha errada", async () => {
  const razoes = [];
  for (let k = 0; k < 3; k++) { // 3 pares de instâncias novas; a mediana das razões evita um valor atípico
    const a = await partidaAFrio(), b = await partidaAFrio();
    await a({ acao: "eu" }); await b({ acao: "eu" }); // o schema e os imports ficam fora da medida
    const inexistente = await medir(a, `ninguem${k}@x.com`), errada = await medir(b, "ana@x.com");
    razoes.push(inexistente / errada);
  }
  const r = mediana(razoes);
  assert.ok(r > 0.75 && r < 1.3, "razão inexistente/errada na 1ª tentativa: " + razoes.map((x) => x.toFixed(2)));
});

test("em regime, conta inexistente e senha errada têm a mesma mediana de tempo (sem diferença sistemática)", async () => {
  const a = [], b = [];
  for (let i = 0; i < 16; i++) { b.push(await medir(chamar, "ana@x.com")); a.push(await medir(chamar, `ninguem-r${i}@x.com`)); } // alternados
  const r = mediana(a) / mediana(b);
  assert.ok(r > 0.85 && r < 1.18, `medianas: inexistente ${mediana(a).toFixed(1)} ms, errada ${mediana(b).toFixed(1)} ms (razão ${r.toFixed(2)})`);
});
