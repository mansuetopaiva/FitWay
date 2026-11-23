// Segundo fator do admin no servidor (api/_2fa.js, docs/admin-2fa.md): ativação guiada no 1º login, desafio de uso único, código só
// uma vez por janela, bloqueios, códigos de recuperação, cifra e troca de chave. SQL real (PGlite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { abrir, TOTP_TESTE, HASH_TESTE } from "./harness.mjs";
import { codigo, passoDe, desbase32, decifrar, cifrar, novoSegredo } from "../api/_totp.js";
import { senhaHash } from "../api/_senha.js";
process.env.ADMIN_EMAILS = "dono@x.com";
const { sql, chamar } = await abrir();
const ip = (n) => ({ "x-real-ip": n });
const sha = (t) => createHash("sha256").update(t).digest("hex");
await sql`insert into usuarios (email, nome, senha) values ('dono@x.com', 'Dono', ${senhaHash("certa123")})`;
await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "certa123" }, null, ip("9.9.9.9"));
const senha = (e = "dono@x.com", s = "certa123", i = "10.0.0.1") => chamar({ acao: "entrar", email: e, senha: s }, null, ip(i));
const dois = (desafio, cod, i = "10.0.0.1") => chamar({ acao: "entrar_2fa", desafio, codigo: cod }, null, ip(i));
const segredo = async () => { const [l] = await sql`select segredo_cifrado from admin_2fa where email = 'dono@x.com'`; return decifrar(l.segredo_cifrado).segredo; };
const certo = async (d = 0) => codigo(await segredo(), passoDe(Date.now()) + d);
const zerarTudo = async () => { await sql`update admin_2fa set ultimo_passo = 0`; await sql`delete from login_tentativas`; };
const sessoes = async () => (await sql`select count(*)::int as n from sessoes where email = 'dono@x.com'`)[0].n;
let recuperacao;

test("sem TOTP_CHAVE: senha certa de admin falha com mensagem clara, sem sessão; senha errada segue a resposta genérica", async () => {
  const k = process.env.TOTP_CHAVE; delete process.env.TOTP_CHAVE;
  try {
    const r = await senha();
    assert.equal(r.status, 503); assert.match(r.corpo.erro, /TOTP_CHAVE/); assert.equal(r.token, undefined);
    assert.equal(await sessoes(), 0);
    const e = await senha("dono@x.com", "errada1", "10.0.0.2");
    assert.equal(e.status, 401); assert.doesNotMatch(e.corpo.erro, /TOTP/);
  } finally { process.env.TOTP_CHAVE = k; }
  assert.equal((await sql`select count(*)::int as n from admin_2fa`)[0].n, 0, "nada foi criado");
  await zerarTudo();
});

test("1º login: a senha certa abre só a ativação (sem sessão); só o 1º código válido cria a sessão e mostra 10 códigos de recuperação", async () => {
  const r = await senha();
  assert.equal(r.status, 200); assert.equal(r.corpo.precisa2fa, true); assert.equal(r.corpo.etapa, "ativar");
  assert.equal(r.token, undefined, "sem cookie"); assert.equal(await sessoes(), 0);
  assert.match(r.corpo.desafio, /^[0-9a-f]{64}$/);
  assert.match(r.corpo.chave, /^([A-Z2-7]{4} ){3}[A-Z2-7]{4}( [A-Z2-7]{4})*$/);
  assert.match(r.corpo.otpauth, /^otpauth:\/\/totp\/FitWay%3Adono%40x\.com\?secret=[A-Z2-7]+&issuer=FitWay/);
  assert.equal(r.corpo.email, undefined); assert.equal(r.corpo.nome, undefined, "nada da conta antes do código");
  const seg = desbase32(r.corpo.chave);
  const [l] = await sql`select * from admin_2fa where email = 'dono@x.com'`;
  assert.equal(l.ativado_em, null, "pendente"); assert.ok(!l.segredo_cifrado.includes(r.corpo.chave.replace(/ /g, "")), "segredo não está em claro");
  assert.deepEqual(decifrar(l.segredo_cifrado).segredo, seg);
  assert.equal((await sql`select hash from login_desafios`)[0].hash, sha(r.corpo.desafio), "só o hash do desafio");
  const ruim = await dois(r.corpo.desafio, "000000");
  assert.equal(ruim.status, 401); assert.equal(await sessoes(), 0);
  const ok = await dois(r.corpo.desafio, codigo(seg, passoDe(Date.now())));
  assert.equal(ok.status, 200); assert.ok(ok.token); assert.equal(ok.corpo.admin, true); assert.equal(ok.corpo.email, "dono@x.com");
  recuperacao = ok.corpo.recuperacao;
  assert.equal(recuperacao.length, 10); for (const c of recuperacao) assert.match(c, /^[A-Z2-7]{10}$/);
  assert.equal((await chamar({ acao: "eu" }, ok.token)).corpo.admin, true, "a sessão funciona");
  assert.notEqual((await sql`select ativado_em from admin_2fa`)[0].ativado_em, null);
  const hs = (await sql`select hash from admin_recuperacao where email = 'dono@x.com'`).map((x) => x.hash);
  assert.equal(hs.length, 10); for (const c of recuperacao) assert.ok(!hs.includes(c), "guardado como HMAC, não em claro");
  assert.equal((await sql`select acao from admin_log where acao = '2fa_ativado'`).length, 1);
});

