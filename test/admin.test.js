import assert from "node:assert/strict";
import test from "node:test";
import { OPS, acaoAdmin, ehAdmin } from "../api/_admin.js";

// sql falso: registra cada consulta e devolve linhas vazias.
function sqlFalso() {
  const chamadas = [];
  const sql = (partes, ...valores) => { chamadas.push({ partes: partes.join("?"), valores }); return Promise.resolve([]); };
  sql.transaction = (lista) => { chamadas.push({ transacao: lista.length }); return Promise.resolve([]); };
  return { sql, chamadas };
}

test("ehAdmin compara sem espaços e sem diferença de maiúsculas", () => {
  process.env.ADMIN_EMAILS = " Dono@Exemplo.com ,outro@x.com,";
  assert.equal(ehAdmin("dono@exemplo.com"), true);
  assert.equal(ehAdmin("OUTRO@x.com"), true);
  assert.equal(ehAdmin("dono@exemplo.com.br"), false);
  assert.equal(ehAdmin(""), false);
  assert.equal(ehAdmin(undefined), false);
  process.env.ADMIN_EMAILS = "";
  assert.equal(ehAdmin("dono@exemplo.com"), false);
  delete process.env.ADMIN_EMAILS;
  assert.equal(ehAdmin("dono@exemplo.com"), false);
});

test("email fora de ADMIN_EMAILS recebe 403 em todas as ops, sem nenhuma consulta", async () => {
  process.env.ADMIN_EMAILS = "dono@exemplo.com";
  for (const op of [...OPS, "inexistente", undefined]) {
    const { sql, chamadas } = sqlFalso();
    const r = await acaoAdmin(sql, { email: "intruso@exemplo.com" }, { acao: "admin", op, email: "dono@exemplo.com", admin: true });
    assert.equal(r.status, 403, `op ${op}`);
    assert.equal(chamadas.length, 0, `op ${op} consultou o banco`);
  }
});

test("admin com op desconhecida recebe 400", async () => {
  process.env.ADMIN_EMAILS = "dono@exemplo.com";
  const { sql } = sqlFalso();
  assert.equal((await acaoAdmin(sql, { email: "dono@exemplo.com" }, { op: "apagar_tudo" })).status, 400);
});
