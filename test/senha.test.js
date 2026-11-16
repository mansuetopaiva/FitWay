// Esqueci a senha e troca de senha (api/_senha.js, docs/senha.md). Banco simulado e transporte falso.
// A semântica do SQL (30 min, uso único, sessões apagadas, limites reais) roda no PGlite, fora do repositório.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MSG_PEDIDO, MSG_LINK, alterarSenha, confere, pedirLink, senhaHash, trocarPorToken } from "../api/_senha.js";

Object.assign(process.env, { SMTP_USER: "fitway@exemplo.com", SMTP_SENHA_APP: "x", SITE_URL: "https://fitway.exemplo.com", TERMO_EMAIL: "contato@exemplo.com" });
const sha = (t) => createHash("sha256").update(t).digest("hex");
function sqlFalso(responder = () => []) {
  const chamadas = [];
  const sql = async (partes, ...valores) => { const q = partes.join("?"); chamadas.push({ q, valores }); return responder(q, valores); };
  return { sql, chamadas };
}
const falso = () => { const enviados = []; return { enviados, transporte: { sendMail: async (m) => { enviados.push(m); return {}; } } }; };
const relogio = () => { const r = { esperas: [], esperar: async (ms) => { r.esperas.push(ms); } }; return r; };
// Banco: limites folgados; a conta existe se o email for ana@x.com.
const banco = (limites = { por_email: 0, por_ip: 0 }) => (q, v) => {
  if (q.includes("insert into senha_pedidos")) return [limites];
  if (q.includes("insert into senha_tokens")) return v.includes("ana@x.com") ? [{ nome: "Ana <b>" }] : [];
  return [];
};

test("pedir: mesma resposta, mesmas instruções e mesmo piso de tempo com e sem conta", async () => {
  const res = [];
  for (const email of ["ana@x.com", "ninguem@x.com"]) {
    const s = sqlFalso(banco()), t = falso(), r = relogio();
    const out = await pedirLink(s.sql, { email, ip: "1.2.3.4" }, { transporte: t.transporte, esperar: r.esperar, piso: 2500 });
    res.push({ out, n: s.chamadas.length, esperas: r.esperas.length, enviados: t.enviados.length, qs: s.chamadas.map((c) => c.q) });
  }
  assert.deepEqual(res[0].out, { mensagem: MSG_PEDIDO }); assert.deepEqual(res[1].out, res[0].out);
  assert.equal(MSG_PEDIDO, "Se houver uma conta com esse email, enviamos um link para trocar a senha. Ele vale por 30 minutos. Confira também o spam.");
  assert.deepEqual(res[0].qs, res[1].qs, "sem atalho: as mesmas instruções no banco");
  assert.equal(res[0].esperas, 1); assert.equal(res[1].esperas, 1, "o piso vale também sem conta");
  assert.equal(res[0].enviados, 1); assert.equal(res[1].enviados, 0);
});

test("pedir: o piso desconta o tempo já gasto e nunca é negativo", async () => {
  let t = 0;
  const r = relogio();
  await pedirLink(sqlFalso(banco()).sql, { email: "ninguem@x.com", ip: "" }, { transporte: falso().transporte, esperar: r.esperar, piso: 2500, agora: () => (t += 1000) });
  assert.equal(r.esperas[0], 1500);
  const r2 = relogio(); t = 0;
  await pedirLink(sqlFalso(banco()).sql, { email: "ninguem@x.com", ip: "" }, { transporte: falso().transporte, esperar: r2.esperar, piso: 500, agora: () => (t += 1000) });
  assert.equal(r2.esperas[0], 0);
});