test("2º login: senha certa ainda não abre sessão; pede o código (sem repetir a chave); o mesmo código não vale duas vezes na janela", async () => {
  await zerarTudo();
  const r = await senha();
  assert.equal(r.corpo.etapa, "codigo"); assert.equal(r.corpo.chave, undefined); assert.equal(r.corpo.otpauth, undefined);
  assert.equal(r.token, undefined); assert.equal(await sessoes(), 1, "só a da ativação");
  const c = await certo();
  const ok = await dois(r.corpo.desafio, c);
  assert.equal(ok.status, 200); assert.ok(ok.token); assert.equal(ok.corpo.recuperacao, undefined, "códigos só na ativação");
  const outro = (await senha("dono@x.com", "certa123", "10.0.0.3")).corpo.desafio;
  const re = await dois(outro, c, "10.0.0.3");
  assert.equal(re.status, 401, "mesmo código na mesma janela"); assert.equal(re.token, undefined);
  const ok2 = await dois(outro, await certo(1), "10.0.0.3"); // próximo código (dentro da tolerância)
  assert.equal(ok2.status, 200, "o passo seguinte vale");
});

test("reuso em paralelo: o mesmo código em 2 desafios ao mesmo tempo entra uma vez só", async () => {
  await zerarTudo();
  const ds = []; for (let i = 0; i < 2; i++) ds.push((await senha("dono@x.com", "certa123", "10.0.1." + i)).corpo.desafio);
  const c = await certo();
  const rs = await Promise.all(ds.map((d, i) => dois(d, c, "10.0.1." + i)));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 401]);
});

test("desafio: uso único, expira, 5 tentativas, lixo não conta contra a conta", async () => {
  await zerarTudo();
  const d = (await senha()).corpo.desafio;
  assert.equal((await dois(d, await certo())).status, 200);
  await zerarTudo();
  const u = await dois(d, await certo());
  assert.equal(u.status, 401); assert.equal(u.corpo.recomecar, true, "desafio já usado");
  const e = (await senha()).corpo.desafio;
  await sql`update login_desafios set expira = now() - interval '1 second' where hash = ${sha(e)}`;
  assert.equal((await dois(e, await certo())).corpo.recomecar, true, "expirado");
  const f = (await senha()).corpo.desafio;
  for (let i = 0; i < 5; i++) await dois(f, "000000");
  const g = await dois(f, await certo());
  assert.equal(g.status, 401); assert.equal(g.corpo.recomecar, true, "5 tentativas gastas: nem o código certo vale");
  await zerarTudo();
  for (let i = 0; i < 20; i++) await dois("f".repeat(64), "000000");
  assert.equal((await sql`select count(*)::int as n from login_tentativas where chave like 'a:%'`)[0].n, 0, "desafio inventado não bloqueia a conta");
  assert.equal((await dois("lixo", "000000")).status, 401);
  assert.equal((await dois(undefined, undefined)).status, 401);
});

