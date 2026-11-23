import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { abrir } from "./harness.mjs";
process.env.ADMIN_EMAILS = "dono@x.com";
const { sql, chamar } = await abrir();
const conta = async (email) => (await chamar({ acao: "criar", nome: email.split("@")[0], email, senha: "123456" })).token;
const sha = (t) => createHash("sha256").update(t).digest("hex");
const hmac = (e) => createHmac("sha256", process.env.HASH_SEGREDO).update(e).digest("hex");
await sql`insert into usuarios (email, nome, senha) values ('dono@x.com', 'Dono', 'x')`;
await sql`insert into admin_2fa (email, segredo_cifrado, ativado_em) values ('dono@x.com', 'x', now())`; // admin com o 2º fator ativado (a sessão de admin só vale assim)
const tDono = "d".repeat(64);
await sql`insert into sessoes (token, email, expira) values (${sha(tDono)}, 'dono@x.com', now() + interval '1 day')`;
const adm = (b) => chamar({ acao: "admin", ...b }, tDono);
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";
const A = await conta("ana@x.com"), B = await conta("bia@x.com");

test("outra conta não lê, não responde, não encerra, não vê o anexo", async () => {
  const r = await chamar({ acao: "chamado_abrir", assunto: "app", texto: "travou", anexo: JPEG }, A);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const id = r.corpo.id;
  const [m] = await sql`select id from chamado_mensagens where chamado_id = ${id}`;
  for (const b of [{ acao: "chamado", id }, { acao: "chamado_responder", id, texto: "x" }, { acao: "chamado_encerrar", id }, { acao: "chamado_anexo", id, msg: Number(m.id) }])
    assert.equal((await chamar(b, B)).status, 404, b.acao);
  assert.equal((await sql`select status from chamados where id = ${id}`)[0].status, "aberto");
  assert.equal((await sql`select count(*)::int as n from chamado_mensagens where chamado_id = ${id}`)[0].n, 1);
  assert.equal((await chamar({ acao: "suporte" }, B)).corpo.chamados.length, 0);
  assert.equal((await chamar({ acao: "chamado_anexo", id, msg: Number(m.id) }, A)).corpo.anexo, JPEG);
  // pedido de outra conta não entra
  await sql`insert into pedidos (id, email, tipo, status, valor) values ('PA', 'ana@x.com', 'inicial', 'cancelado', 999)`;
  assert.equal((await chamar({ acao: "chamado_abrir", assunto: "pagamento", texto: "oi", pedido_id: "PA" }, B)).status, 404);
  await chamar({ acao: "chamado_encerrar", id }, A);
});

test("limites: 3 chamados em andamento e 10 mensagens por hora", async () => {
  const C = await conta("cid@x.com");
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await chamar({ acao: "chamado_abrir", assunto: "conta", texto: "m" + i }, C)).corpo.id);
  let r = await chamar({ acao: "chamado_abrir", assunto: "conta", texto: "4º" }, C);
  assert.equal(r.status, 429); assert.match(r.corpo.erro, /3 chamados/);
  await chamar({ acao: "chamado_encerrar", id: ids[0] }, C);
  for (let i = 0; i < 7; i++) assert.equal((await chamar({ acao: "chamado_responder", id: ids[1], texto: "r" + i }, C)).status, 200, "msg " + i);
  r = await chamar({ acao: "chamado_responder", id: ids[1], texto: "11ª" }, C);
  assert.equal(r.status, 429); assert.match(r.corpo.erro, /10 mensagens/);
  r = await chamar({ acao: "chamado_abrir", assunto: "conta", texto: "novo" }, C);
  assert.equal(r.status, 429); assert.match(r.corpo.erro, /10 mensagens/);
  r = await chamar({ acao: "chamado_responder", id: ids[0], texto: "fechado" }, C);
  assert.equal(r.status, 400); assert.match(r.corpo.erro, /encerrado/);
  assert.equal((await chamar({ acao: "chamado_abrir", assunto: "app", texto: "x", anexo: "data:image/png;base64,iVBOR" }, C)).status, 400);
});

