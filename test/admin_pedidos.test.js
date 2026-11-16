import { test } from "node:test";
import assert from "node:assert/strict";
import { acaoAdmin } from "../api/_admin.js";

process.env.ADMIN_EMAILS = "dono@x.com";
process.env.ANTHROPIC_API_KEY = "sk-teste"; // só para passar da checagem da chave; nenhum teste chama a IA
const dono = { email: "dono@x.com" };
function sqlFalso(responder = () => []) {
  const chamadas = [];
  const sql = async (partes, ...valores) => { const q = partes.join("?"); chamadas.push({ q, valores }); return responder(q, valores); };
  return { sql, chamadas };
}

test("pedido ops: não-admin recebe 403 sem consultar o banco", async () => {
  for (const op of ["pedidos", "pedido", "cartao_verificar", "pedido_gerar_de_novo", "pedido_cancelar"]) {
    const { sql, chamadas } = sqlFalso();
    let gerou = false;
    const r = await acaoAdmin(sql, { email: "aluno@x.com" }, { op, id: "abc", gerar: true }, { gerar: async () => { gerou = true; } });
    assert.equal(r.status, 403, op);
    assert.equal(chamadas.length, 0, op);
    assert.equal(gerou, false);
  }
});

test("pedido ops: id inválido dá 400 sem consulta", async () => {
  for (const id of [undefined, "a b", "x".repeat(41), 5, "x'; drop table pedidos; --", ""]) {
    for (const op of ["pedido", "cartao_verificar", "pedido_gerar_de_novo", "pedido_cancelar"]) {
      const { sql, chamadas } = sqlFalso();
      const r = await acaoAdmin(sql, dono, { op, id });
      assert.equal(r.status, 400, `${op} ${id}`);
      assert.equal(r.corpo.erro, "Informe o pedido.");
      assert.equal(chamadas.length, 0);
    }
  }
});

test("pedidos: filtros e página inválidos dão 400 sem consulta; válidos chegam ao banco", async () => {
  for (const b of [{ status: "x" }, { tipo: "toString" }, { tipo: 5 }, { pagina: -1 }, { pagina: 1.5 }]) {
    const { sql, chamadas } = sqlFalso();
    assert.equal((await acaoAdmin(sql, dono, { op: "pedidos", ...b })).status, 400, JSON.stringify(b));
    assert.equal(chamadas.length, 0);
  }
  const { sql, chamadas } = sqlFalso();
  const r = await acaoAdmin(sql, dono, { op: "pedidos", status: "pago", tipo: "novo_treino", pagina: 2 });
  assert.equal(r.status, 200);
  assert.deepEqual(chamadas[0].valores, ["pago", "pago", "novo_treino", "novo_treino", 40]);
  assert.doesNotMatch(chamadas[0].q, /fotos|respostas/, "lista nunca traz fotos nem respostas");
});

test("pedido: gerar só com true; não encontrado dá 404; abrir registra no log", async () => {
  let n = 0;
  const gerar = async () => { n++; };
  for (const g of ["true", 1, undefined]) await acaoAdmin(sqlFalso().sql, dono, { op: "pedido", id: "p1", gerar: g }, { gerar });
  assert.equal(n, 0);
  const { sql, chamadas } = sqlFalso();
  const r = await acaoAdmin(sql, dono, { op: "pedido", id: "p1", gerar: true }, { gerar });
  assert.equal(n, 1);
  assert.equal(r.status, 404);
  assert.match(chamadas[0].q, /insert into admin_log .*'pedido_ver'.*where respostas is not null or fotos is not null/s);
});

test("gerar de novo e cancelar: recusas com mensagem própria; corrida no índice vira 400", async () => {
  let r = await acaoAdmin(sqlFalso().sql, dono, { op: "pedido_gerar_de_novo", id: "p1" });
  assert.equal(r.status, 400); assert.match(r.corpo.erro, /gerar de novo/);
  r = await acaoAdmin(sqlFalso().sql, dono, { op: "pedido_cancelar", id: "p1" });
  assert.equal(r.status, 400); assert.match(r.corpo.erro, /não pode mais ser cancelado/);
  const corrida = async () => { throw Object.assign(new Error("duplicate key"), { code: "23505" }); };
  r = await acaoAdmin(corrida, dono, { op: "pedido_gerar_de_novo", id: "p1" });
  assert.equal(r.status, 400);
  const { sql, chamadas } = sqlFalso();
  await acaoAdmin(sql, dono, { op: "pedido_gerar_de_novo", id: "p1" });
  assert.match(chamadas[0].q, /status = 'erro' or \(status = 'pronto' and .*dados->'plano'->>'pedido'/s, "pronto só se ainda é o treino atual");
});

test("sem ANTHROPIC_API_KEY: gerar de novo avisa e não muda nada", async () => {
  const chave = process.env.ANTHROPIC_API_KEY;
  try {
    for (const v of [undefined, ""]) {
      if (v === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = v;
      const g = sqlFalso(() => [{ status: "pago" }]);
      const r = await acaoAdmin(g.sql, dono, { op: "pedido_gerar_de_novo", id: "p1" });
      assert.equal(r.corpo.erro, "Chave da IA não configurada.");
      assert.equal(g.chamadas.length, 0);
    }
  } finally {
    process.env.ANTHROPIC_API_KEY = chave;
  }
});

test("Pix manual removido: pix_confirmar e pix_nao_encontrado são operação desconhecida, sem consultar o banco", async () => {
  for (const op of ["pix_confirmar", "pix_nao_encontrado"]) {
    const { sql, chamadas } = sqlFalso(() => [{ tipo: "inicial", ativo: true, status: "pago" }]);
    const r = await acaoAdmin(sql, dono, { op, id: "p1", pix_e2e: "E" + "1".repeat(31) });
    assert.equal(r.status, 400, op);
    assert.equal(r.corpo.erro, "Operação desconhecida.");
    assert.equal(chamadas.length, 0);
  }
});

test("pedido antigo em aguardando_confirmacao (Pix manual) ainda pode ser cancelado; o resumo não conta Pix aguardando", async () => {
  const { sql, chamadas } = sqlFalso(() => [{ status: "cancelado" }]);
  assert.equal((await acaoAdmin(sql, dono, { op: "pedido_cancelar", id: "p1" })).status, 200);
  assert.match(chamadas[0].q, /status in \('aguardando_pagamento', 'aguardando_confirmacao', 'pago', 'erro'\)/);
  const r = sqlFalso(() => [{ aguardando: 1, receita_mes: 0, vencendo7d: 0 }]);
  const x = await acaoAdmin(r.sql, dono, { op: "resumo" });
  assert.equal(x.corpo.pixAguardando, undefined);
  assert.ok(!r.chamadas.some((c) => /aguardando_confirmacao/.test(c.q)));
});