test("código errado: 5 erros bloqueiam a conta por 15 min (resposta genérica; o certo também é recusado); acertar depois do bloqueio zera", async () => {
  await zerarTudo();
  const r = [];
  for (let i = 0; i < 5; i++) { const d = (await senha("dono@x.com", "certa123", "10.2.0." + i)).corpo.desafio; r.push(await dois(d, "000000", "10.2.0." + i)); }
  assert.deepEqual(r.map((x) => x.status), [401, 401, 401, 401, 401]);
  const d = (await senha("dono@x.com", "certa123", "10.2.1.1")).corpo.desafio;
  const b = await dois(d, await certo(), "10.2.1.1");
  assert.equal(b.status, 401); assert.equal(b.token, undefined); assert.equal(b.corpo.erro, r[0].corpo.erro, "mesma resposta do código errado");
  const [t] = await sql`select (extract(epoch from (bloqueado_ate - now())) / 60)::float as m from login_tentativas where chave like 'a:%'`;
  assert.ok(Math.abs(t.m - 15) < 0.3, "15 min: " + t.m);
  await sql`update login_tentativas set bloqueado_ate = now() - interval '1 second' where chave like 'a:%'`;
  assert.equal((await dois(d, await certo(), "10.2.1.1")).status, 200, "passado o bloqueio, entra");
  assert.equal((await sql`select count(*)::int as n from login_tentativas where chave like 'a:%'`)[0].n, 0, "login completo zera o contador do código");
});

test("rajada de 60 códigos errados em paralelo conta só 5", async () => {
  await zerarTudo();
  const ds = []; for (let i = 0; i < 12; i++) ds.push((await senha("dono@x.com", "certa123", "10.3." + i + ".1")).corpo.desafio);
  const rs = await Promise.all(Array.from({ length: 60 }, (_, i) => dois(ds[i % 12], String(100000 + i), "10.3." + (i % 12) + ".1")));
  assert.ok(rs.every((x) => x.status === 401));
  assert.equal((await sql`select falhas from login_tentativas where chave like 'a:%'`)[0].falhas, 5);
});

test("senha errada de admin: por conta+IP e por IP; não tranca a conta inteira (outro IP entra); teto de 50 por conta vindo de IPs diferentes", async () => {
  await zerarTudo();
  for (let i = 0; i < 12; i++) assert.equal((await senha("dono@x.com", "errada1", "10.4.0.1")).status, 401);
  assert.equal((await senha("dono@x.com", "certa123", "10.4.0.1")).status, 401, "esse IP está bloqueado");
  const outro = await senha("dono@x.com", "certa123", "10.4.0.2");
  assert.equal(outro.status, 200, "um terceiro não tranca o admin: outro IP entra"); assert.equal(outro.corpo.precisa2fa, true);
  await zerarTudo();
  for (let i = 0; i < 50; i++) assert.equal((await senha("dono@x.com", "errada1", "10.5." + (i >> 4) + "." + (i & 15))).status, 401);
  const teto = await senha("dono@x.com", "certa123", "10.6.0.1");
  assert.equal(teto.status, 401, "50 erros por conta, vindos de IPs diferentes: bloqueio");
  assert.equal(teto.corpo.erro, (await senha("dono@x.com", "errada1", "10.6.0.2")).corpo.erro, "mesma resposta genérica");
  const [t] = await sql`select (extract(epoch from (bloqueado_ate - now())) / 60)::float as m from login_tentativas where chave like 't:%'`;
  assert.ok(Math.abs(t.m - 15) < 0.3, "15 min: " + t.m);
  await sql`update login_tentativas set bloqueado_ate = now() - interval '1 second'`;
  assert.equal((await senha("dono@x.com", "certa123", "10.6.0.3")).status, 200);
});

test("código de recuperação: vale uma vez, entra sem o autenticador, é registrado e avisa quantos restam", async () => {
  await zerarTudo();
  const [c1, c2] = recuperacao;
  const d1 = (await senha()).corpo.desafio;
  const ok = await dois(d1, c1.toLowerCase().replace(/(.{5})/, "$1 ")); // minúsculas e espaço: normaliza
  assert.equal(ok.status, 200); assert.ok(ok.token); assert.equal(ok.corpo.restantes, 9);
  assert.equal((await sql`select count(*)::int as n from admin_log where acao = '2fa_recuperacao_usada'`)[0].n, 1);
  const d2 = (await senha("dono@x.com", "certa123", "10.7.0.2")).corpo.desafio;
  const de_novo = await dois(d2, c1, "10.7.0.2");
  assert.equal(de_novo.status, 401, "uso único"); assert.equal(de_novo.token, undefined);
  assert.equal((await dois(d2, c2, "10.7.0.2")).status, 200, "outro código vale");
});

