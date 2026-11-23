// api/app.js de verdade, com o banco simulado (precisa de --experimental-test-module-mocks, já no "npm test").
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { TERMO_VERSAO, montarTermo } from "../api/_termo.js";
import { comTermo } from "./_fixtures.js";
comTermo();

process.env.TREINO_IA_ATIVO = "1";
let usuario, responder = () => [];
const chamadas = [];
const sql = async (partes, ...valores) => {
  const q = partes.join("?");
  chamadas.push({ q, valores });
  if (q.includes("from sessoes s join usuarios u")) return usuario ? [{ dois_fatores: true, ...usuario }] : []; // dois_fatores: admin com o 2º fator ativado
  const r = responder(q, valores);
  // A consulta única do pedido_status (pedido aberto + últimas respostas + suporte) sempre devolve uma linha, mesmo sem pedido.
  if (q.includes("left join lateral") && !(r && r.length)) return [{ id: null, ultimas: null, suporte_nao_lido: false }];
  return r;
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
  const ultimas = { objetivo: "Definir", consentimentos: { dados: "x" } };
  responder = (q) => (q.includes("left join lateral") ? [{ id: "p1", tipo: "inicial", status: "pago", ultimas, suporte_nao_lido: false }] : []);
  chamadas.length = 0;
  const r = await chamar({ acao: "pedido_status", form: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.ultimas, null, "com pedido aberto não há novo treino");
  assert.equal(chamadas.some((c) => c.q.includes("set status = 'gerando'")), false, "form: true não gera");
  assert.equal(r.corpo.form.parq.length, 7);
  responder = (q) => (q.includes("left join lateral") ? [{ id: null, ultimas: { objetivo: "Definir", consentimentos: { dados: "x" } }, suporte_nao_lido: false }] : []);
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
  const r = await chamar({ acao: "pedido_criar", tipo: "inicial", respostas, termo: TERMO_VERSAO, termoHash: montarTermo().hash });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /liberação médica/);
  assert.equal(chamadas.some((c) => c.q.startsWith("insert into pedidos")), false);
});

