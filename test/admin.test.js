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

// A sessão já foi consultada em api/app.js (usuarioDaSessao) para saber quem é o usuário; acaoAdmin recebe esse
// usuário pronto. O que este teste garante é que, sem ser admin, nenhum dado de admin é lido nem escrito.
test("email fora de ADMIN_EMAILS recebe 403 em todas as ops, sem consultar dados de admin", async () => {
  process.env.ADMIN_EMAILS = "dono@exemplo.com";
  for (const op of [...OPS, "inexistente", undefined]) {
    const { sql, chamadas } = sqlFalso();
    const r = await acaoAdmin(sql, { email: "intruso@exemplo.com" }, { acao: "admin", op, email: "dono@exemplo.com", admin: true });
    assert.equal(r.status, 403, `op ${op}`);
    assert.equal(chamadas.length, 0, `op ${op} consultou dados de admin`);
  }
});

test("admin com op desconhecida recebe 400", async () => {
  process.env.ADMIN_EMAILS = "dono@exemplo.com";
  const { sql } = sqlFalso();
  assert.equal((await acaoAdmin(sql, { email: "dono@exemplo.com" }, { op: "apagar_tudo" })).status, 400);
});

import { escaparLike, validarPlano } from "../api/_dados.js";
import { NOMES_FOTOS, foto } from "../api/_treino.js";

const ex = (o = {}) => [o.nome ?? "Supino reto com halteres", "qualquer", o.series ?? 3, o.reps ?? "10", o.carga ?? 20, o.descanso ?? 60, o.obs ?? ""];
const planoCom = (o = {}) => ({ nome: o.nome ?? "Meu treino", treinos: o.treinos ?? [{ id: "A", nome: "A – Peito", exercicios: o.exercicios ?? [ex()] }] });
const erro = (p) => validarPlano(p).erro;

test("validarPlano aceita um plano válido e recalcula a foto pelo nome", () => {
  const r = validarPlano(planoCom({ exercicios: [ex(), ex({ nome: "  Exercício inventado  ", reps: "falha", carga: 12.5 })] }));
  assert.equal(r.erro, undefined);
  assert.deepEqual(r.plano.treinos[0].exercicios, [
    ["Supino reto com halteres", "db:Dumbbell_Bench_Press", 3, "10", 20, 60, ""],
    ["Exercício inventado", "", 3, "falha", 12.5, 60, ""],
  ]);
});

test("validarPlano: limites passam na borda e falham um passo além", () => {
  const treinos = (n) => Array.from({ length: n }, (_, i) => ({ id: "T" + i, nome: "Treino " + i, exercicios: [ex()] }));
  assert.equal(erro(planoCom({ treinos: treinos(12) })), undefined);
  assert.match(erro(planoCom({ treinos: treinos(13) })), /12 treinos/);
  assert.match(erro(planoCom({ treinos: [] })), /pelo menos 1 treino/);
  assert.equal(erro(planoCom({ exercicios: Array(30).fill(ex()) })), undefined);
  assert.match(erro(planoCom({ exercicios: Array(31).fill(ex()) })), /30 exercícios/);
  assert.match(erro(planoCom({ exercicios: [] })), /pelo menos 1 exercício/);
  const casos = [
    ["nome", "a".repeat(70), "a".repeat(71), /nome/], ["nome", "a", "   ", /nome/],
    ["series", 1, 0, /séries/], ["series", 20, 21, /séries/], ["series", 3, 2.5, /séries/],
    ["reps", "1".repeat(12), "1".repeat(13), /repetições/],
    ["carga", 0, -1, /carga/], ["carga", 500, 500.5, /carga/],
    ["descanso", 0, -1, /descanso/], ["descanso", 600, 601, /descanso/], ["descanso", 60, 30.5, /descanso/],
    ["obs", "o".repeat(160), "o".repeat(161), /observação/],
  ];
  for (const [campo, borda, alem, msg] of casos) {
    assert.equal(erro(planoCom({ exercicios: [ex({ [campo]: borda })] })), undefined, `${campo}=${borda}`);
    assert.match(erro(planoCom({ exercicios: [ex({ [campo]: alem })] })), msg, `${campo}=${alem}`);
  }
  assert.match(erro(planoCom({ exercicios: [ex(), ex(), ex({ series: 21 })] })), /^Treino A, exercício 3: séries/);
});

test("validarPlano recusa tipos errados, ids repetidos e plano vazio", () => {
  for (const p of [null, undefined, "plano", [], {}, { nome: "x" }, { nome: "x", treinos: "A" }]) assert.ok(erro(p), JSON.stringify(p));
  const t = { id: "A", nome: "A", exercicios: [ex()] };
  assert.match(erro(planoCom({ treinos: [t, { ...t }] })), /repetido/);
  assert.match(erro(planoCom({ treinos: [{ ...t, id: "A B" }] })), /identificador/);
  assert.match(erro(planoCom({ treinos: [{ ...t, id: "<script>" }] })), /identificador/);
  assert.match(erro(planoCom({ treinos: [{ ...t, nome: "" }] })), /nome do treino/);
  assert.match(erro(planoCom({ nome: "p".repeat(81) })), /nome do plano/);
  assert.ok(erro(planoCom({ exercicios: [["Supino", "", "3", "10", 0, 60, ""]] })));
  assert.ok(erro(planoCom({ exercicios: [["Supino", "", 3, 10, 0, 60, ""]] })));
  assert.ok(erro(planoCom({ exercicios: [["Supino", "", 3, "10", null, 60, ""]] })));
  assert.ok(erro(planoCom({ exercicios: [["Supino", "", 3, "10", 0, 60]] })));
  assert.ok(erro(planoCom({ exercicios: [{ nome: "Supino" }] })));
  assert.ok(erro(planoCom({ exercicios: [ex({ carga: Infinity })] })));
});

test("escaparLike trata % _ e \\ como texto", () => {
  assert.equal(escaparLike("100%"), "100\\%");
  assert.equal(escaparLike("a_b"), "a\\_b");
  assert.equal(escaparLike("c:\\pasta"), "c:\\\\pasta");
  assert.equal(escaparLike("maria@x.com"), "maria@x.com");
});

test("cada nome sugerido no datalist cai na própria regra de foto", () => {
  assert.equal(NOMES_FOTOS.length, 115);
  assert.equal(new Set(NOMES_FOTOS).size, NOMES_FOTOS.length);
  const ids = NOMES_FOTOS.map(foto);
  assert.ok(ids.every(Boolean), "todo nome tem foto");
  // a i-ésima sugestão cai na i-ésima regra, ou seja, nenhuma regra anterior "rouba" o nome
  assert.deepEqual(NOMES_FOTOS.map((n, i) => [n, foto(n)]).filter(([, f], i) => f !== ids[i]), []);
});
