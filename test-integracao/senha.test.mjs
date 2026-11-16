import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { abrir } from "./harness.mjs";
process.env.ADMIN_EMAILS = "dono@x.com";
delete process.env.SMTP_USER; delete process.env.SMTP_SENHA_APP; // o servidor nunca tenta o Gmail de verdade
const { sql, chamar, R } = await abrir();
const { pedirLink } = await import(R + "api/_senha.js");
const sha = (t) => createHash("sha256").update(t).digest("hex");
const enviados = [];
const transporte = { sendMail: async (m) => { enviados.push(m); return {}; } };
// Pede o link com SMTP "ligado" só nesta chamada e devolve o token do email.
async function pedir(email, ip = "9.9.9.9") {
  Object.assign(process.env, { SMTP_USER: "fitway@exemplo.com", SMTP_SENHA_APP: "x", SITE_URL: "https://f.exemplo.com" });
  const n = enviados.length;
  try { await pedirLink(sql, { email, ip }, { transporte, esperar: async () => {} }); }
  finally { delete process.env.SMTP_USER; delete process.env.SMTP_SENHA_APP; }
  const m = enviados[n];
  return m ? /nova-senha\/([A-Za-z0-9_-]{43})/.exec(m.text)[1] : null;
}
const conta = async (email, senha = "velha12") => (await chamar({ acao: "criar", nome: "N", email, senha })).token;

test("token: só o hash no banco; troca entra na conta, apaga todas as sessões, grava o log; o link não vale de novo", async () => {
  const s1 = await conta("ana@x.com"), s2 = (await chamar({ acao: "entrar", email: "ana@x.com", senha: "velha12" })).token;
  const tok = await pedir("ana@x.com");
  assert.ok(tok);
  const [row] = await sql`select hash, expira - criado as dur, ip from senha_tokens where email = 'ana@x.com'`;
  assert.equal(row.hash, sha(tok)); assert.equal(row.ip, "9.9.9.9");
  assert.equal((await sql`select count(*)::int as n from senha_tokens where hash = ${tok}`)[0].n, 0);
  const r = await chamar({ acao: "senha_nova", token: tok, senha: "nova123" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo)); assert.equal(r.corpo.email, "ana@x.com"); assert.ok(r.token);
  for (const t of [s1, s2]) assert.equal((await chamar({ acao: "eu" }, t)).status, 401, "sessão antiga encerrada");
  assert.equal((await chamar({ acao: "eu" }, r.token)).status, 200, "entra direto no aparelho atual");
  assert.equal((await chamar({ acao: "entrar", email: "ana@x.com", senha: "velha12" })).status, 401);
  assert.equal((await chamar({ acao: "entrar", email: "ana@x.com", senha: "nova123" })).status, 200);
  const r2 = await chamar({ acao: "senha_nova", token: tok, senha: "outra123" });
  assert.equal(r2.status, 400); assert.equal(r2.corpo.erro, "Este link não vale mais. Peça um novo em Esqueci a senha.");
  const [l] = await sql`select admin_email, detalhes from admin_log where acao = 'senha_trocada' and alvo_email = 'ana@x.com'`;
  assert.deepEqual(l.detalhes, { via: "email" });
  assert.ok(!JSON.stringify(await sql`select * from admin_log`).includes(tok));
});

test("token vence em 30 min; pedido novo invalida o anterior", async () => {
  await conta("bia@x.com");
  const t1 = await pedir("bia@x.com", "8.8.8.1"), t2 = await pedir("bia@x.com", "8.8.8.2");
  assert.equal((await chamar({ acao: "senha_nova", token: t1, senha: "nova123" })).status, 400, "o anterior não vale");
  await sql`update senha_tokens set expira = now() - interval '1 second' where hash = ${sha(t2)}`;
  assert.equal((await chamar({ acao: "senha_nova", token: t2, senha: "nova123" })).status, 400, "vencido");
  const t3 = await pedir("bia@x.com", "8.8.8.3");
  const [d] = await sql`select extract(epoch from expira - criado)::int as s from senha_tokens where hash = ${sha(t3)}`;
  assert.equal(d.s, 1800);
  assert.equal((await chamar({ acao: "senha_nova", token: t3, senha: "123" })).status, 400, "senha fraca");
  assert.equal((await chamar({ acao: "senha_nova", token: t3, senha: "nova123" })).status, 200);
});

