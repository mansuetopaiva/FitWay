// Limites do cadastro (por IP da Vercel) e do código do grupo (por conta e por IP), com rajadas em paralelo e respostas iguais.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
const { sql, chamar } = await abrir();
const vip = (ip) => ({ "x-vercel-forwarded-for": ip });
const criar = (email, ip, senha = "senha123") => chamar({ acao: "criar", nome: "Ana", email, senha }, null, vip(ip));
const hoje = new Date().toISOString().slice(0, 10);
const entrarGrupo = (codigo, token, ip) => chamar({ acao: "ranking", op: "entrar", codigo, semana: hoje, mes: hoje }, token, vip(ip));

test("cadastro: rajada de 40 em paralelo do mesmo IP cria só 10 contas; as outras recebem a mesma recusa do email já existente; outro IP não é afetado", async () => {
  await criar("existe@x.com", "20.0.0.1"); // conta o 1º cadastro desse IP
  const existente = await criar("existe@x.com", "20.0.0.2");
  const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => criar(`novo${i}@x.com`, "20.0.1.1")));
  assert.equal((await sql`select count(*)::int as n from usuarios where email like 'novo%'`)[0].n, 10, "só as 10 primeiras tentativas passaram");
  const recusadas = rs.filter((r) => r.status === 400);
  assert.equal(recusadas.length, 30);
  for (const r of recusadas) assert.deepEqual({ status: r.status, corpo: r.corpo, token: r.token }, { status: existente.status, corpo: existente.corpo, token: undefined }, "mesma resposta que 'email já existe'");
  assert.equal((await criar("outro-ip@x.com", "20.0.2.2")).status, 200, "outro IP cadastra");
  assert.equal((await criar("depois@x.com", "20.0.1.1")).status, 400, "o IP bloqueado continua bloqueado");
});

test("cadastro: o IP vem de x-vercel-forwarded-for, não de cabeçalhos que o cliente inventa", async () => {
  const hs = (i) => ({ "x-vercel-forwarded-for": "20.1.0.1", "x-forwarded-for": "9.9.9." + i, "x-real-ip": "8.8.8." + i });
  const rs = [];
  for (let i = 0; i < 12; i++) rs.push(await chamar({ acao: "criar", nome: "Ana", email: `falso${i}@x.com`, senha: "senha123" }, null, hs(i)));
  assert.equal(rs.filter((r) => r.status === 200).length, 10);
});

const grupoCom = async (n, dono) => { // grupo com n membros
  const t = (await chamar({ acao: "criar", nome: dono, email: dono + "@x.com", senha: "senha123" }, null, vip("21.0.0." + Math.floor(Math.random() * 200)))).token;
  const codigo = (await chamar({ acao: "ranking", op: "criar", semana: hoje, mes: hoje }, t)).corpo.codigo;
  for (let i = 1; i < n; i++) await sql`insert into usuarios (email, nome, senha, grupo) values (${dono + "m" + i + "@x.com"}, 'M', 'x', ${codigo})`;
  return codigo;
};

test("código do grupo: inexistente, cheio e bloqueado respondem exatamente igual", async () => {
  const cheio = await grupoCom(50, "cheia");
  const ok = await grupoCom(3, "livre");
  const t = (await chamar({ acao: "criar", nome: "Zé", email: "ze@x.com", senha: "senha123" }, null, vip("22.0.0.1"))).token;
  const inexistente = await entrarGrupo("ZZZZZZ", t, "22.0.0.2");
  const lotado = await entrarGrupo(cheio, t, "22.0.0.3");
  for (let i = 0; i < 6; i++) await entrarGrupo("QQQQQ" + i, t, "22.0.1." + i); // passa do limite da conta
  const bloqueado = await entrarGrupo(ok, t, "22.0.0.4"); // código certo, mas a conta está bloqueada
  for (const r of [lotado, bloqueado]) assert.deepEqual({ status: r.status, corpo: r.corpo }, { status: inexistente.status, corpo: inexistente.corpo });
  assert.equal(inexistente.status, 400); assert.doesNotMatch(inexistente.corpo.erro, /cheio|não encontrei/i, "a mensagem não diz o motivo");
});

test("código do grupo: rajada de 40 em paralelo contra uma conta conta só 5 tentativas; entrar com o código certo zera a conta", async () => {
  const t = (await chamar({ acao: "criar", nome: "Bia", email: "bia@x.com", senha: "senha123" }, null, vip("23.0.0.1"))).token;
  await Promise.all(Array.from({ length: 40 }, (_, i) => entrarGrupo("RRRRR" + (i % 10), t, "23.1." + (i >> 8) + "." + (i & 255))));
  const conta = (await sql`select falhas from login_tentativas where chave like 'g:%' order by falhas desc limit 1`)[0].falhas;
  assert.equal(conta, 5, "o contador da conta parou em 5 (as outras 35 nem consultaram o grupo)");
  // outra conta, com o código certo: entra, e o contador DELA zera
  const ok = await grupoCom(2, "certa");
  const t2 = (await chamar({ acao: "criar", nome: "Cris", email: "cris@x.com", senha: "senha123" }, null, vip("23.0.0.2"))).token;
  await entrarGrupo("XXXXXX", t2, "23.2.0.1"); await entrarGrupo("YYYYYY", t2, "23.2.0.2");
  const com2 = async () => (await sql`select count(*)::int as n from login_tentativas where chave like 'g:%' and falhas = 2`)[0].n;
  assert.equal(await com2(), 1, "duas tentativas erradas contadas");
  assert.equal((await entrarGrupo(ok, t2, "23.2.0.3")).status, 200);
  assert.equal(await com2(), 0, "entrar de verdade zerou o contador da conta");
});

test("código do grupo: rajada de 60 em paralelo do mesmo IP, em 30 contas, conta só 20 tentativas do IP", async () => {
  const tokens = [];
  for (let i = 0; i < 30; i++) tokens.push((await chamar({ acao: "criar", nome: "U", email: `u${i}@x.com`, senha: "senha123" }, null, vip("24.0." + (i >> 8) + "." + (i & 255)))).token);
  await sql`delete from login_tentativas`;
  await Promise.all(Array.from({ length: 60 }, (_, i) => entrarGrupo("KKKKK" + (i % 10), tokens[i % 30], "24.9.9.9")));
  const ip = (await sql`select falhas from login_tentativas where chave like 'gi:%'`)[0].falhas;
  assert.equal(ip, 20, "o IP parou em 20 tentativas");
});
