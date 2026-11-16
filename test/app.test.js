// api/app.js de verdade, com o banco simulado (precisa de --experimental-test-module-mocks, já no "npm test").
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { TERMO } from "../api/_termo.js";

process.env.TREINO_IA_ATIVO = "1";
let usuario, responder = () => [];
const chamadas = [];
const sql = async (partes, ...valores) => {
  const q = partes.join("?");
  chamadas.push({ q, valores });
  if (q.includes("from sessoes s join usuarios u")) return usuario ? [usuario] : [];
  return responder(q, valores);
};
mock.module(import.meta.resolve("@neondatabase/serverless"), { exports: { neon: () => sql } });
const { default: handler } = await import("../api/app.js");

async function chamar(body, headers = {}) {
  let status = 200, corpo;
  const res = { status(s) { status = s; return this; }, json(j) { corpo = JSON.parse(JSON.stringify(j)); return this; }, setHeader() {} };
  await handler({ method: "POST", headers: { "content-type": "application/json", ...headers }, body, cookies: { mt: "a".repeat(64) } }, res);
  return { status, corpo };
}
const dia = 864e5;
const treinos = [{ id: "A", nome: "A", exercicios: [["Leg press", "", 3, "10", 0, 60, ""]] }];
const comPlano = (origem, acessoDias, criadoHa = 10) => ({
  email: "a@x.com", nome: "Ana", foto: null, grupo: null,
  acesso_ate: acessoDias === null ? null : new Date(Date.now() + acessoDias * dia),
  dados: { checkins: [], sessoes: 0, proximo: "A", cargas: {}, plano: { nome: "P", ...(origem ? { origem } : {}), criado: new Date(Date.now() - criadoHa * dia).toISOString(), treinos } },
});

test("plano de IA vencido não sai do servidor: eu, salvar, treino remover e pedido_status", async () => {
  usuario = comPlano("ia", -1);
  responder = (q) => (q.startsWith("update usuarios set dados = (") ? [{ dados: usuario.dados }] : []);
  assert.equal((await chamar({ acao: "eu" })).corpo.dados.plano, undefined, "eu");
  assert.equal((await chamar({ acao: "salvar", dados: {} })).corpo.dados.plano, undefined, "salvar");
  const st = await chamar({ acao: "pedido_status" });
  assert.equal(st.corpo.plano, null, "pedido_status");
  assert.equal(st.corpo.temPlanoIA, true, "o Perfil ainda sabe que existe um plano para renovar");
  assert.equal(st.corpo.pode.mensalidade, true);
  assert.equal(st.corpo.pode.novo_treino, false);
  usuario = comPlano("ia", 5);
  assert.equal((await chamar({ acao: "eu" })).corpo.dados.plano.nome, "P", "acesso ativo: aparece");
  for (const origem of [null, "admin"]) {
    usuario = comPlano(origem, null);
    assert.equal((await chamar({ acao: "eu" })).corpo.dados.plano.nome, "P", `${origem || "pdf"} sem acesso: aparece`);
  }
});

test("pedido_status: últimas respostas sem os consentimentos; geração não roda ao abrir o formulário", async () => {
  usuario = comPlano("ia", 5, 60);
  responder = (q) => (q.startsWith("select respostas from pedidos") ? [{ respostas: { objetivo: "Definir", consentimentos: { dados: "x" } } }]
    : q.startsWith("select id, tipo, status") ? [{ id: "p1", tipo: "inicial", status: "pago" }] : []);
  chamadas.length = 0;
  const r = await chamar({ acao: "pedido_status", form: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.ultimas, null, "com pedido aberto não há novo treino");
  assert.equal(chamadas.some((c) => c.q.includes("set status = 'gerando'")), false, "form: true não gera");
  assert.equal(r.corpo.form.parq.length, 7);
  responder = (q) => (q.startsWith("select respostas from pedidos") ? [{ respostas: { objetivo: "Definir", consentimentos: { dados: "x" } } }] : []);
  const s = await chamar({ acao: "pedido_status" });
  assert.equal(s.corpo.pode.novo_treino, true);
  assert.deepEqual(s.corpo.ultimas, { objetivo: "Definir" });
  assert.equal(s.corpo.form, undefined);
  assert.equal(JSON.stringify(s.corpo).includes("fotos"), false);
});

test("pedido_criar pelo handler: PAR-Q com Sim sem liberação é recusado com 400 (409 é só troca de conta)", async () => {
  usuario = { email: "a@x.com", nome: "Ana", dados: {}, acesso_ate: null };
  responder = (q) => (q.includes("select exists") ? [{ aberto: false }] : []);
  chamadas.length = 0;
  const respostas = { objetivo: "Definir", nivel: "Nunca treinei", idade: 40, sexo: "Masculino", altura: 180, peso: 90, dias: 4, minutos: 45,
    parq: [true, false, false, false, false, false, false], liberacao: false, consentimentos: { dados: true } };
  const r = await chamar({ acao: "pedido_criar", tipo: "inicial", respostas, termo: TERMO.versao });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /liberação médica/);
  assert.equal(chamadas.some((c) => c.q.startsWith("insert into pedidos")), false);
});

test("termo: atual, versão existente e 404 para versão desconhecida, sem precisar de sessão", async () => {
  usuario = null;
  assert.equal((await chamar({ acao: "termo" })).corpo.versao, TERMO.versao);
  assert.equal((await chamar({ acao: "termo", versao: TERMO.versao })).corpo.texto, TERMO.texto);
  assert.equal((await chamar({ acao: "termo", versao: "1999-01-01" })).status, 404);
  assert.equal((await chamar({ acao: "pedido_status" })).status, 401);
});

test("TREINO_IA_ATIVO desligado: pedido_status esconde inicial e novo treino para usuário comum; renovar e ver o plano de IA seguem; admin vê tudo", async () => {
  delete process.env.TREINO_IA_ATIVO;
  try {
    responder = () => [];
    usuario = comPlano("ia", 5, 60);
    let r = (await chamar({ acao: "pedido_status" })).corpo;
    assert.deepEqual([r.ativo, r.pode.inicial, r.pode.novo_treino, r.pode.mensalidade], [false, false, false, true]);
    assert.equal(r.plano.nome, "P", "treino de IA que já existe continua visível");
    assert.equal(r.ultimas, null);
    usuario = { email: "b@x.com", nome: "Bia", dados: {}, acesso_ate: null };
    r = (await chamar({ acao: "pedido_status" })).corpo;
    assert.equal(r.pode.inicial, false);
    const c = await chamar({ acao: "pedido_criar", tipo: "inicial" });
    assert.deepEqual([c.status, c.corpo.erro], [400, "Em breve."]);
    process.env.ADMIN_EMAILS = "b@x.com";
    usuario = { email: "b@x.com", nome: "Bia", dados: {}, acesso_ate: null };
    r = (await chamar({ acao: "pedido_status" })).corpo;
    assert.deepEqual([r.ativo, r.pode.inicial], [true, true], "admin vê para testar");
  } finally {
    process.env.TREINO_IA_ATIVO = "1";
    delete process.env.ADMIN_EMAILS;
  }
});
