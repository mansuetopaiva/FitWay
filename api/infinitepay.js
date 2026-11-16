// Webhook do InfinitePay (POST /api/infinitepay). O webhook não é assinado: o corpo só diz QUAL pagamento conferir.
// Valor e "pago" vêm sempre do payment_check (confirmarCartao). 200 = processado ou ignorado; 400 = erro temporário
// (o InfinitePay reenvia tudo que não for 2xx).
import { neon } from "@neondatabase/serverless";
import { confirmarCartao } from "./_pagamento.js";

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Requisição inválida." });
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== "object") return res.status(200).json({ ok: false }); // corpo inválido: reenviar não adianta
  try {
    const r = await confirmarCartao(sql, { order_nsu: b.order_nsu, transaction_nsu: b.transaction_nsu, slug: b.invoice_slug });
    return res.status(r === "temporario" ? 400 : 200).json({ ok: r !== "temporario" });
  } catch (e) {
    console.error(e);
    return res.status(400).json({ ok: false });
  }
}