test("limites: 3 por email e 10 por IP por hora, contando email sem conta; registro sem o email", async () => {
  await conta("cid@x.com");
  const toks = [];
  for (let i = 0; i < 4; i++) toks.push(await pedir("cid@x.com", "7.7.7." + i));
  assert.deepEqual(toks.map(Boolean), [true, true, true, false]);
  for (let i = 0; i < 10; i++) await pedir("ninguem" + i + "@x.com", "6.6.6.6");
  await conta("dani@x.com");
  assert.equal(await pedir("dani@x.com", "6.6.6.6"), null, "IP estourado");
  assert.ok(await pedir("dani@x.com", "6.6.6.7"));
  assert.equal((await sql`select count(*)::int as n from senha_pedidos where email_hash like '%@%'`)[0].n, 0);
});

test("Perfil: troca com a atual, mantém só a sessão atual; erros limitados", async () => {
  const a = await conta("eva@x.com"), b = (await chamar({ acao: "entrar", email: "eva@x.com", senha: "velha12" })).token;
  let r = await chamar({ acao: "senha_alterar", atual: "errada", nova: "nova123" }, a);
  assert.equal(r.status, 400);
  r = await chamar({ acao: "senha_alterar", atual: "velha12", nova: "nova123" }, a);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal((await chamar({ acao: "eu" }, a)).status, 200);
  assert.equal((await chamar({ acao: "eu" }, b)).status, 401);
  for (let i = 0; i < 4; i++) await chamar({ acao: "senha_alterar", atual: "x" + i, nova: "nova456" }, a);
  r = await chamar({ acao: "senha_alterar", atual: "nova123", nova: "nova456" }, a);
  assert.equal(r.status, 429, "5 erros na hora bloqueiam até a certa");
});

test("sem SMTP: disponível = false com o email de contato", async () => {
  process.env.TERMO_EMAIL = "contato@exemplo.com";
  const r = await chamar({ acao: "senha_disponivel" });
  assert.deepEqual(r.corpo, { disponivel: false, mensagem: "A recuperação por email está indisponível. Escreva para contato@exemplo.com." });
  assert.equal((await chamar({ acao: "senha_pedir", email: "ana@x.com" })).corpo.indisponivel, true);
});

test("admin não recebe link; pedidos em paralelo não passam de 3 por email", async () => {
  await sql`insert into usuarios (email, nome, senha) values ('dono@x.com', 'Dono', 'x')`;
  assert.equal(await pedir("dono@x.com", "5.5.5.5"), null);
  await conta("par@x.com");
  Object.assign(process.env, { SMTP_USER: "f@exemplo.com", SMTP_SENHA_APP: "x", SITE_URL: "https://f.exemplo.com" });
  const n = enviados.length;
  try { await Promise.all(Array.from({ length: 8 }, (_, i) => pedirLink(sql, { email: "par@x.com", ip: "4.4.4." + i }, { transporte, esperar: async () => {} }))); }
  finally { delete process.env.SMTP_USER; delete process.env.SMTP_SENHA_APP; }
  assert.equal(enviados.length - n, 3);
});

test("senha_conta devolve o email do link válido sem gastar; token falso não roda scrypt nem troca", async () => {
  await conta("gil@x.com");
  const tok = await pedir("gil@x.com", "3.3.3.3");
  assert.deepEqual((await chamar({ acao: "senha_conta", token: tok })).corpo, { email: "gil@x.com" });
  assert.equal((await chamar({ acao: "senha_conta", token: "B".repeat(43) })).status, 400);
  assert.equal((await chamar({ acao: "senha_nova", token: tok, senha: "nova123" })).status, 200, "ver não gastou");
});