test("resposta do admin muda o status, acende o aviso e abrir a conversa apaga", async () => {
  const D = await conta("dani@x.com");
  const id = (await chamar({ acao: "chamado_abrir", assunto: "treino", texto: "dói o joelho\n<script>x</script>" }, D)).corpo.id;
  assert.equal((await chamar({ acao: "eu" }, D)).corpo.suporteNaoLido, false);
  let r = await adm({ op: "resumo" });
  assert.ok(r.corpo.suporteAguardando >= 1);
  const lista = (await adm({ op: "suporte_lista", status: "aberto" })).corpo.itens;
  assert.ok(lista.some((x) => x.id === id && x.resumo === "dói o joelho" && x.nome === "dani"));
  r = await adm({ op: "suporte_responder", id, texto: "Troque por leg press." });
  assert.equal(r.status, 200);
  assert.equal((await sql`select status from chamados where id = ${id}`)[0].status, "respondido");
  assert.equal((await chamar({ acao: "eu" }, D)).corpo.suporteNaoLido, true);
  assert.equal((await chamar({ acao: "pedido_status" }, D)).corpo.suporteNaoLido, true);
  const s = (await chamar({ acao: "suporte" }, D)).corpo;
  assert.equal(s.naoLido, true);
  const c = (await chamar({ acao: "chamado", id }, D)).corpo;
  assert.deepEqual(c.mensagens.map((m) => m.autor), ["aluno", "admin"]);
  assert.equal(c.mensagens[1].admin_email, undefined);
  assert.equal((await chamar({ acao: "eu" }, D)).corpo.suporteNaoLido, false);
  const [l] = await sql`select detalhes from admin_log where acao = 'suporte_responder' and detalhes->>'chamado' = ${id}`;
  assert.equal(l.detalhes.tamanho, "Troque por leg press.".length);
  assert.equal((await adm({ op: "suporte_encerrar", id })).status, 200);
  assert.equal((await adm({ op: "suporte_encerrar", id })).status, 400);
  assert.equal((await adm({ op: "suporte_reabrir", id })).status, 200);
  assert.equal((await sql`select status, fechado_em from chamados where id = ${id}`)[0].status, "aberto");
  assert.equal((await sql`select count(*)::int as n from admin_log where acao in ('suporte_encerrar', 'suporte_reabrir') and detalhes->>'chamado' = ${id}`)[0].n, 2);
  const ctx = (await adm({ op: "suporte_chamado", id })).corpo;
  assert.equal(ctx.chamado.email, "dani@x.com"); assert.equal(ctx.mensagens[1].admin_email, "dono@x.com");
});

test("admin ver anexo grava no log", async () => {
  const E = await conta("eva@x.com");
  const id = (await chamar({ acao: "chamado_abrir", assunto: "app", texto: "print", anexo: JPEG }, E)).corpo.id;
  const [m] = await sql`select id from chamado_mensagens where chamado_id = ${id}`;
  assert.equal((await adm({ op: "suporte_anexo", id, msg: Number(m.id) })).corpo.anexo, JPEG);
  assert.equal((await sql`select count(*)::int as n from admin_log where acao = 'suporte_anexo_ver'`)[0].n, 1);
});

