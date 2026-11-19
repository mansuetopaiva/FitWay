// Check-in com data depois de hoje (no fuso de Brasília): o servidor não grava, e o que já estiver gravado não conta no ranking nem nos dias.
// O relógio do handler é o real (mockar Date deixa o PGlite sem encerrar); a virada da meia-noite é testada em hojeBR/limpar com instantes explícitos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
const { sql, chamar, R } = await abrir();
const { hojeBR, limpar, juntar } = await import(R + "api/_dados.js");
const T = (iso) => new Date(iso);
const soma = (dia, n) => new Date(Date.parse(dia + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

test("virada da meia-noite de Brasília (UTC-3, sem horário de verão): 23:59 ainda é o dia anterior, 00:01 já é o novo", () => {
  const a = hojeBR(T("2026-11-20T02:59:00Z")), b = hojeBR(T("2026-11-20T03:01:00Z"));
  assert.equal(a, "2026-11-19"); assert.equal(b, "2026-11-20");
  const dados = { checkins: ["2026-11-19", "2026-11-20"] };
  assert.deepEqual(limpar(dados, a).checkins, ["2026-11-19"], "23:59 de 19/11: 20/11 é amanhã");
  assert.deepEqual(limpar(dados, b).checkins, ["2026-11-19", "2026-11-20"], "00:01 de 20/11: 20/11 é hoje");
  assert.deepEqual(juntar(limpar({ checkins: ["2026-11-19"] }, a), limpar(dados, a), a).checkins, ["2026-11-19"]);
});

const gravados = async (email) => (await sql`select dados->'checkins' as c from usuarios where email = ${email}`)[0].c;

test("o servidor grava hoje e ontem e recusa amanhã e datas distantes", async () => {
  const hoje = hojeBR(), ontem = soma(hoje, -1), amanha = soma(hoje, 1);
  const tk = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" })).token;
  const r = await chamar({ acao: "salvar", dados: { checkins: [ontem, hoje, amanha, "2099-12-25"], sessoes: 1 } }, tk);
  assert.equal(r.status, 200);
  assert.deepEqual(await gravados("ana@x.com"), [ontem, hoje]);
  assert.deepEqual(r.corpo.dados.checkins, [ontem, hoje]);
});

test("check-ins futuros que já estavam gravados não entram no ranking nem na contagem de dias, e saem do banco no próximo salvamento", async () => {
  const hoje = hojeBR(), ontem = soma(hoje, -1), amanha = soma(hoje, 1);
  const tk = (await chamar({ acao: "criar", nome: "Bia", email: "bia@x.com", senha: "senha123" })).token;
  await sql`update usuarios set dados = ${JSON.stringify({ checkins: [ontem, hoje, amanha, "2099-01-01"], sessoes: 1 })}::jsonb where email = 'bia@x.com'`;
  const eu = await chamar({ acao: "eu" }, tk);
  assert.deepEqual(eu.corpo.dados.checkins, [ontem, hoje], "contagem de dias");
  const periodo = { semana: soma(hoje, -6), mes: soma(hoje, -6) }; // janelas que incluem ontem, hoje e o futuro
  await chamar({ acao: "ranking", op: "criar", ...periodo }, tk);
  const rk = await chamar({ acao: "ranking", ...periodo }, tk);
  const eu_ = rk.corpo.membros.find((m) => m.eu);
  assert.equal(eu_.semana, 2); assert.equal(eu_.mes, 2);
  await chamar({ acao: "salvar", dados: { checkins: [] } }, tk);
  assert.deepEqual(await gravados("bia@x.com"), [ontem, hoje]);
});
