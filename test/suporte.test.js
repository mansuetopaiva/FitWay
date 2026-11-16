// Suporte por chamados (docs/suporte.md). Banco simulado: validação, limites e posse dentro do SQL.
// A semântica do SQL (outra conta, limites reais, prazos, cascata) roda no PGlite, fora do repositório.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACOES, acaoSuporte, anexoValido, limparChamados } from "../api/_suporte.js";
import { acaoAdmin } from "../api/_admin.js";

process.env.ADMIN_EMAILS = "dono@x.com";
process.env.HASH_SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!";
const aluno = { email: "al@x.com" }, dono = { email: "dono@x.com" };
function sqlFalso(responder = () => []) {
  const chamadas = [];
  const sql = async (partes, ...valores) => { const q = partes.join("?"); chamadas.push({ q, valores }); return responder(q, valores); };
  return { sql, chamadas };
}
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";

test("anexo: só JPEG em data URL com a assinatura, até ~300 KB", () => {
  assert.equal(anexoValido(JPEG), true);
  for (const v of ["data:image/png;base64,iVBORw0KGgo", "data:image/jpeg;base64,PHN2Zz4=", "data:image/svg+xml;base64,/9j/", "javascript:alert(1)",
    "data:image/jpeg;base64,/9j/<script>", JPEG + "A".repeat(410001), 5, {}, "data:image/jpeg,/9j/"]) assert.equal(anexoValido(v), false, String(v).slice(0, 40));
});

test("abrir: assunto, texto, pedido e anexo inválidos dão 400 sem consultar o banco", async () => {
  for (const b of [{ assunto: "x", texto: "oi" }, { assunto: "toString", texto: "oi" }, { assunto: "app" }, { assunto: "app", texto: "   " },
    { assunto: "app", texto: "x".repeat(2001) }, { assunto: "app", texto: 5 }, { assunto: "pagamento", texto: "oi", pedido_id: "a b" },
    { assunto: "app", texto: "oi", anexo: "data:image/png;base64,AAAA" }]) {
    const s = sqlFalso();
    const r = await acaoSuporte(s.sql, aluno, { acao: "chamado_abrir", ...b });
    assert.equal(r.status, 400, JSON.stringify(b).slice(0, 80));
    assert.equal(s.chamadas.length, 0);
  }
});

test("abrir: uma instrução com os limites (3 abertos, 10 mensagens/hora) e o pedido da própria conta", async () => {
  const s = sqlFalso((q) => (q.includes("insert into chamados") ? [{ id: "c1" }] : [{ abertos: 0, hora: 0, pedido_ok: true }]));
  const r = await acaoSuporte(s.sql, aluno, { acao: "chamado_abrir", assunto: "pagamento", texto: "  paguei\ne não liberou ", pedido_id: "P1", anexo: JPEG });
  assert.equal(r.status, 200);
  const ins = s.chamadas.find((c) => c.q.includes("insert into chamados"));
  assert.match(ins.q, /status in \('aberto', 'respondido'\)\) < 3/);
  assert.match(ins.q, /m\.autor = 'aluno' and m\.criado > now\(\) - interval '1 hour'\) < 10/);
  assert.match(ins.q, /select id from pedidos where id = .* and email = /s, "pedido só da própria conta");
  assert.match(ins.q, /insert into chamado_mensagens/);
  assert.match(ins.q, /criado > now\(\) - interval '1 day'\) < 5/, "no máximo 5 chamados por dia");
  assert.match(ins.q, /sum\(length\(m\.anexo\)\).*<= 2000000/s, "no máximo ~2 MB de imagens por dia");
  assert.ok(ins.valores.includes("paguei\ne não liberou"), "texto aparado, quebra de linha mantida");
  assert.ok(ins.valores.includes(JPEG));
});

