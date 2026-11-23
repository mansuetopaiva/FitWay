import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { abrir } from "./harness.mjs";
process.env.ADMIN_EMAILS = "dono@x.com";
const { sql, chamar, R } = await abrir();
const { acaoAdmin } = await import(R + "api/_admin.js");
const dono = { email: "dono@x.com" };
const sha = (t) => createHash("sha256").update(t).digest("hex");
await sql`insert into usuarios (email, nome, senha) values ('dono@x.com', 'Dono', 'x')`;
await sql`insert into admin_2fa (email, segredo_cifrado, ativado_em) values ('dono@x.com', 'x', now())`; // admin com o 2º fator ativado (a sessão de admin só vale assim)
const tDono = "d".repeat(64);
await sql`insert into sessoes (token, email, expira) values (${sha(tDono)}, 'dono@x.com', now() + interval '1 day')`;
const adm = (b) => chamar({ acao: "admin", ...b }, tDono);
const conta = async (e) => (await chamar({ acao: "criar", nome: e.split("@")[0], email: e, senha: "123456" })).token;
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";
const abrirCh = async (t, extra = {}) => (await chamar({ acao: "chamado_abrir", assunto: "app", texto: "x", ...extra }, t)).corpo.id;
const st = async (id) => (await sql`select status, fechado_em from chamados where id = ${id}`)[0];
const comAnexo = async (id) => (await sql`select count(*)::int as n from chamado_mensagens where chamado_id = ${id} and anexo is not null`)[0].n;

test("7 dias: só fecha 'respondido'; 'aberto' parado há 8 dias (aguardando o admin) continua aberto; fechado_em é gravado", async () => {
  const T = await conta("h1@x.com");
  const resp = await abrirCh(T), parado = await abrirCh(T);
  await adm({ op: "suporte_responder", id: resp, texto: "ok" });
  await sql`update chamados set atualizado = now() - interval '8 days' where id in (${resp}, ${parado})`;
  await chamar({ acao: "suporte" }, T);
  const r = await st(resp);
  assert.equal(r.status, "fechado"); assert.ok(r.fechado_em, "sem fechado_em o anexo nunca seria apagado");
  assert.equal((await st(parado)).status, "aberto");
});

test("90 dias: fechado há 89 dias mantém o anexo; há 91 perde", async () => {
  const T = await conta("h2@x.com");
  const a = await abrirCh(T, { anexo: JPEG }), b = await abrirCh(T, { anexo: JPEG });
  await chamar({ acao: "chamado_encerrar", id: a }, T); await chamar({ acao: "chamado_encerrar", id: b }, T);
  await sql`update chamados set fechado_em = now() - interval '89 days' where id = ${a}`;
  await sql`update chamados set fechado_em = now() - interval '91 days' where id = ${b}`;
  await adm({ op: "resumo" });
  assert.equal(await comAnexo(a), 1);
  assert.equal(await comAnexo(b), 0);
});

test("limites: 'respondido' conta nos 3; encerrar libera vaga; mensagens com mais de 1 hora e do admin não contam", async () => {
  const T = await conta("h3@x.com");
  const ids = [await abrirCh(T), await abrirCh(T), await abrirCh(T)];
  await adm({ op: "suporte_responder", id: ids[0], texto: "r" });
  assert.equal((await chamar({ acao: "chamado_abrir", assunto: "app", texto: "4" }, T)).status, 429, "respondido ainda conta");
  await chamar({ acao: "chamado_encerrar", id: ids[0] }, T);
  assert.equal((await chamar({ acao: "chamado_abrir", assunto: "app", texto: "4" }, T)).status, 200, "encerrar libera");
  // 4 msgs do aluno agora; leva para 10 e confirma o bloqueio
  for (let i = 0; i < 6; i++) assert.equal((await chamar({ acao: "chamado_responder", id: ids[1], texto: "m" + i }, T)).status, 200);
  for (let i = 0; i < 3; i++) await adm({ op: "suporte_responder", id: ids[1], texto: "admin" + i });
  assert.equal((await chamar({ acao: "chamado_responder", id: ids[1], texto: "11" }, T)).status, 429, "admin não abre vaga");
  await sql`update chamado_mensagens set criado = now() - interval '61 minutes' where autor = 'aluno' and chamado_id = ${ids[1]}`;
  assert.equal((await chamar({ acao: "chamado_responder", id: ids[1], texto: "depois" }, T)).status, 200, "janela de 1 hora anda");
});

