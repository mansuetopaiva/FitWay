import { test } from "node:test";
import assert from "node:assert/strict";
import { criarPedido } from "../api/_pedido.js";
import { gerarSeDevido } from "../api/_ia.js";
import { TERMO_VERSAO, montarTermo } from "../api/_termo.js";
import { planoIA, comTermo } from "./_fixtures.js";
comTermo();

process.env.TREINO_IA_ATIVO = "1"; // os testes de pedido rodam com a função ligada; o caso desligado tem teste próprio
const AGORA = new Date("2026-11-15T12:00:00Z");
const H = { "x-forwarded-for": "203.0.113.7", "user-agent": "teste" };
const respostas = () => ({
  objetivo: "Definir", nivel: "Nunca treinei", idade: 40, sexo: "Masculino", altura: 180, peso: 90,
  dias: 4, minutos: 45, parq: Array(7).fill(false), liberacao: false, observacoes: "", consentimentos: { dados: true },
});

// sql falso: cada consulta é registrada; "responder" decide as linhas pela consulta.
function sqlFalso(responder = () => []) {
  const chamadas = [];
  const sql = async (partes, ...valores) => {
    const q = partes.join("?");
    chamadas.push({ q, valores });
    return responder(q, valores);
  };
  return { sql, chamadas };
}
const semAberto = (q) => (q.includes("select exists") ? [{ aberto: false }] : q.startsWith("insert into pedidos") ? [{ id: "x" }] : []);
const novo = { email: "a@x.com", acesso_ate: null, dados: {} };
const inserido = (chamadas) => chamadas.find((c) => c.q.startsWith("insert into pedidos"));

test("pedido_criar: PAR-Q com Sim sem liberação é recusado no servidor, mesmo que o navegador mande assim", async () => {
  for (let i = 0; i < 7; i++) {
    const r = respostas(); r.parq[i] = true; r.liberacao = false;
    const { sql, chamadas } = sqlFalso(semAberto);
    const x = await criarPedido(sql, novo, { tipo: "inicial", respostas: r, termo: TERMO_VERSAO, termoHash: montarTermo().hash }, H, AGORA);
    assert.equal(x.status, 400, `pergunta ${i + 1}`);
    assert.match(x.corpo.erro, /liberação médica/);
    assert.equal(inserido(chamadas), undefined, "nada gravado");
  }
});

test("pedido_criar: sem aceite, com versão antiga ou com hash de outro texto do termo é recusado", async () => {
  for (const [termo, termoHash] of [[undefined, montarTermo().hash], ["", montarTermo().hash], ["2025-01-01", montarTermo().hash], [true, montarTermo().hash], [TERMO_VERSAO, "f".repeat(64)], [TERMO_VERSAO, undefined]]) {
    const { sql, chamadas } = sqlFalso(semAberto);
    const x = await criarPedido(sql, novo, { tipo: "inicial", respostas: respostas(), termo, termoHash }, H, AGORA);
    assert.equal(x.status, 400, String(termo));
    assert.match(x.corpo.erro, /[Tt]ermo/);
    assert.equal(inserido(chamadas), undefined);
  }
});

