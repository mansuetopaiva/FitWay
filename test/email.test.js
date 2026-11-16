// Envio de email (api/_email.js). Transporte falso: nenhum email real sai nos testes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emailDisponivel, enviarEmail, mensagemIndisponivel, transporteGmail } from "../api/_email.js";

const SMTP = { SMTP_USER: "fitway@exemplo.com", SMTP_SENHA_APP: "abcd efgh ijkl mnop", SITE_URL: "https://fitway.exemplo.com" };
function comEnv(vars, f) {
  const antes = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  return Promise.resolve().then(f).finally(() => { for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
}

test("transporte do Gmail: smtp.gmail.com, 465, TLS, tempos de 10 s; null sem as variáveis", () => comEnv(SMTP, () => {
  const t = transporteGmail();
  const o = t.options;
  assert.equal(o.host, "smtp.gmail.com"); assert.equal(o.port, 465); assert.equal(o.secure, true);
  assert.deepEqual(o.auth, { user: SMTP.SMTP_USER, pass: SMTP.SMTP_SENHA_APP });
  for (const k of ["connectionTimeout", "greetingTimeout", "socketTimeout"]) assert.equal(o[k], 10000, k);
  return comEnv({ SMTP_SENHA_APP: undefined }, () => assert.equal(transporteGmail(), null));
}));

test("disponível só com SMTP_USER, SMTP_SENHA_APP e SITE_URL; mensagem usa o TERMO_EMAIL", () => comEnv({ ...SMTP, TERMO_EMAIL: "contato@exemplo.com" }, async () => {
  assert.equal(emailDisponivel(), true);
  for (const k of Object.keys(SMTP)) await comEnv({ [k]: "" }, () => assert.equal(emailDisponivel(), false, k));
  assert.equal(mensagemIndisponivel(), "A recuperação por email está indisponível. Escreva para contato@exemplo.com.");
  await comEnv({ TERMO_EMAIL: undefined }, () => assert.equal(mensagemIndisponivel(), "A recuperação por email está indisponível no momento."));
}));

test("enviarEmail: remetente FitWay <SMTP_USER>, texto e HTML, pelo transporte recebido", () => comEnv(SMTP, async () => {
  const enviados = [];
  await enviarEmail({ para: "ana@x.com", assunto: "Oi", texto: "t", html: "<p>h</p>" }, { transporte: { sendMail: async (m) => { enviados.push(m); return {}; } } });
  assert.deepEqual(enviados, [{ from: { name: "FitWay", address: SMTP.SMTP_USER }, to: { address: "ana@x.com" }, subject: "Oi", text: "t", html: "<p>h</p>" }]);
}));

test("enviarEmail: desiste em 10 s e falha sem transporte", () => comEnv(SMTP, async () => {
  const parado = { sendMail: () => new Promise(() => {}) };
  await assert.rejects(enviarEmail({ para: "a@x.com", assunto: "a", texto: "b" }, { transporte: parado, limite: 20 }), /tempo/);
  await assert.rejects(enviarEmail({ para: "a@x.com", assunto: "a", texto: "b" }, { transporte: null }), /indisponível/);
}));
