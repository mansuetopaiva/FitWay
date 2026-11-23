// Limite de tentativas no login (estado no banco, PGlite): por conta e por IP, espera crescente, admin com bloqueio de 15 min,
// mesma resposta para senha errada, conta inexistente e bloqueio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
process.env.ADMIN_EMAILS = "dono@x.com";
const { sql, chamar } = await abrir();
const ip = (n) => ({ "x-real-ip": n });
const entrar = (email, senha, i = "10.0.0.1") => chamar({ acao: "entrar", email, senha }, null, ip(i));
const minutosDeBloqueio = async (email) => {
  const [r] = await sql`select (extract(epoch from (max(bloqueado_ate) - now())) / 60)::float as m from login_tentativas where chave like 'c:%' and bloqueado_ate > now()`;
  return r.m;
};
const limpar = () => sql`delete from login_tentativas`;
await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "certa123" }, null, ip("9.9.9.9"));
await chamar({ acao: "criar", nome: "Bia", email: "bia@x.com", senha: "certa123" }, null, ip("9.9.9.9"));
await sql`insert into usuarios (email, nome, senha) select 'dono@x.com', 'Dono', senha from usuarios where email = 'ana@x.com'`; // mesma senha "certa123"

test("por conta: 5 erros bloqueiam; com a senha certa continua recusado; passado o bloqueio, entra", async () => {
  await limpar();
  for (let i = 0; i < 5; i++) assert.equal((await entrar("ana@x.com", "errada1", "10.0.1." + i)).status, 401); // IPs diferentes: só a conta conta
  assert.equal((await entrar("ana@x.com", "certa123", "10.0.2.1")).status, 401, "bloqueada, mesmo com a senha certa");
  await sql`update login_tentativas set bloqueado_ate = now() - interval '1 second'`; // o bloqueio venceu
  const r = await entrar("ana@x.com", "certa123", "10.0.2.2");
  assert.equal(r.status, 200); assert.ok(r.token);
});

test("espera crescente por conta (1, 5 e 15 minutos, no máximo 15); o bloqueio não conta tentativas feitas durante ele", async () => {
  await limpar();
  let n = 0;
  const errar = async (vezes) => { for (let i = 0; i < vezes; i++) { await sql`update login_tentativas set bloqueado_ate = null`; await entrar("ana@x.com", "errada1", "10.1." + (n >> 8) + "." + (n++ & 255)); } };
  await errar(5); assert.ok(Math.abs(await minutosDeBloqueio() - 1) < 0.2, "5 erros: 1 min");
  await errar(3); assert.ok(Math.abs(await minutosDeBloqueio() - 5) < 0.2, "8 erros: 5 min");
  await errar(2); assert.ok(Math.abs(await minutosDeBloqueio() - 15) < 0.2, "10 erros: 15 min");
  await errar(5); assert.ok(Math.abs(await minutosDeBloqueio() - 15) < 0.2, "nunca passa de 15 min para aluno");
  const antes = (await sql`select falhas from login_tentativas where chave like 'c:%'`)[0].falhas;
  await entrar("ana@x.com", "errada1", "10.1.9.9"); // durante o bloqueio
  assert.equal((await sql`select falhas from login_tentativas where chave like 'c:%'`)[0].falhas, antes, "tentativa durante o bloqueio não prolonga");
});

test("por IP: 20 erros em contas diferentes bloqueiam o IP (até quem acerta); outro IP entra", async () => {
  await limpar();
  for (let i = 0; i < 20; i++) assert.equal((await entrar(`x${i}@x.com`, "errada1", "10.2.0.1")).status, 401);
  assert.equal((await entrar("bia@x.com", "certa123", "10.2.0.1")).status, 401, "o IP está bloqueado");
  assert.equal((await entrar("bia@x.com", "certa123", "10.2.0.2")).status, 200, "outro IP entra");
});

test("acertar zera o contador da conta", async () => {
  await limpar();
  for (let i = 0; i < 4; i++) await entrar("bia@x.com", "errada1", "10.3.0." + i);
  assert.equal((await entrar("bia@x.com", "certa123", "10.3.1.1")).status, 200);
  assert.equal((await sql`select count(*)::int as n from login_tentativas where chave like 'c:%'`)[0].n, 0);
  for (let i = 0; i < 4; i++) await entrar("bia@x.com", "errada1", "10.3.2." + i); // 4 de novo: ainda não bloqueia
  assert.equal((await entrar("bia@x.com", "certa123", "10.3.3.1")).status, 200);
});