test("prazos: respondido há 7 dias fecha; anexo some 90 dias depois de fechado", async () => {
  const F = await conta("fe@x.com");
  const id1 = (await chamar({ acao: "chamado_abrir", assunto: "app", texto: "a", anexo: JPEG }, F)).corpo.id;
  const id2 = (await chamar({ acao: "chamado_abrir", assunto: "app", texto: "b", anexo: JPEG }, F)).corpo.id;
  await adm({ op: "suporte_responder", id: id1, texto: "ok" }); await adm({ op: "suporte_responder", id: id2, texto: "ok" });
  await sql`update chamados set atualizado = now() - interval '8 days' where id = ${id1}`;
  await sql`update chamados set atualizado = now() - interval '6 days' where id = ${id2}`;
  await chamar({ acao: "suporte" }, F);
  assert.equal((await sql`select status from chamados where id = ${id1}`)[0].status, "fechado");
  assert.equal((await sql`select status from chamados where id = ${id2}`)[0].status, "respondido");
  await sql`update chamados set fechado_em = now() - interval '91 days' where id = ${id1}`;
  await adm({ op: "resumo" });
  assert.equal((await sql`select count(*)::int as n from chamado_mensagens where chamado_id = ${id1} and anexo is not null`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from chamado_mensagens where chamado_id = ${id2} and anexo is not null`)[0].n, 1);
  assert.equal((await sql`select count(*)::int as n from chamado_mensagens where chamado_id = ${id1}`)[0].n, 2, "as mensagens ficam");
});

test("exclusão de conta: cascata, só o hash no log, recusa com pedido pago ou gerando e a própria conta", async () => {
  const G = await conta("gui@x.com");
  await chamar({ acao: "chamado_abrir", assunto: "conta", texto: "quero excluir" }, G);
  await sql`insert into pedidos (id, email, tipo, status, valor) values ('PG', 'gui@x.com', 'inicial', 'gerando', 999)`;
  let r = await adm({ op: "usuario_excluir", email: "gui@x.com", confirmacao: "gui@x.com" });
  assert.equal(r.status, 400); assert.match(r.corpo.erro, /pago ou gerando/);
  await sql`update pedidos set status = 'pronto' where id = 'PG'`;
  assert.equal((await adm({ op: "usuario_excluir", email: "gui@x.com", confirmacao: "x@x.com" })).status, 400);
  r = await adm({ op: "usuario_excluir", email: "gui@x.com", confirmacao: "GUI@x.com " });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  for (const t of ["usuarios", "sessoes", "pedidos", "chamados"]) assert.equal((await sql.call(null, [`select count(*)::int as n from ${t} where email = $0`.replace("$0", "'gui@x.com'")]))[0].n, 0, t);
  assert.equal((await sql`select count(*)::int as n from chamado_mensagens m left join chamados c on c.id = m.chamado_id where c.id is null`)[0].n, 0);
  const [l] = await sql`select admin_email, alvo_email, detalhes, criado from admin_log where acao = 'conta_excluida'`;
  assert.equal(l.alvo_email, null); assert.equal(l.admin_email, "dono@x.com"); assert.ok(l.criado);
  assert.deepEqual(l.detalhes, { email_hmac: hmac("gui@x.com") });
  assert.equal((await chamar({ acao: "eu" }, G)).status, 401, "sessão apagada");
  assert.equal((await adm({ op: "usuario_excluir", email: "dono@x.com", confirmacao: "dono@x.com" })).status, 400);
  assert.equal((await adm({ op: "usuario_excluir", email: "nao@x.com", confirmacao: "nao@x.com" })).status, 404);
});

test("exclusão: histórico antigo perde o email (fica o hash) e conta com pedido aberto é recusada", async () => {
  const H = await conta("hel@x.com");
  await adm({ op: "acesso", email: "hel@x.com", dias: 7 });
  await sql`insert into pedidos (id, email, tipo, status, valor) values ('PH', 'hel@x.com', 'inicial', 'aguardando_pagamento', 999)`;
  let r = await adm({ op: "usuario_excluir", email: "hel@x.com", confirmacao: "hel@x.com" });
  assert.equal(r.status, 400); assert.match(r.corpo.erro, /aguardando pagamento/);
  await adm({ op: "pedido_cancelar", id: "PH" });
  assert.equal((await adm({ op: "usuario_excluir", email: "hel@x.com", confirmacao: "hel@x.com" })).status, 200);
  assert.equal((await sql`select count(*)::int as n from admin_log where alvo_email = 'hel@x.com' or detalhes::text like '%hel@x.com%'`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from admin_log where detalhes->>'email_hmac' = ${hmac("hel@x.com")}`)[0].n, 3, "acesso, cancelar e a exclusão");
  // quem cria conta de novo com o mesmo email não vê o histórico
  await conta("hel@x.com");
  assert.equal((await adm({ op: "usuario", email: "hel@x.com" })).corpo.historico.length, 0);
  void H;
});

test("limites por dia: 5 chamados e ~2 MB de imagens", async () => {
  const I = await conta("ivo@x.com");
  for (let i = 0; i < 5; i++) {
    const id = (await chamar({ acao: "chamado_abrir", assunto: "app", texto: "c" + i }, I)).corpo.id;
    await chamar({ acao: "chamado_encerrar", id }, I);
  }
  let r = await chamar({ acao: "chamado_abrir", assunto: "app", texto: "6º" }, I);
  assert.equal(r.status, 429); assert.match(r.corpo.erro, /5 chamados hoje/);
  const J = await conta("ju@x.com");
  const grande = "data:image/jpeg;base64,/9j/" + "A".repeat(400000);
  const id = (await chamar({ acao: "chamado_abrir", assunto: "app", texto: "1", anexo: grande }, J)).corpo.id;
  for (let i = 0; i < 3; i++) assert.equal((await chamar({ acao: "chamado_responder", id, texto: "x", anexo: grande }, J)).status, 200, "img " + i); // 4 imagens = 1,6 MB
  r = await chamar({ acao: "chamado_responder", id, texto: "x", anexo: grande }, J);
  assert.equal(r.status, 429); assert.match(r.corpo.erro, /imagens/);
  assert.equal((await chamar({ acao: "chamado_responder", id, texto: "só texto" }, J)).status, 200);
});

test("marcar como devolvido duas vezes ao mesmo tempo grava uma vez só", async () => {
  await sql`insert into admin_log (admin_email, acao, alvo_email, detalhes) values ('infinitepay', 'cartao_sem_pedido', null, '{"transaction_nsu":"txz","paid_amount":999}')`;
  const rs = await Promise.all([adm({ op: "devolucao_marcar", transaction_nsu: "txz" }), adm({ op: "devolucao_marcar", transaction_nsu: "txz" })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 400]);
  assert.equal((await sql`select count(*)::int as n from admin_log where acao = 'devolvido'`)[0].n, 1);
});