test("abrir: limite estourado dá 429 com a mensagem certa", async () => {
  let s = sqlFalso((q) => (q.includes("insert into chamados") ? [] : [{ abertos: 3, hora: 0, pedido_ok: true }]));
  let r = await acaoSuporte(s.sql, aluno, { acao: "chamado_abrir", assunto: "app", texto: "oi" });
  assert.equal(r.status, 429); assert.match(r.corpo.erro, /3 chamados/);
  s = sqlFalso((q) => (q.includes("insert into chamados") ? [] : [{ abertos: 0, hora: 10, pedido_ok: true }]));
  r = await acaoSuporte(s.sql, aluno, { acao: "chamado_abrir", assunto: "app", texto: "oi" });
  assert.equal(r.status, 429); assert.match(r.corpo.erro, /10 mensagens/);
  s = sqlFalso((q) => (q.includes("insert into chamados") ? [] : [{ abertos: 0, hora: 0, pedido_ok: false }]));
  r = await acaoSuporte(s.sql, aluno, { acao: "chamado_abrir", assunto: "pagamento", texto: "oi", pedido_id: "P9" });
  assert.equal(r.status, 404);
});

test("toda ação sobre um chamado filtra pela conta logada no próprio SQL; id inválido não consulta", async () => {
  for (const acao of ["chamado", "chamado_anexo", "chamado_responder", "chamado_encerrar"]) {
    let s = sqlFalso();
    assert.equal((await acaoSuporte(s.sql, aluno, { acao, id: "a b", msg: 1, texto: "oi" })).status, 400, acao);
    assert.equal(s.chamadas.length, 0);
    s = sqlFalso();
    const r = await acaoSuporte(s.sql, aluno, { acao, id: "c1", msg: 1, texto: "oi" });
    assert.equal(r.status, 404, acao + ": de outra conta (o SQL não acha) = não encontrado");
    assert.ok(s.chamadas.length >= 1);
    for (const c of s.chamadas) if (/chamados/.test(c.q)) assert.ok(/email = \?/.test(c.q) && c.valores.includes("al@x.com"), acao + ": " + c.q.slice(0, 80));
  }
});

test("responder: só chamado não fechado, volta para 'aberto', com os limites", async () => {
  const s = sqlFalso((q) => (q.includes("insert into chamado_mensagens") ? [{ id: 1 }] : [{ status: "respondido", hora: 0 }]));
  assert.equal((await acaoSuporte(s.sql, aluno, { acao: "chamado_responder", id: "c1", texto: "ok" })).status, 200);
  const ins = s.chamadas.find((c) => c.q.includes("insert into chamado_mensagens"));
  assert.match(ins.q, /status <> 'fechado'/);
  assert.match(ins.q, /set status = 'aberto'/);
  assert.match(ins.q, /< 10/);
  const f = sqlFalso((q) => (q.includes("insert into chamado_mensagens") ? [] : [{ status: "fechado", hora: 0 }]));
  const r = await acaoSuporte(f.sql, aluno, { acao: "chamado_responder", id: "c1", texto: "ok" });
  assert.equal(r.status, 400); assert.match(r.corpo.erro, /encerrado/);
});

test("abrir a conversa marca as respostas como lidas e não devolve o anexo inteiro", async () => {
  const s = sqlFalso((q) => (q.includes("update chamados set lido_aluno_em") ? [{ id: "c1", assunto: "app", status: "respondido", pedido_id: null, criado: 1, atualizado: 1 }]
    : q.includes("from chamado_mensagens") ? [{ id: 1, autor: "admin", texto: "<b>oi</b>", anexo: true, criado: 1 }] : []));
  const r = await acaoSuporte(s.sql, aluno, { acao: "chamado", id: "c1" });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.mensagens[0].texto, "<b>oi</b>", "o servidor devolve o texto cru; a tela escapa");
  const m = s.chamadas.find((c) => c.q.includes("from chamado_mensagens"));
  assert.match(m.q, /anexo is not null as anexo/);
  assert.doesNotMatch(m.q, /admin_email/, "o aluno não vê qual admin respondeu");
});

test("prazos: respondido há 7 dias fecha; anexo some 90 dias depois de fechado", async () => {
  const s = sqlFalso();
  await limparChamados(s.sql, null);
  assert.ok(s.chamadas.some((c) => /set status = 'fechado', fechado_em = now\(\).*status = 'respondido' and atualizado < now\(\) - interval '7 days'/s.test(c.q)));
  assert.ok(s.chamadas.some((c) => /set anexo = null.*fechado_em < now\(\) - interval '90 days'/s.test(c.q)));
});

