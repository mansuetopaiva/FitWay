// Lacunas do esqueci/troca de senha, pelo servidor real (PGlite). Email "ligado" sem SMTP: o módulo api/_email.js é
// trocado por um que devolve um transporte falso; SMTP_USER/SMTP_SENHA_APP ficam fora do env e o nodemailer nunca envia.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { abrir } from "./harness.mjs";
delete process.env.SMTP_USER; delete process.env.SMTP_SENHA_APP;
process.env.SITE_URL = "https://f.exemplo.com"; process.env.ADMIN_EMAILS = "dono@x.com";
const R0 = fileURLToPath(new URL("../", import.meta.url)); // raiz do repositório
const real = await import(R0 + "api/_email.js?real");
const enviados = [];
const transporte = { sendMail: async (m) => { enviados.push(m); return {}; } };
mock.module(pathToFileURL(R0 + "api/_email.js").href, { exports: { ...real, emailDisponivel: () => true, transporteGmail: () => transporte } });
const { sql, chamar, R } = await abrir();
const { pedirLink, alterarSenha, MSG_PEDIDO } = await import(R + "api/_senha.js");
const sha = (t) => createHash("sha256").update(t).digest("hex");
const tokenDe = (m) => m && /nova-senha\/([A-Za-z0-9_-]{43})/.exec(m.text)[1];
const conta = async (email, senha = "velha12") => (await chamar({ acao: "criar", nome: "N", email, senha })).token;
// Pedido direto (sem o piso de 2,5 s) para os testes que só olham o banco.
async function pedir(email, ip) {
  const n = enviados.length;
  await pedirLink(sql, { email, ip }, { transporte, esperar: async () => {} });
  return tokenDe(enviados[n]);
}

test("servidor: com e sem conta, mesma resposta e o mesmo tempo (piso de 2,5 s); o IP é o primeiro do x-forwarded-for", async () => {
  await conta("ana@x.com");
  const medir = async (email, xff) => {
    const t = performance.now(), r = await chamar({ acao: "senha_pedir", email }, null, { "x-forwarded-for": xff });
    return { corpo: r.corpo, ms: performance.now() - t };
  };
  const n = enviados.length;
  const com = await medir("ana@x.com", "1.1.1.1, 10.0.0.9"), sem = await medir("ninguem@x.com", "2.2.2.2, 10.0.0.9");
  assert.deepEqual(com.corpo, { mensagem: MSG_PEDIDO }); assert.deepEqual(sem.corpo, com.corpo);
  assert.ok(com.ms >= 2400 && sem.ms >= 2400, `piso: ${com.ms} / ${sem.ms}`);
  assert.ok(Math.abs(com.ms - sem.ms) < 400, `tempos parecidos: ${com.ms} / ${sem.ms}`);
  assert.equal(enviados.length - n, 1, "só a conta que existe recebe");
  assert.deepEqual(enviados.at(-1).to, { address: "ana@x.com" });
  const ips = (await sql`select ip from senha_pedidos order by id desc limit 2`).map((x) => x.ip);
  assert.deepEqual(ips, ["2.2.2.2", "1.1.1.1"], "o cliente, não o proxy");
});

test("servidor: troca pelo link e no Perfil mandam o aviso para o dono da conta", async () => {
  await conta("avi@x.com");
  const tok = await pedir("avi@x.com", "3.1.1.1");
  let n = enviados.length;
  const r = await chamar({ acao: "senha_nova", token: tok, senha: "nova123" });
  assert.equal(r.status, 200);
  assert.deepEqual(enviados.slice(n).map((m) => [m.to, m.subject]), [[{ address: "avi@x.com" }, "Sua senha do FitWay foi trocada"]]);
  n = enviados.length;
  assert.equal((await chamar({ acao: "senha_alterar", atual: "nova123", nova: "outra12" }, r.token)).status, 200);
  assert.deepEqual(enviados.slice(n).map((m) => [m.to, m.subject]), [[{ address: "avi@x.com" }, "Sua senha do FitWay foi trocada"]]);
  assert.doesNotMatch(enviados.at(-1).text, /outra12|nova123/, "o aviso não leva a senha");
});

