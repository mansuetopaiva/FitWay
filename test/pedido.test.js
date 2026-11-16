import { test } from "node:test";
import assert from "node:assert/strict";
import { PARQ, limparRespostas, limparFotos, limparPedidos } from "../api/_pedido.js";
import { TERMO, TERMOS, termoDaVersao, registrarAceite } from "../api/_termo.js";

const AGORA = new Date("2026-11-15T12:00:00Z");
const base = () => ({
  objetivo: "Emagrecer", nivel: "Iniciante: até 6 meses", idade: 30, sexo: "Feminino", altura: 165, peso: 70.5,
  dias: 3, minutos: 60, parq: [false, false, false, false, false, false, false], liberacao: false,
  lesoes: "", cirurgias: "", doencas: "", remedios: "", evitar: "", observacoes: "",
  consentimentos: { dados: true, fotos: false },
});
const limpa = (mudar = {}, opc = {}) => limparRespostas({ ...base(), ...mudar }, { temFotos: false, agora: AGORA, ...opc });

test("respostas válidas: grava só os campos conhecidos e a data dos consentimentos pelo servidor", () => {
  const { respostas, erro } = limpa({ extra: "x", consentimentos: { dados: "2020-01-01", fotos: false } });
  assert.equal(erro, "O consentimento para guardar dados de saúde é obrigatório.", "consentimento só vale como true");
  const r = limpa({ extra: "x", lesoes: "  joelho  " }).respostas;
  assert.equal(r.extra, undefined);
  assert.equal(r.lesoes, "joelho");
  assert.deepEqual(r.consentimentos, { dados: AGORA.toISOString(), fotos: null });
  assert.equal(respostas, undefined);
});

test("opções fechadas e limites numéricos", () => {
  const casos = [
    { objetivo: "Ficar forte" }, { nivel: "Profissional" }, { sexo: "Outro" },
    { idade: 17 }, { idade: 91 }, { idade: 30.5 }, { idade: "30" },
    { altura: 119 }, { altura: 231 }, { peso: 29.9 }, { peso: 300.1 }, { peso: NaN }, { peso: Infinity },
    { dias: 1 }, { dias: 7 }, { minutos: 50 }, { minutos: "60" },
  ];
  for (const c of casos) assert.ok(limpa(c).erro, JSON.stringify(c));
  for (const c of [{ idade: 18 }, { idade: 90 }, { altura: 120 }, { altura: 230 }, { peso: 30 }, { peso: 300 }, { dias: 2 }, { dias: 6 }, { minutos: 30 }, { minutos: 90 }])
    assert.ok(limpa(c).respostas, JSON.stringify(c));
});

test("textos: limite de tamanho, tipo, e caracteres de controle removidos", () => {
  assert.ok(limpa({ observacoes: "a".repeat(600) }).respostas);
  assert.ok(limpa({ observacoes: "a".repeat(601) }).erro);
  assert.ok(limpa({ lesoes: "a".repeat(301) }).erro);
  assert.ok(limpa({ remedios: 5 }).erro);
  assert.ok(limpa({ evitar: ["x"] }).erro);
  assert.equal(limpa({ observacoes: "oi\u0000\u0007 tudo\nbem" }).respostas.observacoes, "oi tudo\nbem");
});

test("PAR-Q: 7 respostas Sim/Não; qualquer Sim exige liberação médica, mesmo que o navegador mande sem ela", () => {
  assert.equal(PARQ.length, 7);
  assert.ok(limpa({ parq: [false, false, false] }).erro, "faltam perguntas");
  assert.ok(limpa({ parq: [0, 0, 0, 0, 0, 0, 0] }).erro, "só booleanos");
  assert.ok(limpa({ parq: "nao" }).erro);
  for (let i = 0; i < 7; i++) {
    const parq = Array(7).fill(false); parq[i] = true;
    const r = limpa({ parq, liberacao: false });
    assert.match(r.erro || "", /liberação médica/, `pergunta ${i + 1} sem liberação`);
    assert.ok(limpa({ parq, liberacao: "true" }).erro, `pergunta ${i + 1} com liberação como texto`);
    const ok = limpa({ parq, liberacao: true }).respostas;
    assert.deepEqual(ok.parq, parq, `pergunta ${i + 1} com liberação`);
    assert.equal(ok.liberacao, true);
  }
  assert.equal(limpa({ liberacao: true }).respostas.liberacao, false, "sem Sim, a liberação não é gravada");
});

test("peso com uma casa decimal; consentimento como texto não vale", () => {
  assert.equal(limpa({ peso: 70.55 }).respostas.peso, 70.6);
  assert.ok(limpa({ consentimentos: { dados: true, fotos: "true" } }, { temFotos: true }).erro);
});

test("consentimento de fotos: obrigatório só com foto", () => {
  assert.ok(limpa({}, { temFotos: true }).erro);
  assert.ok(limpa({ consentimentos: { dados: true, fotos: true } }, { temFotos: true }).respostas.consentimentos.fotos);
  assert.equal(limpa({ consentimentos: { dados: true, fotos: true } }).respostas.consentimentos.fotos, null, "sem foto não grava");
  assert.ok(limpa({ consentimentos: null }).erro);
  assert.ok(limparRespostas(null, { temFotos: false, agora: AGORA }).erro);
  assert.ok(limparRespostas([], { temFotos: false, agora: AGORA }).erro);
});