test("ações do suporte conhecidas", () => {
  assert.deepEqual(ACOES, ["suporte", "chamado_abrir", "chamado", "chamado_anexo", "chamado_responder", "chamado_encerrar"]);
});

// ---------- admin ----------
test("admin suporte: não-admin 403 sem consultar; ids e filtros inválidos 400", async () => {
  for (const op of ["suporte_lista", "suporte_chamado", "suporte_responder", "suporte_encerrar", "suporte_reabrir", "suporte_anexo", "usuario_excluir"]) {
    const s = sqlFalso();
    assert.equal((await acaoAdmin(s.sql, aluno, { op, id: "c1" })).status, 403, op);
    assert.equal(s.chamadas.length, 0);
  }
  for (const b of [{ op: "suporte_lista", status: "x" }, { op: "suporte_lista", assunto: "x" }, { op: "suporte_lista", pagina: -1 },
    { op: "suporte_chamado", id: "a b" }, { op: "suporte_responder", id: "c1", texto: "" }, { op: "suporte_responder", id: "c1", texto: "x".repeat(2001) },
    { op: "suporte_anexo", id: "c1", msg: "1" }]) {
    const s = sqlFalso();
    assert.equal((await acaoAdmin(s.sql, dono, b)).status, 400, JSON.stringify(b));
    assert.equal(s.chamadas.length, 0);
  }
});

test("admin responder: status respondido e log na mesma instrução, sem o texto no log", async () => {
  const s = sqlFalso(() => [{ status: "respondido" }]);
  assert.equal((await acaoAdmin(s.sql, dono, { op: "suporte_responder", id: "c1", texto: "segredo do aluno" })).status, 200);
  assert.equal(s.chamadas.length, 1);
  const { q, valores } = s.chamadas[0];
  assert.match(q, /set status = 'respondido'/);
  assert.match(q, /insert into chamado_mensagens .*'admin'/s);
  assert.match(q, /insert into admin_log .*'suporte_responder'/s);
  assert.equal(valores.filter((v) => v === "segredo do aluno").length, 1, "o texto vai só para a mensagem");
});

test("admin encerrar, reabrir e ver anexo gravam no log", async () => {
  for (const [op, acao, st] of [["suporte_encerrar", "suporte_encerrar", "fechado"], ["suporte_reabrir", "suporte_reabrir", "aberto"]]) {
    const s = sqlFalso(() => [{ status: st }]);
    assert.equal((await acaoAdmin(s.sql, dono, { op, id: "c1" })).status, 200);
    assert.match(s.chamadas[0].q, /insert into admin_log/);
    assert.ok(s.chamadas[0].valores.includes(acao), acao);
  }
  const s = sqlFalso(() => [{ anexo: "data:image/jpeg;base64,/9j/" }]);
  assert.equal((await acaoAdmin(s.sql, dono, { op: "suporte_anexo", id: "c1", msg: 3 })).status, 200);
  assert.match(s.chamadas[0].q, /'suporte_anexo_ver'/);
});

test("resumo traz quantos chamados aguardam resposta", async () => {
  const s = sqlFalso((q) => (q.includes("from chamados") ? [{ n: 2 }] : [{ aguardando: 0, receita_mes: 0, vencendo7d: 0 }]));
  const r = await acaoAdmin(s.sql, dono, { op: "resumo" });
  assert.equal(r.corpo.suporteAguardando, 2);
});

// ---------- exclusão de conta ----------
test("excluir conta: confirmação igual ao email, nunca a própria conta, sem consultar à toa", async () => {
  for (const b of [{ email: "al@x.com" }, { email: "al@x.com", confirmacao: "outro@x.com" }, { email: "dono@x.com", confirmacao: "dono@x.com" }]) {
    const s = sqlFalso();
    const r = await acaoAdmin(s.sql, dono, { op: "usuario_excluir", ...b });
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.equal(s.chamadas.length, 0);
  }
});