test("pedir: só o hash do token vai ao banco; o link leva o token depois do #; o email não tem HTML injetável", async () => {
  const s = sqlFalso(banco()), t = falso();
  await pedirLink(s.sql, { email: " Ana@X.com ", ip: "1.2.3.4" }, { transporte: t.transporte, esperar: async () => {} });
  const m = t.enviados[0];
  assert.equal(m.to, "ana@x.com"); assert.equal(m.subject, "Trocar sua senha do FitWay");
  const token = /\/#\/nova-senha\/([A-Za-z0-9_-]{43})(\s|$)/.exec(m.text)[1];
  assert.ok(m.text.startsWith("Olá, Ana <b>. Recebemos um pedido para trocar a senha da sua conta no FitWay."));
  assert.match(m.text, /Ele vale por 30 minutos e só pode ser usado uma vez\./);
  assert.match(m.text, /Se você não pediu isso, ignore este email: sua senha continua a mesma\./);
  assert.ok(m.text.includes("https://fitway.exemplo.com/#/nova-senha/" + token));
  assert.match(m.html, /Ana &lt;b&gt;/); assert.doesNotMatch(m.html, /<img|<script|src=/i);
  const ins = s.chamadas.find((c) => c.q.includes("insert into senha_tokens"));
  assert.ok(ins.valores.includes(sha(token)), "grava o hash");
  for (const c of s.chamadas) assert.ok(!c.valores.some((v) => String(v).includes(token)), "o token nunca vai ao banco");
  assert.match(ins.q, /update senha_tokens set expira = least\(expira, now\(\)\) where email = \? and usado_em is null/, "pedido novo invalida os anteriores");
  assert.match(ins.q, /interval '30 minutes'/);
  const ped = s.chamadas.find((c) => c.q.includes("insert into senha_pedidos"));
  assert.ok(ped.valores.includes(sha("ana@x.com")) && !ped.valores.includes("ana@x.com"), "o registro dos limites guarda o hash do email");
});

test("pedir: limite por email (3/h) e por IP (10/h): mesma mensagem, sem token nem envio", async () => {
  for (const lim of [{ por_email: 3, por_ip: 0 }, { por_email: 0, por_ip: 10 }]) {
    const s = sqlFalso(banco(lim)), t = falso(), r = relogio();
    const out = await pedirLink(s.sql, { email: "ana@x.com", ip: "1.2.3.4" }, { transporte: t.transporte, esperar: r.esperar });
    assert.deepEqual(out, { mensagem: MSG_PEDIDO });
    assert.equal(t.enviados.length, 0); assert.ok(!s.chamadas.some((c) => c.q.includes("insert into senha_tokens")));
    assert.equal(r.esperas.length, 1, "o piso vale também no limite");
  }
  const s = sqlFalso(banco({ por_email: 2, por_ip: 9 })), t = falso();
  await pedirLink(s.sql, { email: "ana@x.com", ip: "1.2.3.4" }, { transporte: t.transporte, esperar: async () => {} });
  assert.equal(t.enviados.length, 1, "abaixo do limite envia");
});

test("pedir: email inválido dá a mesma mensagem (conta no limite do IP, sem token); envio que falha não muda a resposta", async () => {
  const s = sqlFalso(banco()), r = relogio();
  assert.deepEqual(await pedirLink(s.sql, { email: "x", ip: "1.2.3.4" }, { transporte: falso().transporte, esperar: r.esperar }), { mensagem: MSG_PEDIDO });
  assert.ok(s.chamadas.some((c) => c.q.includes("insert into senha_pedidos")));
  assert.ok(!s.chamadas.some((c) => c.q.includes("insert into senha_tokens")));
  const quebrado = { sendMail: async () => { throw new Error("smtp fora"); } };
  const erro = console.error; console.error = () => {};
  try { assert.deepEqual(await pedirLink(sqlFalso(banco()).sql, { email: "ana@x.com", ip: "" }, { transporte: quebrado, esperar: async () => {} }), { mensagem: MSG_PEDIDO }); }
  finally { console.error = erro; }
});

test("pedir sem SMTP: o aviso com o email de contato, sem tocar no banco", async () => {
  const antes = process.env.SMTP_SENHA_APP;
  try {
    delete process.env.SMTP_SENHA_APP;
    const s = sqlFalso();
    const out = await pedirLink(s.sql, { email: "ana@x.com", ip: "" }, { transporte: null, esperar: async () => {} });
    assert.deepEqual(out, { indisponivel: true, mensagem: "A recuperação por email está indisponível. Escreva para contato@exemplo.com." });
    assert.equal(s.chamadas.length, 0);
  } finally { process.env.SMTP_SENHA_APP = antes; }
});