test("pedido_criar: grava valor do servidor, aceite com a hora do servidor e respostas limpas", async () => {
  const { sql, chamadas } = sqlFalso(semAberto);
  const b = { tipo: "inicial", valor: 1, respostas: respostas(), termo: TERMO_VERSAO, termoHash: montarTermo().hash, aceito_em: "2000-01-01T00:00:00Z",
    fotos: { frente: "data:image/jpeg;base64,QUJD" } };
  b.respostas.consentimentos.fotos = true;
  const x = await criarPedido(sql, novo, b, H, AGORA);
  assert.equal(x.status, 200);
  const [id, email, tipo, valor, codigo, resp, fotos, aceite] = inserido(chamadas).valores;
  assert.equal(typeof id, "string"); assert.ok(id.length >= 16);
  assert.match(codigo, /^FW[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/, "código curto para a pessoa anotar");
  assert.match(inserido(chamadas).q, /'aguardando_pagamento'/);
  assert.doesNotMatch(inserido(chamadas).q.split("values")[0], /metodo/, "o meio fica vazio até a pessoa escolher");
  assert.deepEqual([email, tipo, valor], ["a@x.com", "inicial", 999]);
  assert.deepEqual(JSON.parse(aceite), { versao: TERMO_VERSAO, hash: montarTermo().hash, aceito_em: AGORA.toISOString(), ip: "203.0.113.7", user_agent: "teste" });
  assert.equal(JSON.parse(resp).consentimentos.fotos, AGORA.toISOString());
  assert.deepEqual(JSON.parse(fotos), b.fotos);
  assert.equal(x.corpo.pedido.fotos, undefined);
});

test("pedido_criar: mensalidade não exige termo nem formulário; novo_treino exige", async () => {
  const comIA = { email: "a@x.com", acesso_ate: new Date(+AGORA + 864e5), dados: { plano: { origem: "ia", criado: new Date(AGORA - 60 * 864e5).toISOString(), treinos: [] } } };
  let s = sqlFalso(semAberto);
  const m = await criarPedido(s.sql, comIA, { tipo: "mensalidade" }, H, AGORA);
  assert.equal(m.status, 200);
  assert.deepEqual(inserido(s.chamadas).valores.slice(3).filter((_, i) => i !== 1), [999, null, null, null], "valor do Pix provisório, sem formulário");
  s = sqlFalso(semAberto);
  assert.equal((await criarPedido(s.sql, comIA, { tipo: "novo_treino", respostas: respostas() }, H, AGORA)).status, 400, "sem termo");
  s = sqlFalso(semAberto);
  const n = await criarPedido(s.sql, comIA, { tipo: "novo_treino", respostas: respostas(), termo: TERMO_VERSAO, termoHash: montarTermo().hash }, H, AGORA);
  assert.equal(n.status, 200);
  assert.equal(inserido(s.chamadas).valores[3], 499);
});

test("pedido_criar: pedido aberto (ou corrida barrada pelo índice) dá 400; regra de tipo vem antes do formulário", async () => {
  let s = sqlFalso((q) => (q.includes("select exists") ? [{ aberto: true }] : []));
  assert.equal((await criarPedido(s.sql, novo, { tipo: "inicial", respostas: respostas(), termo: TERMO_VERSAO, termoHash: montarTermo().hash }, H, AGORA)).status, 400);
  assert.equal(inserido(s.chamadas), undefined);
  s = sqlFalso((q) => (q.includes("select exists") ? [{ aberto: false }] : [])); // insert on conflict do nothing → sem linha
  assert.equal((await criarPedido(s.sql, novo, { tipo: "inicial", respostas: respostas(), termo: TERMO_VERSAO, termoHash: montarTermo().hash }, H, AGORA)).status, 400);
  s = sqlFalso(semAberto);
  assert.equal((await criarPedido(s.sql, novo, { tipo: "mensalidade" }, H, AGORA)).status, 400, "mensalidade sem plano de IA");
  assert.equal((await criarPedido(s.sql, novo, { tipo: "vitalicio" }, H, AGORA)).status, 400);
});

// Banco falso com um pedido: o UPDATE condicional só devolve a linha para quem pegou primeiro.
function bancoComPedido(status = "pago", tentativas = 0) {
  const ped = { id: "p1", email: "a@x.com", tipo: "inicial", status, tentativas, respostas: { ...respostas(), consentimentos: {} }, fotos: null, anterior: null };
  const { sql, chamadas } = sqlFalso((q, v) => {
    if (q.includes("set status = 'gerando'")) {
      if (ped.status !== "pago") return [];
      ped.status = "gerando"; ped.tentativas++;
      return [{ ...ped }];
    }
    if (q.includes("set status = 'pronto'")) { if (ped.status === "gerando" && v[3] === ped.tentativas) ped.status = "pronto"; return []; }
    if (q.includes("then 'erro' else 'pago'")) { if (ped.status === "gerando" && v.at(-1) === ped.tentativas) ped.status = ped.tentativas >= 2 ? "erro" : "pago"; ped.erro = v[0]; return []; }
    return [];
  });
  return { sql, chamadas, ped };
}
const resposta = (json) => ({ stop_reason: "end_turn", model: "claude-sonnet-5-5", content: [{ type: "text", text: JSON.stringify(json) }] });

test("geração: duas chamadas ao mesmo tempo chamam a IA uma vez só e gravam plano e pedido numa instrução", async () => {
  const { sql, chamadas, ped } = bancoComPedido();
  let n = 0;
  const ia = async () => { n++; await new Promise((r) => setTimeout(r, 10)); return resposta(planoIA()); };
  const r = await Promise.all([gerarSeDevido(sql, "p1", { ia, agora: () => AGORA }), gerarSeDevido(sql, "p1", { ia, agora: () => AGORA })]);
  assert.equal(n, 1);
  assert.deepEqual(r.sort(), [false, true]);
  assert.equal(ped.status, "pronto");
  const grava = chamadas.find((c) => c.q.includes("set status = 'pronto'"));
  assert.match(grava.q, /^with p as \(update pedidos .*update usuarios set dados = jsonb_set/s, "pedido e plano na mesma instrução");
  const plano = JSON.parse(grava.valores[0]);
  assert.equal(plano.origem, "ia"); assert.equal(plano.pedido, "p1"); assert.equal(plano.criado, AGORA.toISOString()); assert.ok(plano.guia);
  assert.equal(grava.valores[1], "claude-sonnet-5-5", "modelo que gerou fica no pedido");
  assert.equal(await gerarSeDevido(sql, "p1", { ia }), false, "pronto não gera de novo");
  assert.equal(n, 1);
});

test("geração: falha volta para pago e, na 2ª, vira erro; recusa, corte, plano inválido e exceção contam como falha", async () => {
  const falhas = [
    async () => ({ stop_reason: "refusal", content: [] }),
    async () => ({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }),
    async () => resposta({ ...planoIA(), treinos: [] }),
    async () => { throw new Error("API 529: overloaded"); },
  ];
  for (const ia of falhas) {
    const { sql, ped } = bancoComPedido();
    assert.equal(await gerarSeDevido(sql, "p1", { ia }), false);
    assert.equal(ped.status, "pago", "1ª falha: tenta de novo na próxima consulta");
    assert.equal(await gerarSeDevido(sql, "p1", { ia }), false);
    assert.equal(ped.status, "erro");
    assert.ok(ped.erro);
  }
});

test("geração: mensalidade e pedido não pago nem chamam a IA", async () => {
  let chamou = false;
  const ia = async () => { chamou = true; };
  for (const st of ["aguardando_pagamento", "pronto", "erro", "cancelado"]) {
    const { sql } = bancoComPedido(st);
    assert.equal(await gerarSeDevido(sql, "p1", { ia }), false);
  }
  const { sql, chamadas } = sqlFalso();
  await gerarSeDevido(sql, "p1", { ia });
  const pega = chamadas.find((c) => c.q.includes("set status = 'gerando'"));
  assert.match(pega.q, /tipo <> 'mensalidade'/);
  assert.match(pega.q, /status = 'gerando' and tentativas < 2 and atualizado < now\(\) - interval '3 minutes'/, "travado só é retomado com menos de 2 tentativas");
  assert.match(chamadas[0].q, /set status = 'erro'.*tentativas >= 2 and atualizado < now\(\) - interval '3 minutes'/s, "travado com 2 tentativas vira erro antes");
  assert.equal(chamou, false);
});

test("geração: se outra chamada retomou o pedido no meio, a mais antiga não grava", async () => {
  const { sql, ped, chamadas } = bancoComPedido();
  const ia = async () => { ped.tentativas++; return resposta(planoIA()); }; // retomada enquanto esta chamada esperava a IA
  assert.equal(await gerarSeDevido(sql, "p1", { ia }), true);
  assert.equal(ped.status, "gerando", "a escrita com tentativas antigas não muda nada");
  const grava = chamadas.find((c) => c.q.includes("set status = 'pronto'"));
  assert.equal(grava.valores[3], 1, "condição usa as tentativas desta chamada");
});

test("geração: o plano anterior entra no prompt só no novo_treino", async () => {
  const anterior = { treinos: [{ id: "A", nome: "Velho", exercicios: [["Leg press"]] }] };
  for (const [tipo, espera] of [["novo_treino", true], ["inicial", false]]) {
    const { sql, ped } = bancoComPedido();
    ped.tipo = tipo; ped.anterior = anterior;
    let corpo;
    await gerarSeDevido(sql, "p1", { ia: async (b) => { corpo = b; return resposta(planoIA()); } });
    const texto = corpo.messages[0].content.at(-1).text;
    assert.equal(texto.includes("PLANO ANTERIOR") && texto.includes("A – Velho: Leg press"), espera, tipo);
  }
});

test("TREINO_IA_ATIVO: só \"1\" liga; desligado, inicial e novo_treino dão \"Em breve\" para usuário comum; mensalidade e admin seguem", async () => {
  const antes = process.env.TREINO_IA_ATIVO;
  const comIA = { email: "a@x.com", acesso_ate: new Date(+AGORA + 864e5), dados: { plano: { origem: "ia", criado: new Date(AGORA - 60 * 864e5).toISOString(), treinos: [] } } };
  const corpo = (tipo) => ({ tipo, respostas: respostas(), termo: TERMO_VERSAO, termoHash: montarTermo().hash });
  try {
    for (const v of [undefined, "", "0", "true", " 1", "1 ", "sim"]) {
      if (v === undefined) delete process.env.TREINO_IA_ATIVO; else process.env.TREINO_IA_ATIVO = v;
      for (const [tipo, u] of [["inicial", novo], ["novo_treino", comIA]]) {
        const { sql, chamadas } = sqlFalso(semAberto);
        const r = await criarPedido(sql, u, corpo(tipo), H, AGORA);
        assert.equal(r.status, 400, `${tipo} com ${JSON.stringify(v)}`);
        assert.equal(r.corpo.erro, "Em breve.");
        assert.equal(chamadas.length, 0, "recusa antes de consultar o banco");
      }
      const m = sqlFalso(semAberto);
      assert.equal((await criarPedido(m.sql, comIA, { tipo: "mensalidade" }, H, AGORA)).status, 200, "renovar continua");
      const a = sqlFalso(semAberto);
      assert.equal((await criarPedido(a.sql, novo, corpo("inicial"), H, AGORA, { admin: true })).status, 200, "admin pode pedir para testar");
    }
    process.env.TREINO_IA_ATIVO = "1";
    const s = sqlFalso(semAberto);
    assert.equal((await criarPedido(s.sql, novo, corpo("inicial"), H, AGORA)).status, 200, "ligado");
  } finally {
    if (antes === undefined) delete process.env.TREINO_IA_ATIVO; else process.env.TREINO_IA_ATIVO = antes;
  }
});

test("variável do termo faltando: pedido inicial e novo treino bloqueados mesmo com TREINO_IA_ATIVO=1 (usuário vê \"Em breve.\", admin vê qual falta); mensalidade segue", async () => {
  try {
    process.env.TERMO_EMAIL = "";
    const corpo = { tipo: "inicial", respostas: respostas(), termo: TERMO_VERSAO, termoHash: montarTermo().hash };
    let s = sqlFalso(semAberto);
    let r = await criarPedido(s.sql, novo, corpo, H, AGORA);
    assert.deepEqual([r.status, r.corpo.erro, s.chamadas.length], [400, "Em breve.", 0]);
    s = sqlFalso(semAberto);
    r = await criarPedido(s.sql, novo, corpo, H, AGORA, { admin: true });
    assert.equal(r.status, 400);
    assert.match(r.corpo.erro, /TERMO_EMAIL/, "admin sabe qual variável falta");
    assert.equal(s.chamadas.length, 0);
    const comIA = { email: "a@x.com", acesso_ate: new Date(+AGORA + 864e5), dados: { plano: { origem: "ia", criado: new Date(AGORA - 60 * 864e5).toISOString(), treinos: [] } } };
    s = sqlFalso(semAberto);
    assert.equal((await criarPedido(s.sql, comIA, { tipo: "mensalidade" }, H, AGORA)).status, 200, "renovar não depende do termo");
  } finally { comTermo(); }
});