test("novos códigos: exigem senha atual + código; os antigos deixam de valer; erro conta no bloqueio do código", async () => {
  await zerarTudo();
  const tk = (await entrarAdminLocal()).token;
  const pedir = (b) => chamar({ acao: "admin_2fa_codigos", ...b }, tk);
  assert.equal((await pedir({ senha: "errada1", codigo: await certo() })).status, 401);
  assert.equal((await pedir({ senha: "certa123", codigo: "000000" })).status, 401);
  assert.equal((await chamar({ acao: "admin_2fa_codigos", senha: "certa123", codigo: await certo() })).status, 401, "sem sessão");
  assert.equal((await sql`select falhas from login_tentativas where chave like 'a:%'`)[0].falhas, 2);
  const velhos = (await sql`select hash from admin_recuperacao`).map((x) => x.hash);
  await sql`update admin_2fa set ultimo_passo = 0`;
  const n = await pedir({ senha: "certa123", codigo: await certo() });
  assert.equal(n.status, 200); assert.equal(n.corpo.recuperacao.length, 10);
  const novos = (await sql`select hash from admin_recuperacao`).map((x) => x.hash);
  assert.equal(novos.length, 10); assert.ok(!novos.some((h) => velhos.includes(h)));
  const d = (await senha("dono@x.com", "certa123", "10.8.0.1")).corpo.desafio;
  assert.equal((await dois(d, recuperacao[5], "10.8.0.1")).status, 401, "código antigo não vale mais");
  assert.equal((await chamar({ acao: "admin_2fa_estado" }, tk)).corpo.restantes, 10);
});
const entrarAdminLocal = async () => { await sql`update admin_2fa set ultimo_passo = 0`; const d = (await senha("dono@x.com", "certa123", "10.9.0." + Math.floor(Math.random() * 200))).corpo.desafio; return dois(d, await certo(), "10.9.0.250"); };

test("cifra e troca de chave: com a chave anterior o login funciona e o segredo é regravado com a nova; sem ela, falha com mensagem clara", async () => {
  await zerarTudo();
  const velha = process.env.TOTP_CHAVE, nova = "outra-chave-totp-com-mais-de-32-caracteres!!";
  process.env.TOTP_CHAVE = nova; process.env.TOTP_CHAVE_ANTERIOR = velha;
  try {
    const seg = await segredo();
    const r = await senha();
    assert.equal(r.corpo.etapa, "codigo");
    const [l] = await sql`select segredo_cifrado from admin_2fa`;
    assert.ok(decifrar(l.segredo_cifrado, { TOTP_CHAVE: nova }), "regravado com a chave nova");
    assert.equal(decifrar(l.segredo_cifrado, { TOTP_CHAVE: velha }), null);
    assert.equal((await dois(r.corpo.desafio, codigo(seg, passoDe(Date.now())))).status, 200);
    delete process.env.TOTP_CHAVE_ANTERIOR; process.env.TOTP_CHAVE = velha; // perdeu a nova sem a anterior
    await zerarTudo();
    const f = await senha();
    assert.equal(f.status, 503); assert.match(f.corpo.erro, /TOTP_CHAVE/); assert.equal(f.token, undefined);
  } finally { process.env.TOTP_CHAVE = velha; delete process.env.TOTP_CHAVE_ANTERIOR; }
  await sql`update admin_2fa set segredo_cifrado = ${cifrar(novoSegredo())}`; // segredo ilegível por outro motivo: mesmo resultado
  assert.equal((await senha()).status, 200);
});

test("sessão de admin aberta antes do 2FA (sem segundo fator ativado) deixa de valer", async () => {
  await sql`insert into usuarios (email, nome, senha) values ('novo@x.com', 'Novo', 'x')`;
  process.env.ADMIN_EMAILS = "dono@x.com,novo@x.com";
  try {
    await sql`insert into sessoes (token, email, expira) values (${sha("a".repeat(64))}, 'novo@x.com', now() + interval '1 day')`;
    assert.equal((await chamar({ acao: "eu" }, "a".repeat(64))).status, 401);
    assert.equal((await chamar({ acao: "admin", op: "resumo" }, "a".repeat(64))).status, 401);
  } finally { process.env.ADMIN_EMAILS = "dono@x.com"; }
});

test("o log não guarda segredo, código nem IP; aluno entra como sempre, sem segundo fator", async () => {
  const linhas = JSON.stringify(await sql`select * from admin_log where acao like '2fa_%'`);
  assert.ok(linhas.includes("2fa_ativado") && linhas.includes("2fa_falha_codigo"));
  assert.doesNotMatch(linhas, /10\.\d+\.\d+\.\d+/);
  for (const c of recuperacao) assert.ok(!linhas.includes(c));
  const a = await senha("ana@x.com", "certa123", "10.10.0.1");
  assert.equal(a.status, 200); assert.ok(a.token); assert.equal(a.corpo.precisa2fa, undefined);
});
