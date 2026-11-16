// Exclusão de conta com HMAC (HASH_SEGREDO) e pedidos pagos guardados sem dados pessoais (docs/suporte.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { abrir } from "./harness.mjs";
process.env.ADMIN_EMAILS = "dono@x.com";
const SEGREDO = "segredo-de-integracao-com-mais-de-32-caracteres";
process.env.HASH_SEGREDO = SEGREDO;
const { sql, chamar } = await abrir();
const sha = (t) => createHash("sha256").update(t).digest("hex");
const hmac = (e) => createHmac("sha256", SEGREDO).update(e).digest("hex");
await sql`insert into usuarios (email, nome, senha) values ('dono@x.com', 'Dono', 'x')`;
const TD = "d".repeat(64);
await sql`insert into sessoes (token, email, expira) values (${sha(TD)}, 'dono@x.com', now() + interval '1 day')`;
const adm = (b) => chamar({ acao: "admin", ...b }, TD);
const conta = async (email) => (await chamar({ acao: "criar", nome: "N", email, senha: "123456" })).token;

test("sem HASH_SEGREDO (ou curto) a exclusão é recusada e nada muda; o painel avisa", async () => {
  await conta("sem@x.com");
  for (const v of [undefined, "curto"]) {
    if (v === undefined) delete process.env.HASH_SEGREDO; else process.env.HASH_SEGREDO = v;
    const r = await adm({ op: "usuario_excluir", email: "sem@x.com", confirmacao: "sem@x.com" });
    assert.equal(r.status, 400); assert.match(r.corpo.erro, /HASH_SEGREDO/);
    assert.equal((await adm({ op: "usuario", email: "sem@x.com" })).corpo.podeExcluir, false);
  }
  process.env.HASH_SEGREDO = SEGREDO;
  assert.equal((await sql`select count(*)::int as n from usuarios where email = 'sem@x.com'`)[0].n, 1);
  assert.equal((await adm({ op: "usuario", email: "sem@x.com" })).corpo.podeExcluir, true);
});

test("pedidos pagos, prontos e estornados ficam anonimizados; os não pagos saem; log e histórico só com o HMAC", async () => {
  const t = await conta("ana@x.com");
  await chamar({ acao: "chamado_abrir", assunto: "conta", texto: "exclua", pedido_id: undefined }, t);
  await sql`insert into pedidos (id, email, tipo, status, valor, metodo, capture_method, pago_em, transaction_nsu, respostas, fotos, plano_gerado, aceite, mensagem_usuario, codigo) values
    ('P1', 'ana@x.com', 'inicial', 'pronto', 999, 'pix', 'pix', now(), 'tx1', '{"peso":70}', '{"frente":"data:x"}', '{"nome":"A"}', '{"ip":"1.2.3.4"}', 'oi', 'FW-1'),
    ('P2', 'ana@x.com', 'mensalidade', 'cancelado', 1199, 'cartao', 'credit_card', now(), 'tx2', null, null, null, null, null, null),
    ('P3', 'ana@x.com', 'novo_treino', 'cancelado', 499, null, null, null, null, '{"peso":71}', null, null, null, null, null)`;
  await sql`update pedidos set estornado_em = now(), estornado_por = 'dono@x.com' where id = 'P2'`;
  await adm({ op: "acesso", email: "ana@x.com", dias: 7 });
  const r = await adm({ op: "usuario_excluir", email: "ana@x.com", confirmacao: "ana@x.com" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const ps = await sql`select * from pedidos where id in ('P1', 'P2', 'P3') order by id`;
  assert.deepEqual(ps.map((p) => p.id), ["P1", "P2"], "o não pago saiu");
  for (const p of ps) {
    assert.equal(p.email, "excluida:" + hmac("ana@x.com"));
    for (const k of ["respostas", "fotos", "plano_gerado", "aceite", "mensagem_usuario"]) assert.equal(p[k], null, p.id + " " + k);
  }
  assert.deepEqual([ps[0].tipo, ps[0].valor, ps[0].metodo, ps[0].status, ps[0].transaction_nsu, !!ps[0].pago_em], ["inicial", 999, "pix", "pronto", "tx1", true]);
  assert.ok(ps[1].estornado_em);
  assert.ok(!JSON.stringify(await sql`select * from pedidos`).includes("ana@x.com"));
  assert.ok(!JSON.stringify(await sql`select * from admin_log`).includes("ana@x.com"), "nenhum log com o email");
  assert.ok(!JSON.stringify(await sql`select * from admin_log`).includes(sha("ana@x.com")), "nem o SHA-256 simples");
  const [l] = await sql`select detalhes from admin_log where acao = 'conta_excluida'`;
  assert.deepEqual(l.detalhes, { email_hmac: hmac("ana@x.com") });
  assert.equal((await sql`select count(*)::int as n from admin_log where detalhes->>'email_hmac' = ${hmac("ana@x.com")}`)[0].n, 2, "o acesso dado antes (anonimizado) e a exclusão");
  assert.equal((await sql`select count(*)::int as n from chamados`)[0].n, 0);
  // o pedido guardado continua no painel, sem dado pessoal
  const lista = (await adm({ op: "pedidos", status: "" })).corpo.itens;
  assert.ok(lista.some((x) => x.id === "P1" && x.nome === "Conta excluída"));
  const det = (await adm({ op: "pedido", id: "P1" })).corpo;
  assert.equal(det.contaExcluida, true); assert.equal(det.respostas, null);
  // a receita do mês continua contando o pago (não estornado)
  assert.ok((await adm({ op: "resumo" })).corpo.receitaMes >= 999);
  // o mesmo email pode criar conta de novo, sem ver nada da anterior
  const t2 = await conta("ana@x.com");
  assert.equal((await chamar({ acao: "pedido_status" }, t2)).corpo.pedido, null);
});

test("sem chave estrangeira em pedidos: a migração tira a antiga e nada cascateia", async () => {
  const fk = await sql`select conname from pg_constraint where conrelid = 'pedidos'::regclass and contype = 'f' and confrelid = 'usuarios'::regclass`;
  assert.deepEqual(fk, []);
});
