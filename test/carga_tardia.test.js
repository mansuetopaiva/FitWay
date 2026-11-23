// Partida a frio: o nodemailer (~400 ms) só é carregado quando um email vai ser enviado, não ao importar o backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = `
import { registerHooks } from "node:module";
const vistos = [];
registerHooks({ resolve(spec, ctx, next) { vistos.push(spec); return next(spec, ctx); } });
const nm = () => vistos.includes("nodemailer");
const saida = {};
const { transporteGmail } = await import(${JSON.stringify(REPO + "api/_email.js")});
saida.aposImport = nm();
Object.assign(process.env, { SMTP_USER: "f@exemplo.com", SMTP_SENHA_APP: "x" });
const t = transporteGmail();
saida.aposCriar = nm();
t.sendMail({ from: "f@exemplo.com", to: "a@b.com", subject: "x", text: "x" }).catch(() => {});
for (let i = 0; i < 100 && !nm(); i++) await new Promise((r) => setTimeout(r, 50)); // espera o import acontecer (até 5 s), sem apostar num tempo fixo
saida.aposEnviar = nm();
console.log(JSON.stringify(saida));
process.exit(0);
`;

test("nodemailer só é carregado quando um email é enviado (não no import nem ao criar o transporte)", () => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", SCRIPT], { encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split("\n").pop()), { aposImport: false, aposCriar: false, aposEnviar: true });
});
