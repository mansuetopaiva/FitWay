// Segundo fator do admin (docs/plano-2fa-admin.md): TOTP (RFC 6238, HMAC-SHA1, 6 dígitos, 30 s) e cifra do segredo (AES-256-GCM),
// só com node:crypto. Funções puras: nada aqui toca o banco nem lê o relógio sozinho.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", PASSO_MS = 30000;
export const base32 = (buf) => { let bits = 0, v = 0, s = ""; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { s += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } return bits ? s + B32[(v << (5 - bits)) & 31] : s; };
// Aceita minúsculas, espaços e hífens (a chave é mostrada em grupos); null se sobrar caractere fora do alfabeto.
export function desbase32(txt) {
  const s = String(txt).toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!/^[A-Z2-7]*$/.test(s)) return null;
  let bits = 0, v = 0; const out = [];
  for (const c of s) { v = (v << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const novoSegredo = () => randomBytes(20);
export const agrupar = (s) => s.replace(/(.{4})(?=.)/g, "$1 ");
export const passoDe = (ms) => Math.floor(ms / PASSO_MS);
export function codigo(segredo, passo, digitos = 6) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(passo));
  const h = createHmac("sha1", segredo).update(c).digest(), o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digitos).padStart(digitos, "0");
}
// Janela de ±1 passo (relógio do celular até 30 s fora). Devolve o passo aceito (o chamador grava para não aceitar o código de novo) ou null.
export function confere(segredo, tentativa, agora = Date.now()) {
  const t = typeof tentativa === "string" ? tentativa.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(t)) return null;
  const p = passoDe(agora); let achou = null;
  for (const d of [0, -1, 1]) if (codigo(segredo, p + d) === t && achou === null) achou = p + d; // sem retorno antecipado: tempo igual
  return achou;
}
export const otpauth = (email, chave) => `otpauth://totp/${encodeURIComponent("FitWay:" + email)}?secret=${chave}&issuer=FitWay&algorithm=SHA1&digits=6&period=30`;

// 10 códigos de uso único: 10 caracteres base32 (50 bits), mostrados uma vez.
export const novosCodigosRecuperacao = () => Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => B32[randomInt(32)]).join(""));

// Cifra: "v1:iv:tag:texto" (hex). A chave de 32 bytes sai por HKDF de TOTP_CHAVE (32+ caracteres, separada de HASH_SEGREDO).
const chave = (v) => (typeof v === "string" && v.length >= 32 ? Buffer.from(hkdfSync("sha256", v, "", "fitway-totp-v1", 32)) : null);
export const totpChaveOk = (env = process.env) => !!chave(env.TOTP_CHAVE);
export function cifrar(segredo, env = process.env) {
  const k = chave(env.TOTP_CHAVE); if (!k) throw new Error("TOTP_CHAVE ausente ou curta");
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", k, iv), t = Buffer.concat([c.update(segredo), c.final()]);
  return ["v1", iv.toString("hex"), c.getAuthTag().toString("hex"), t.toString("hex")].join(":");
}
// { segredo, regravar } com a chave atual ou a anterior (regravar = true: foi lido com a anterior); null se não abrir.
export function decifrar(texto, env = process.env) {
  const p = typeof texto === "string" ? texto.split(":") : [];
  if (p.length !== 4 || p[0] !== "v1" || !/^[0-9a-f]{24}$/.test(p[1]) || !/^[0-9a-f]{32}$/.test(p[2]) || !/^[0-9a-f]*$/.test(p[3])) return null;
  for (const [nome, regravar] of [["TOTP_CHAVE", false], ["TOTP_CHAVE_ANTERIOR", true]]) {
    const k = chave(env[nome]); if (!k) continue;
    try {
      const d = createDecipheriv("aes-256-gcm", k, Buffer.from(p[1], "hex")); d.setAuthTag(Buffer.from(p[2], "hex"));
      return { segredo: Buffer.concat([d.update(Buffer.from(p[3], "hex")), d.final()]), regravar };
    } catch (e) { /* chave errada ou texto adulterado: tenta a outra */ }
  }
  return null;
}