test("trocar por token: formato e senha fraca recusados sem banco; numa instrução, uso único, apaga as sessões e grava o log", async () => {
  const tok = "A".repeat(43);
  for (const [b, msg] of [[{ token: "curto", senha: "123456" }, MSG_LINK], [{ token: tok + "=", senha: "123456" }, MSG_LINK], [{ token: 5, senha: "123456" }, MSG_LINK],
    [{ token: tok, senha: "12345" }, /6 caracteres/], [{ token: tok, senha: "x".repeat(101) }, /6 caracteres/], [{ token: tok }, /6 caracteres/]]) {
    const s = sqlFalso();
    const r = await trocarPorToken(s.sql, b);
    assert.equal(r.status, 400, JSON.stringify(b)); assert.match(r.erro, msg instanceof RegExp ? msg : new RegExp(msg.replace(/\./g, "\\.")));
    assert.equal(s.chamadas.length, 0);
  }
  let s = sqlFalso(() => []);
  let r = await trocarPorToken(s.sql, { token: tok, senha: "nova123" });
  assert.equal(r.status, 400); assert.equal(r.erro, MSG_LINK);
  assert.equal(MSG_LINK, "Este link não vale mais. Peça um novo em Esqueci a senha.");
  s = sqlFalso(() => [{ email: "ana@x.com", nome: "Ana" }]);
  r = await trocarPorToken(s.sql, { token: tok, senha: "nova123" });
  assert.equal(r.usuario.email, "ana@x.com");
  assert.equal(s.chamadas.length, 1);
  const { q, valores } = s.chamadas[0];
  assert.match(q, /update senha_tokens set usado_em = now\(\) where hash = \? and usado_em is null and expira > now\(\)/);
  assert.match(q, /delete from sessoes where email = \(select email from t\)/, "todas as sessões");
  assert.match(q, /hash <> \?/, "vence os outros tokens");
  assert.match(q, /'senha_trocada'.*'\{"via":"email"\}'/s);
  assert.ok(valores.includes(sha(tok)) && !valores.includes(tok));
  const nova = valores.find((v) => typeof v === "string" && v.includes(":") && v.length > 90);
  assert.ok(confere("nova123", nova), "o mesmo scrypt do cadastro");
});

test("alterar (Perfil): confere a atual, limite de erros, mantém só a sessão atual", async () => {
  const u = { email: "ana@x.com" }, guardada = senhaHash("velha12");
  let s = sqlFalso();
  assert.equal((await alterarSenha(s.sql, u, { atual: "velha12", nova: "123" }, "h")).status, 400);
  assert.equal(s.chamadas.length, 0);
  s = sqlFalso((q) => (q.startsWith("select senha") ? [{ senha: guardada, erros: 5 }] : []));
  assert.equal((await alterarSenha(s.sql, u, { atual: "velha12", nova: "nova123" }, "h")).status, 429);
  s = sqlFalso((q) => (q.startsWith("select senha") ? [{ senha: guardada, erros: 0 }] : []));
  let r = await alterarSenha(s.sql, u, { atual: "errada", nova: "nova123" }, "h");
  assert.equal(r.status, 400); assert.match(r.erro, /atual/);
  assert.ok(s.chamadas.some((c) => /'senha_errada'/.test(c.q)));
  s = sqlFalso((q) => (q.startsWith("select senha") ? [{ senha: guardada, erros: 0 }] : [{ email: "ana@x.com" }]));
  r = await alterarSenha(s.sql, u, { atual: "velha12", nova: "nova123" }, "hashDaSessao");
  assert.equal(r.status, 200);
  const up = s.chamadas.find((c) => c.q.includes("update usuarios set senha"));
  assert.match(up.q, /delete from sessoes where email = \? and token <> \?/);
  assert.ok(up.valores.includes("hashDaSessao"));
  assert.match(up.q, /and senha = \?/, "só troca se a senha não mudou no meio");
  assert.match(up.q, /'senha_trocada'.*'\{"via":"perfil"\}'/s);
});