test("troca no Perfil vence o link pendente", async () => {
  const s = await conta("per@x.com");
  const tok = await pedir("per@x.com", "3.2.2.2");
  assert.equal((await chamar({ acao: "senha_alterar", atual: "velha12", nova: "nova123" }, s)).status, 200);
  assert.equal((await chamar({ acao: "senha_nova", token: tok, senha: "outra12" })).status, 400);
  assert.equal((await chamar({ acao: "entrar", email: "per@x.com", senha: "nova123" })).status, 200);
});

test("usar um link vence qualquer outro link ainda válido da conta", async () => {
  await conta("dup@x.com");
  const tok = await pedir("dup@x.com", "3.3.3.3"), outro = "C".repeat(43);
  await sql`insert into senha_tokens (email, hash, expira) values ('dup@x.com', ${sha(outro)}, now() + interval '30 minutes')`;
  assert.equal((await chamar({ acao: "senha_nova", token: tok, senha: "nova123" })).status, 200);
  assert.equal((await chamar({ acao: "senha_nova", token: outro, senha: "outra12" })).status, 400);
});

test("senha_conta não revela a conta de um link vencido ou usado", async () => {
  await conta("ven@x.com");
  const tok = await pedir("ven@x.com", "3.4.4.4");
  await sql`update senha_tokens set expira = now() - interval '1 second' where hash = ${sha(tok)}`;
  const r = await chamar({ acao: "senha_conta", token: tok });
  assert.equal(r.status, 400); assert.equal(r.corpo.email, undefined);
  const t2 = await pedir("ven@x.com", "3.4.4.5");
  assert.equal((await chamar({ acao: "senha_nova", token: t2, senha: "nova123" })).status, 200);
  assert.equal((await chamar({ acao: "senha_conta", token: t2 })).status, 400, "usado");
});

test("teto global: com 100 links na última hora, nenhum link novo sai (mesma resposta)", async () => {
  await conta("tet@x.com");
  await sql`insert into senha_tokens (email, hash, expira) select 'tet@x.com', 'falso' || g, now() from generate_series(1, 100) g`;
  try {
    const n = enviados.length;
    assert.deepEqual(await pedirLink(sql, { email: "tet@x.com", ip: "3.5.5.5" }, { transporte, esperar: async () => {} }), { mensagem: MSG_PEDIDO });
    assert.equal(enviados.length, n);
  } finally { await sql`delete from senha_tokens where hash like 'falso%'`; }
  assert.ok(await pedir("tet@x.com", "3.5.5.6"), "abaixo do teto volta a sair");
});

test("Perfil: se a senha mudou no meio da troca, recusa com 400 e não grava log de troca", async () => {
  const chamadas = [];
  const { senhaHash } = await import(R + "api/_senha.js");
  const guardada = senhaHash("velha12");
  const falso = async (p, ...v) => { const q = p.join("?"); chamadas.push(q); return q.startsWith("select senha") ? [{ senha: guardada, erros: 0 }] : []; };
  const r = await alterarSenha(falso, { email: "a@x.com" }, { atual: "velha12", nova: "nova123" }, "h");
  assert.deepEqual(r, { status: 400, erro: "A senha mudou enquanto você trocava. Tente de novo." });
});

test("entrar: email sem conta leva o mesmo tempo que senha errada (confere contra um hash)", async () => {
  await conta("tmp@x.com");
  const med = async (email) => {
    const v = [];
    for (let i = 0; i < 7; i++) { const t = performance.now(); assert.equal((await chamar({ acao: "entrar", email, senha: "errada1" })).status, 401); v.push(performance.now() - t); }
    return v.sort((a, b) => a - b)[3];
  };
  const com = await med("tmp@x.com"), sem = await med("nao" + "existe@x.com");
  assert.ok(sem > com * 0.6, `mediana sem conta ${sem.toFixed(1)} ms vs com conta ${com.toFixed(1)} ms`);
});