test("termo: atual, versão existente e 404 para versão desconhecida, sem precisar de sessão", async () => {
  usuario = null;
  assert.deepEqual((await chamar({ acao: "termo" })).corpo, montarTermo(), "texto montado e hash");
  assert.equal((await chamar({ acao: "termo", versao: TERMO_VERSAO })).corpo.texto, montarTermo().texto);
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

test("termo com a função desligada: \"Em breve.\" para visitante e usuário comum; admin lê; ligada, é público", async () => {
  delete process.env.TREINO_IA_ATIVO;
  try {
    usuario = null;
    for (const b of [{ acao: "termo" }, { acao: "termo", versao: TERMO_VERSAO }]) {
      const r = await chamar(b);
      assert.deepEqual([r.status, r.corpo.erro, r.corpo.texto], [400, "Em breve.", undefined], "visitante");
    }
    usuario = { email: "c@x.com", nome: "Caio", dados: {}, acesso_ate: null };
    let r = await chamar({ acao: "termo" });
    assert.deepEqual([r.status, r.corpo.texto], [400, undefined], "usuário comum");
    process.env.ADMIN_EMAILS = "c@x.com";
    r = await chamar({ acao: "termo", versao: TERMO_VERSAO });
    assert.equal(r.corpo.texto, montarTermo().texto, "admin lê para conferir o aceite");
  } finally {
    process.env.TREINO_IA_ATIVO = "1";
    delete process.env.ADMIN_EMAILS;
  }
  usuario = null;
  assert.equal((await chamar({ acao: "termo" })).corpo.versao, TERMO_VERSAO, "ligada: público");
});

test("variável do termo faltando: TREINO_IA_ATIVO=1 não liga; termo e pedido \"Em breve.\" para usuário; admin vê o aviso no resumo", async () => {
  try {
    delete process.env.TERMO_RESPONSAVEL;
    usuario = { email: "d@x.com", nome: "Davi", dados: {}, acesso_ate: null };
    responder = () => [];
    const st = (await chamar({ acao: "pedido_status" })).corpo;
    assert.deepEqual([st.ativo, st.pode.inicial], [false, false]);
    assert.equal((await chamar({ acao: "termo" })).corpo.erro, "Em breve.");
    assert.equal((await chamar({ acao: "pedido_criar", tipo: "inicial" })).corpo.erro, "Em breve.");
    process.env.ADMIN_EMAILS = "d@x.com";
    responder = (q) => (q.includes("as usuarios") ? [{ usuarios: 1 }] : q.includes("as aguardando") ? [{ aguardando: 0, receita_mes: 0, vencendo7d: 0 }] : []);
    const rs = (await chamar({ acao: "admin", op: "resumo" })).corpo;
    assert.deepEqual(rs.termoFaltando, ["TERMO_RESPONSAVEL"]);
    assert.equal(rs.iaLigada, true);
    assert.deepEqual([(await chamar({ acao: "pedido_status" })).corpo.pode.inicial], [false], "nem o admin pede com o termo incompleto");
  } finally {
    comTermo();
    delete process.env.ADMIN_EMAILS;
  }
});

test("ações de pagamento pelo handler: sem sessão dá 401 sem tocar em pedidos; com sessão, o pedido é procurado pelo email da sessão", async () => {
  const { ACOES } = await import("../api/_pagamento.js");
  usuario = null;
  for (const acao of ACOES) {
    chamadas.length = 0;
    const r = await chamar({ acao, id: "p1", order_nsu: "p1", email: "outro@x.com" });
    assert.equal(r.status, 401, acao);
    assert.equal(chamadas.some((c) => /pedidos/.test(c.q) && !/^create|^alter|^do |^drop/.test(c.q)), false, acao);
  }
  usuario = { email: "a@x.com", nome: "Ana", dados: {}, acesso_ate: null };
  responder = () => [];
  chamadas.length = 0;
  const r = await chamar({ acao: "pagamento", id: "p1", email: "outro@x.com" });
  assert.equal(r.status, 404);
  assert.deepEqual(chamadas.find((c) => c.q.startsWith("select id, tipo, status, metodo")).valores, ["p1", "a@x.com"]);
});

test("Pix manual removido: pedido_metodo e pix_avisei respondem Ação desconhecida sem tocar em pedidos", async () => {
  usuario = { email: "a@x.com", nome: "Ana", dados: {}, acesso_ate: null };
  responder = () => [{ id: "p1", tipo: "inicial", status: "aguardando_pagamento" }];
  for (const acao of ["pedido_metodo", "pix_avisei"]) {
    chamadas.length = 0;
    const r = await chamar({ acao, id: "p1", metodo: "pix", pagador_nome: "Ana", comprovante: "data:image/jpeg;base64,QUJD" });
    assert.equal(r.status, 400, acao);
    assert.equal(r.corpo.erro, "Ação desconhecida.");
    assert.equal(chamadas.some((c) => /pedidos/.test(c.q) && !/^create|^alter|^do |^drop/.test(c.q)), false, acao);
  }
});

test("pedido_status: devolve meio e código do pedido (sem a mensagem do Pix manual), e os preços do Pix", async () => {
  usuario = comPlano("ia", 5, 10);
  const pedido = { id: "p1", tipo: "mensalidade", status: "aguardando_pagamento", metodo: "pix", valor: 999, codigo: "FWABCDEF" };
  responder = (q) => (q.includes("left join lateral") ? [{ ...pedido, ultimas: null, suporte_nao_lido: false }] : []);
  chamadas.length = 0;
  const r = (await chamar({ acao: "pedido_status" })).corpo;
  assert.deepEqual(r.pedido, pedido);
  assert.deepEqual(r.precos, { inicial: 999, mensalidade: 999, novo_treino: 499 });
  assert.match(chamadas.find((c) => c.q.includes("left join lateral")).q, /order by status = any\(\?\) desc/, "pedido aberto (inclui aguardando_confirmacao) vem primeiro");
});

test("privacidade: pública (sem login e com a IA desligada), sem consultar sessão", async () => {
  const { montarPrivacidade } = await import("../api/_privacidade.js");
  const ativo = process.env.TREINO_IA_ATIVO, antes = usuario;
  try {
    process.env.TREINO_IA_ATIVO = "0"; usuario = null; chamadas.length = 0;
    const r = await chamar({ acao: "privacidade" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, montarPrivacidade());
    assert.ok(!chamadas.some((c) => c.q.includes("from sessoes")), "não precisa de login");
  } finally { process.env.TREINO_IA_ATIVO = ativo; usuario = antes; }
});