test("excluir conta: sem HASH_SEGREDO (ou curto) recusa com aviso, sem consultar", async () => {
  const antes = process.env.HASH_SEGREDO;
  try {
    for (const v of [undefined, "", "curto-demais"]) {
      if (v === undefined) delete process.env.HASH_SEGREDO; else process.env.HASH_SEGREDO = v;
      const s = sqlFalso();
      const r = await acaoAdmin(s.sql, dono, { op: "usuario_excluir", email: "al@x.com", confirmacao: "al@x.com" });
      assert.equal(r.status, 400); assert.match(r.corpo.erro, /HASH_SEGREDO/);
      assert.equal(s.chamadas.length, 0);
    }
  } finally { process.env.HASH_SEGREDO = antes; }
});

test("excluir conta: uma instrução, recusa com pedido pago ou gerando, log só com o HMAC do email, pedidos pagos anonimizados", async () => {
  const { createHash, createHmac } = await import("node:crypto");
  const hmac = createHmac("sha256", process.env.HASH_SEGREDO).update("al@x.com").digest("hex");
  const s = sqlFalso((q) => (q.includes("delete from usuarios") ? [{ ok: true }] : []));
  const r = await acaoAdmin(s.sql, dono, { op: "usuario_excluir", email: "Al@X.com", confirmacao: "al@x.com" });
  assert.equal(r.status, 200);
  const del = s.chamadas.find((c) => c.q.includes("delete from usuarios"));
  assert.match(del.q, /status in \('pago', 'gerando', 'aguardando_pagamento', 'aguardando_confirmacao'\)/);
  assert.match(del.q, /update admin_log set alvo_email = null, .*'email_hmac'.*where alvo_email = \? and exists \(select 1 from d\)/s, "histórico antigo perde o email");
  assert.match(del.q, /insert into admin_log .*'conta_excluida', null, jsonb_build_object\('email_hmac'/s);
  assert.ok(del.valores.includes(hmac));
  assert.ok(!del.valores.includes(createHash("sha256").update("al@x.com").digest("hex")), "não é mais o SHA-256 simples");
  assert.match(del.q, /update pedidos set email = \?, respostas = null, fotos = null, plano_gerado = null, mensagem_usuario = null.*pago_em is not null or estornado_em is not null/s, "pagos ficam anonimizados");
  assert.match(del.q, /delete from pedidos where email in \(select email from a\) and pago_em is null and estornado_em is null/, "não pagos saem");
  assert.ok(del.valores.includes("excluida:" + hmac));
  const det = del.valores.filter((v) => typeof v === "string" && v.includes("al@x.com"));
  assert.ok(det.every((v) => v === "al@x.com"), "o email só aparece como filtro, nunca em texto de log");
  const p = sqlFalso((q) => (q.includes("delete from usuarios") ? [] : [{ existe: true, andamento: true }]));
  const r2 = await acaoAdmin(p.sql, dono, { op: "usuario_excluir", email: "al@x.com", confirmacao: "al@x.com" });
  assert.equal(r2.status, 400); assert.match(r2.corpo.erro, /pago ou gerando/);
  const a = sqlFalso((q) => (q.includes("delete from usuarios") ? [] : [{ existe: true, andamento: false, aberto: true }]));
  const r3 = await acaoAdmin(a.sql, dono, { op: "usuario_excluir", email: "al@x.com", confirmacao: "al@x.com" });
  assert.equal(r3.status, 400); assert.match(r3.corpo.erro, /aguardando pagamento/);
  const n = sqlFalso((q) => (q.includes("delete from usuarios") ? [] : [{ existe: false, andamento: false }]));
  assert.equal((await acaoAdmin(n.sql, dono, { op: "usuario_excluir", email: "al@x.com", confirmacao: "al@x.com" })).status, 404);
});

test("anexo: limite exato de 410000 caracteres", () => {
  const base = "data:image/jpeg;base64,/9j/";
  assert.equal(anexoValido(base + "A".repeat(410000 - base.length)), true);
  assert.equal(anexoValido(base + "A".repeat(410001 - base.length)), false);
});
