// SQL real (PGlite) para o backend do FitWay: troca o neon() por um PGlite e expõe handler e sql.
import { mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO = fileURLToPath(new URL("../", import.meta.url)), R = REPO; // raiz do repositório
// Segredo de teste para o HMAC da exclusão de conta (o real fica só na Vercel).
export const HASH_TESTE = "segredo-de-integracao-com-mais-de-32-caracteres";
process.env.HASH_SEGREDO ||= HASH_TESTE;
export async function abrir() {
  const db = new PGlite();
  const sql = async (partes, ...v) => (await db.query(partes.reduce((a, s, i) => a + "$" + i + s), v)).rows;
  mock.module(pathToFileURL(REPO + "node_modules/@neondatabase/serverless/index.mjs").href, { exports: { neon: () => sql } });
  const app = (await import(R + "api/app.js?" + Math.random())).default;
  const chamar = async (b, token, hs = {}) => {
    let st = 200, corpo, cookie;
    const res = { status(x) { st = x; return this; }, json(x) { corpo = x; return this; }, setHeader(k, v) { if (k === "Set-Cookie") cookie = v; } };
    await app({ method: "POST", headers: { "content-type": "application/json", "user-agent": "t", ...hs }, body: b, cookies: token ? { mt: token } : {} }, res);
    return { status: st, corpo, token: cookie && /mt=([^;]*)/.exec(cookie)[1] };
  };
  await chamar({ acao: "eu" }); // roda o schema()
  return { db, sql, chamar, R };
}