test("a resposta é idêntica para senha errada, conta inexistente e bloqueio", async () => {
  await limpar();
  const errada = await entrar("bia@x.com", "errada1", "10.4.0.1");
  const inexistente = await entrar("ninguem@x.com", "errada1", "10.4.0.2");
  for (let i = 0; i < 5; i++) await entrar("ana@x.com", "errada1", "10.4.1." + i);
  const bloqueada = await entrar("ana@x.com", "certa123", "10.4.2.1");
  const bloqueadaInexistente = await (async () => { for (let i = 0; i < 5; i++) await entrar("fantasma@x.com", "errada1", "10.4.3." + i); return entrar("fantasma@x.com", "errada1", "10.4.3.9"); })();
  for (const r of [inexistente, bloqueada, bloqueadaInexistente]) assert.deepEqual({ status: r.status, corpo: r.corpo }, { status: errada.status, corpo: errada.corpo });
  assert.equal(errada.status, 401); assert.equal(errada.token, undefined);
  assert.match(errada.corpo.erro, /15 minutos/);
});

test("conta de admin: senha errada de IPs diferentes não bloqueia a conta (o bloqueio de 15 min fica no código do 2º fator e no teto; test-integracao/admin_2fa.test.mjs)", async () => {
  await limpar();
  for (let i = 0; i < 5; i++) await entrar("dono@x.com", "errada1", "10.5.0." + i);
  assert.equal((await sql`select count(*)::int as n from login_tentativas where bloqueado_ate > now()`)[0].n, 0);
  assert.equal((await entrar("dono@x.com", "certa123", "10.5.1.1")).corpo.precisa2fa, true, "a senha certa segue chegando ao 2º fator");
  await limpar();
  for (let i = 0; i < 5; i++) await entrar("ana@x.com", "errada1", "10.5.2." + i);
  assert.ok(Math.abs(await minutosDeBloqueio() - 1) < 0.2, "aluno: 1 min, como antes");
});

test("rajada em paralelo contra uma conta nova: só as 5 primeiras tentativas contam e chegam a conferir a senha; as outras são recusadas sem contar", async () => {
  await limpar();
  const rs = await Promise.all(Array.from({ length: 60 }, (_, i) => entrar("bia@x.com", "errada1", "10.9." + (i >> 8) + "." + (i & 255))));
  assert.ok(rs.every((r) => r.status === 401));
  const [c] = await sql`select falhas from login_tentativas where chave like 'c:%'`;
  assert.equal(c.falhas, 5, "o contador parou no limite em vez de contar as 60 (as outras 55 nem conferiram a senha)");
  assert.equal((await entrar("bia@x.com", "certa123", "10.9.9.9")).status, 401, "e a conta está bloqueada");
});

test("faixas do IP (30 erros: 5 min; 40: 15 min) e a janela de 1 hora zera a contagem; acertar não zera o IP", async () => {
  await limpar();
  const ipx = "10.8.0.1", minIp = async () => (await sql`select (extract(epoch from (bloqueado_ate - now())) / 60)::float as m from login_tentativas where chave like 'i:%'`)[0].m;
  const errar = async (n) => { for (let i = 0; i < n; i++) { await sql`update login_tentativas set bloqueado_ate = null where chave like 'i:%'`; await entrar(`z${i}@x.com`, "errada1", ipx); } };
  await errar(29); assert.ok(Math.abs(await minIp() - 1) < 0.2, "29: ainda 1 min");
  await errar(1); assert.ok(Math.abs(await minIp() - 5) < 0.2, "30: 5 min");
  await errar(10); assert.ok(Math.abs(await minIp() - 15) < 0.2, "40: 15 min");
  await sql`update login_tentativas set atualizado = now() - interval '61 minutes', bloqueado_ate = null where chave like 'i:%'`; // passou uma hora
  await entrar("z@x.com", "errada1", ipx);
  assert.equal((await sql`select falhas from login_tentativas where chave like 'i:%'`)[0].falhas, 1, "recomeçou");
  await limpar();
  for (let i = 0; i < 18; i++) await entrar(`y${i}@x.com`, "errada1", "10.8.1.1");
  assert.equal((await entrar("ana@x.com", "certa123", "10.8.1.1")).status, 200, "acertou");
  await entrar("y@x.com", "errada1", "10.8.1.1");
  assert.equal((await entrar("ana@x.com", "certa123", "10.8.1.1")).status, 401, "o acerto não zerou o contador do IP: 20 tentativas bloqueiam");
});
