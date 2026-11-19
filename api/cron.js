// Vercel Cron (vercel.json: uma vez por dia): GET /api/cron com "Authorization: Bearer <CRON_SECRET>" (a Vercel manda sozinha
// quando a variável CRON_SECRET existe no projeto). Sem a variável, ou com outro token, recusa tudo.
import { neon } from "@neondatabase/serverless";
import { createHash, timingSafeEqual } from "node:crypto";
import { rodarLimpezas } from "./_cron.js";

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
const sha = (t) => createHash("sha256").update(t).digest();

// Compara os SHA-256 (mesmo tamanho sempre): tempo constante, sem vazar o tamanho do segredo.
function autorizado(authorization, segredo) {
  if (typeof segredo !== "string" || !segredo || typeof authorization !== "string") return false;
  return timingSafeEqual(sha(authorization), sha("Bearer " + segredo));
}

export default async function handler(req, res) {
  if (!autorizado(req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).json({ erro: "Não autorizado." });
  if (req.method !== "GET") return res.status(405).json({ erro: "Requisição inválida." });
  try { return res.status(200).json(await rodarLimpezas(sql)); }
  catch (e) { console.error(e); return res.status(500).json({ erro: "Erro no servidor." }); }
}