const jpeg = (n) => "data:image/jpeg;base64," + "A".repeat(n);

test("limparFotos: só JPEG base64, 4 chaves conhecidas, até 300 KB cada", () => {
  assert.deepEqual(limparFotos(undefined), { fotos: null });
  assert.deepEqual(limparFotos(null), { fotos: null });
  assert.deepEqual(limparFotos({}), { fotos: null });
  assert.deepEqual(limparFotos({ frente: jpeg(100), costas: jpeg(8) }), { fotos: { frente: jpeg(100), costas: jpeg(8) } });
  assert.ok(limparFotos({ frente: jpeg(400000) }).fotos, "perto de 300 KB");
  assert.ok(limparFotos({ frente: jpeg(410000) }).erro, "acima de 300 KB");
  assert.ok(limparFotos({ rosto: jpeg(8) }).erro, "chave desconhecida");
  assert.ok(limparFotos(JSON.parse(`{"__proto__": "${jpeg(8)}"}`)).erro, "__proto__ vindo do JSON");
  assert.ok(limparFotos({ frente: "data:image/png;base64,AAAA" }).erro, "PNG");
  assert.ok(limparFotos({ frente: "data:image/jpeg;base64,AA AA" }).erro, "base64 inválido");
  assert.ok(limparFotos({ frente: jpeg(8) + "\"><script>" }).erro);
  assert.ok(limparFotos({ frente: 5 }).erro);
  assert.ok(limparFotos("x").erro);
  assert.ok(limparFotos([jpeg(8)]).erro);
});

test("termo: versão atual, versões antigas consultáveis", () => {
  assert.equal(TERMO.versao, "2026-11-16");
  assert.equal(TERMOS[0], TERMO);
  assert.match(TERMO.texto, /^TERMO DE RESPONSABILIDADE E USO/);
  assert.equal(termoDaVersao("2026-11-16"), TERMO);
  assert.equal(termoDaVersao("1999-01-01"), null);
  assert.equal(termoDaVersao({}), null);
});

test("aceite do termo: recusado sem aceite ou com versão antiga; grava a hora do servidor, IP e navegador", () => {
  const h = { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Mozilla/5.0 " + "x".repeat(300) };
  assert.ok(registrarAceite(undefined, h, AGORA).erro, "sem aceite");
  assert.ok(registrarAceite("", h, AGORA).erro);
  assert.ok(registrarAceite("2025-01-01", h, AGORA).erro, "versão antiga ou inventada");
  assert.ok(registrarAceite({ versao: TERMO.versao }, h, AGORA).erro, "objeto não vale");
  const { aceite } = registrarAceite(TERMO.versao, h, AGORA);
  assert.deepEqual(Object.keys(aceite).sort(), ["aceito_em", "ip", "user_agent", "versao"]);
  assert.equal(aceite.versao, TERMO.versao);
  assert.equal(aceite.aceito_em, AGORA.toISOString(), "hora do servidor");
  assert.equal(aceite.ip, "203.0.113.7");
  assert.equal(aceite.user_agent.length, 200);
  assert.deepEqual(registrarAceite(TERMO.versao, {}, AGORA).aceite.ip, "");
});

test("limparPedidos: fotos de 90 dias e pedido aguardando pagamento há mais de 30 dias cancelado e sem fotos", async () => {
  const chamadas = [];
  const sql = async (partes, ...valores) => { chamadas.push({ q: partes.join("?"), valores }); return []; };
  await limparPedidos(sql, "a@x.com");
  assert.equal(chamadas.length, 2);
  const [cancela, fotos] = chamadas;
  assert.match(cancela.q, /update pedidos set status = 'cancelado', fotos = null, atualizado = now\(\)/);
  assert.match(cancela.q, /status = 'aguardando_pagamento' and criado < now\(\) - interval '30 days'/);
  assert.match(fotos.q, /status = 'pronto' and gerado_em < now\(\) - interval '90 days'/);
  assert.match(fotos.q, /status in \('cancelado', 'erro'\) and atualizado < now\(\) - interval '90 days'/);
  for (const c of chamadas) assert.deepEqual(c.valores, ["a@x.com", "a@x.com"], "só os pedidos deste usuário");
  chamadas.length = 0;
  await limparPedidos(sql, null);
  for (const c of chamadas) assert.deepEqual(c.valores, [null, null], "admin: todos");
});

test("termo 2026-11-16: item 4.3 fala do cancelamento em 30 dias; a versão 2026-11-15 continua consultável", () => {
  assert.equal(TERMO.versao, "2026-11-16");
  assert.match(TERMO.texto, /4\.3\. .*aguardando pagamento por mais de 30 dias.*cancelado.*fotos são apagadas/);
  const antiga = termoDaVersao("2026-11-15");
  assert.ok(antiga && antiga.texto !== TERMO.texto);
  assert.doesNotMatch(antiga.texto, /30 dias, ele é cancelado/);
  assert.deepEqual(TERMOS.map((t) => t.versao), ["2026-11-16", "2026-11-15"]);
  for (const t of TERMOS) assert.doesNotMatch(t.texto, /\[[^\]]*\]/, "nenhum campo entre colchetes");
  assert.ok(registrarAceite("2026-11-15", {}, AGORA).erro, "aceite da versão anterior é recusado");
});