test("responder com anexo inválido: 400 e nada gravado; aluno responder volta para 'aberto'", async () => {
  const T = await conta("h4@x.com");
  const id = await abrirCh(T);
  await adm({ op: "suporte_responder", id, texto: "ok" });
  for (const anexo of ["data:image/png;base64,iVBOR", "data:image/svg+xml;base64,/9j/", "data:image/jpeg;base64,/9j/" + "A".repeat(410000)]) {
    assert.equal((await chamar({ acao: "chamado_responder", id, texto: "x", anexo }, T)).status, 400);
  }
  assert.equal((await sql`select count(*)::int as n from chamado_mensagens where chamado_id = ${id}`)[0].n, 2);
  assert.equal((await st(id)).status, "respondido");
  assert.equal((await chamar({ acao: "chamado_responder", id, texto: "valeu", anexo: JPEG }, T)).status, 200);
  assert.equal((await st(id)).status, "aberto");
  assert.equal((await chamar({ acao: "eu" }, T)).corpo.suporteNaoLido, false, "a própria resposta não acende o aviso");
});

test("admin não responde chamado fechado: nada de mensagem, status ou log", async () => {
  const T = await conta("h5@x.com");
  const id = await abrirCh(T);
  await chamar({ acao: "chamado_encerrar", id }, T);
  assert.equal((await adm({ op: "suporte_responder", id, texto: "tarde" })).status, 400);
  assert.equal((await st(id)).status, "fechado");
  assert.equal((await sql`select count(*)::int as n from chamado_mensagens where chamado_id = ${id}`)[0].n, 1);
  assert.equal((await sql`select count(*)::int as n from admin_log where acao = 'suporte_responder' and detalhes->>'chamado' = ${id}`)[0].n, 0);
  assert.equal((await chamar({ acao: "eu" }, T)).corpo.suporteNaoLido, false);
});

test("exclusão: recusa com pedido 'pago' e não apaga nada; não mexe em outra conta", async () => {
  const T = await conta("h6@x.com"); await conta("h7@x.com");
  const id = await abrirCh(T);
  await sql`insert into pedidos (id, email, tipo, status, valor) values ('PH6', 'h6@x.com', 'inicial', 'pago', 999)`;
  const r = await adm({ op: "usuario_excluir", email: "h6@x.com", confirmacao: "h6@x.com" });
  assert.equal(r.status, 400); assert.match(r.corpo.erro, /pago ou gerando/);
  assert.equal((await sql`select count(*)::int as n from usuarios where email = 'h6@x.com'`)[0].n, 1);
  assert.ok(await st(id));
  assert.equal((await chamar({ acao: "eu" }, T)).status, 200, "sessão continua");
  assert.equal((await sql`select count(*)::int as n from admin_log where acao = 'conta_excluida'`)[0].n, 0);
  await sql`update pedidos set status = 'pronto' where id = 'PH6'`;
  assert.equal((await adm({ op: "usuario_excluir", email: "h6@x.com", confirmacao: "h6@x.com" })).status, 200);
  assert.equal((await sql`select count(*)::int as n from usuarios where email = 'h7@x.com'`)[0].n, 1);
  const logs = await sql`select detalhes::text as d, alvo_email from admin_log where acao = 'conta_excluida'`;
  assert.ok(logs.every((l) => !l.d.includes("h6@x.com") && l.alvo_email === null));
});

test("estorno: pedido com 'erro' estorna; treino de outro pedido fica e o log diz treino_removido=false", async () => {
  await sql`insert into usuarios (email, nome, senha, acesso_ate, dados) values ('h8@x.com', 'H', 'x', now() + interval '45 days', '{"plano":{"pedido":"OUTRO"}}')`;
  await sql`insert into pedidos (id, email, tipo, status, valor, pago_em) values ('E1', 'h8@x.com', 'inicial', 'erro', 999, now())`;
  assert.equal((await acaoAdmin(sql, dono, { op: "pedido_estornar", id: "E1", motivo: "duplicado" })).status, 200);
  const [u] = await sql`select dados, acesso_ate from usuarios where email = 'h8@x.com'`;
  assert.equal(u.dados.plano.pedido, "OUTRO");
  assert.equal(Math.round((new Date(u.acesso_ate) - Date.now()) / 864e5), 15);
  const [l] = await sql`select detalhes from admin_log where acao = 'pedido_estornado' and detalhes->>'pedido' = 'E1'`;
  assert.equal(l.detalhes.treino_removido, false);
});

test("estorno: dois cliques ao mesmo tempo descontam uma vez só", async () => {
  await sql`insert into usuarios (email, nome, senha, acesso_ate) values ('h9@x.com', 'H', 'x', now() + interval '60 days')`;
  await sql`insert into pedidos (id, email, tipo, status, valor, pago_em) values ('E2', 'h9@x.com', 'mensalidade', 'pronto', 999, now())`;
  const rs = await Promise.all([1, 2].map(() => acaoAdmin(sql, dono, { op: "pedido_estornar", id: "E2", motivo: "duplicado" })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 400]);
  const [u] = await sql`select acesso_ate from usuarios where email = 'h9@x.com'`;
  assert.equal(Math.round((new Date(u.acesso_ate) - Date.now()) / 864e5), 30);
  assert.equal((await sql`select count(*)::int as n from admin_log where acao = 'pedido_estornado' and detalhes->>'pedido' = 'E2'`)[0].n, 1);
});
