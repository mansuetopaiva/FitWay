// Estorno de pedido pago ou pronto e "Marcar como devolvido" (docs/pagamento.md, "Devoluções").
// A conta dos dias e a remoção do treino rodam em SQL real no PGlite, fora do repositório; aqui, validação e forma.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acaoAdmin } from "../api/_admin.js";

process.env.ADMIN_EMAILS = "dono@x.com";
const dono = { email: "dono@x.com" };
function sqlFalso(responder = () => []) {
  const chamadas = [];
  const sql = async (partes, ...valores) => { const q = partes.join("?"); chamadas.push({ q, valores }); return responder(q, valores); };
  return { sql, chamadas };
}

test("estornar: não-admin 403 e motivo inválido 400, sem consultar o banco", async () => {
  let s = sqlFalso();
  assert.equal((await acaoAdmin(s.sql, { email: "aluno@x.com" }, { op: "pedido_estornar", id: "p1", motivo: "desistencia" })).status, 403);
  for (const b of [{}, { motivo: "x" }, { motivo: "outro" }, { motivo: "outro", texto: "   " }, { motivo: "outro", texto: "x".repeat(201) },
    { motivo: "outro", texto: 5 }, { motivo: "toString" }]) {
    s = sqlFalso();
    const r = await acaoAdmin(s.sql, dono, { op: "pedido_estornar", id: "p1", ...b });
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.equal(s.chamadas.length, 0, JSON.stringify(b));
  }
});

test("estornar: uma instrução só, condicional (pago/pronto/erro, sem estorno anterior), com log, dias e treino do próprio pedido", async () => {
  const s = sqlFalso(() => [{ status: "cancelado", acesso_ate: null }]);
  const r = await acaoAdmin(s.sql, dono, { op: "pedido_estornar", id: "p1", motivo: "outro", texto: "  cobrou duas vezes  " });
  assert.equal(r.status, 200);
  assert.equal(s.chamadas.length, 1, "uma instrução: nunca efeito sem log");
  const { q, valores } = s.chamadas[0];
  assert.match(q, /status in \('pago', 'pronto', 'erro'\) and estornado_em is null/);
  assert.match(q, /'pedido_estornado'/);
  assert.match(q, /least\(acesso_ate, greatest\(now\(\), acesso_ate - make_interval/, "nunca aumenta e nunca antes de now()");
  assert.match(q, /dados->'plano'->>'pedido' = \(select id from p\)/, "treino só se for o deste pedido");
  assert.ok(valores.includes("cobrou duas vezes"), "texto aparado");
  assert.ok(valores.includes("Outro"));
});

test("estornar: segunda vez (ou status que não permite) dá 400", async () => {
  const r = await acaoAdmin(sqlFalso().sql, dono, { op: "pedido_estornar", id: "p1", motivo: "duplicado" });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /estornad|devolução/i);
});

test("marcar como devolvido: valida o transaction_nsu, grava no log uma vez e some da lista do resumo", async () => {
  for (const t of [undefined, "", "a b", "x".repeat(101), 5]) {
    const s = sqlFalso();
    assert.equal((await acaoAdmin(s.sql, dono, { op: "devolucao_marcar", transaction_nsu: t })).status, 400);
    assert.equal(s.chamadas.length, 0);
  }
  let s = sqlFalso(() => [{ id: 1 }]);
  assert.equal((await acaoAdmin(s.sql, dono, { op: "devolucao_marcar", transaction_nsu: "tx-1" })).status, 200);
  assert.match(s.chamadas[0].q, /insert into admin_log .*'devolvido'.*acao = 'cartao_sem_pedido'.*not exists .*acao = 'devolvido'/s);
  s = sqlFalso();
  assert.equal((await acaoAdmin(s.sql, dono, { op: "devolucao_marcar", transaction_nsu: "tx-1" })).status, 400, "sem item na lista");
  s = sqlFalso(() => [{ aguardando: 0, receita_mes: 0, vencendo7d: 0 }]);
  await acaoAdmin(s.sql, dono, { op: "resumo" });
  assert.ok(s.chamadas.some((c) => /acao = 'cartao_sem_pedido'.*not exists .*acao = 'devolvido'/s.test(c.q)), "a lista tira os devolvidos");
  assert.ok(s.chamadas.some((c) => /estornado_em is null/.test(c.q)), "a receita do mês não conta pedido estornado");
});
