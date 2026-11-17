import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PARQ, limparRespostas, limparFotos, limparPedidos } from "../api/_pedido.js";
import { CAMPOS, TERMOS, TERMO_VERSAO, montarTermo, registrarAceite, termoFaltando } from "../api/_termo.js";
import { ENV_TERMO, comTermo } from "./_fixtures.js";
import { PRECOS } from "../api/_precos.js";
comTermo();

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

test("objetivo: um ou mais da lista, guardado na ordem da lista sem repetir; texto único (rascunho antigo) vira lista", () => {
  assert.deepEqual(limpa({ objetivo: ["Definir", "Emagrecer", "Definir"] }).respostas.objetivo, ["Emagrecer", "Definir"]);
  assert.deepEqual(limpa({ objetivo: "Definir" }).respostas.objetivo, ["Definir"]);
  for (const objetivo of [[], ["Emagrecer", "Ficar forte"], [{}], null, undefined]) assert.ok(limpa({ objetivo }).erro, JSON.stringify(objetivo));
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

test("termo: marcadores trocados pelas variáveis, nenhum sobrando no texto mostrado; versão desconhecida dá null", () => {
  assert.deepEqual(TERMOS.map((t) => t.versao), ["2026-11-16-3", "2026-11-16-2", "2026-11-16"], "a atual no topo; as anteriores continuam para consulta (a 2026-11-15 nunca foi usada)");
  assert.equal(TERMO_VERSAO, "2026-11-16-3");
  const m = TERMOS[0].modelo;
  for (const k of Object.keys(CAMPOS)) assert.ok(m.includes(`{{${k}}}`), `modelo tem {{${k}}}`);
  assert.doesNotMatch(m, /\[[^\]]*\]/, "nenhum campo entre colchetes");
  const t = montarTermo();
  assert.match(t.texto, /^TERMO DE RESPONSABILIDADE E USO/);
  assert.doesNotMatch(t.texto, /\{\{|\}\}/, "nenhum marcador sobrando");
  assert.match(t.texto, /oferecido por Fulana de Tal, 00\.000\.000\/0001-00, monta/);
  assert.match(t.texto, /pelo email contato@exemplo\.com\./);
  assert.match(t.texto, /comarca de Cidade\/UF, ressalvado/);
  assert.match(t.texto, /4\.3\. .*aguardando pagamento por mais de 30 dias.*cancelado.*fotos são apagadas/);
  assert.equal(montarTermo("2026-11-15"), null);
  assert.match(montarTermo("2026-11-16").texto, /5\.1\. O primeiro treino custa R\$ 9,99 e inclui/, "a versão anterior continua com o texto aceito");
  assert.equal(montarTermo({}), null);
});

test("termo 2026-11-16-2: só o 4.2, o 4.5 (novo), o 6.1 e o item 5 mudam (preços por meio, como foi aceito)", () => {
  const [, nova, antiga] = TERMOS.map((t) => t.modelo);
  const sem = (m) => m.replace(/5\. Pagamento e acesso[\s\S]*?(?=\n\n6\.)/, "").replace(/\n4\.2\. .*/, "").replace(/\n6\.1\. .*/, "").replace(/\n4\.5\. .*/, "");
  assert.notEqual(nova, antiga);
  assert.equal(sem(nova), sem(antiga), "o resto do texto é igual");
  assert.ok(nova.includes("\n4.2. Para isso, essas informações são enviadas à Anthropic, empresa dos Estados Unidos que fornece o serviço de inteligência artificial usado na montagem do plano, e podem ser processadas fora do Brasil. Ao pagar, meu nome e email são enviados à InfinitePay, que processa os pagamentos por Pix e cartão. Meus dados não são vendidos nem usados para publicidade.\n"), "4.2 da versão nova");
  assert.ok(nova.includes("\n6.1. Este termo pode ser atualizado. Quando isso acontecer, vou precisar aceitar a nova versão no próximo pedido de treino.\n"), "6.1 da versão nova");
  assert.match(antiga, /\n6\.1\. .*no próximo pedido\.\n/, "a versão publicada não muda");
  assert.doesNotMatch(nova, /\n4\.2\. Para isso, essas informações são enviadas ao serviço de inteligência artificial usado na montagem do plano\. Ao pagar, meu nome e email são enviados à InfinitePay, que processa os pagamentos por Pix e cartão\. Meus dados não são vendidos nem usados para publicidade\.\n/);
  assert.match(antiga, /\n4\.2\. .*Elas não são vendidas nem usadas para publicidade\.\n/, "a versão publicada não muda");
  assert.doesNotMatch(nova, /comprovante|Nubank|link de cobrança|conferência é manual|24 horas/i);
  const reais = (c) => "R$ " + (c / 100).toFixed(2).replace(".", ",");
  const item5 = nova.match(/5\. Pagamento e acesso[\s\S]*?(?=\n\n6\.)/)[0];
  assert.match(item5, /primeiro treino custa R\$ 9,99 no Pix ou R\$ 11,99 no cartão de crédito/, "o texto aceito nesta versão não muda");
  assert.match(item5, /\n5\.3\. Os pagamentos por Pix e por cartão são processados pela InfinitePay e confirmados automaticamente\. O acesso e o treino são liberados assim que o pagamento é confirmado\.\n/);
  assert.match(item5, /\n5\.4\. Pedidos sem pagamento em 30 dias são cancelados, e as fotos enviadas são apagadas\.\n/);
  assert.match(item5, /\n5\.5\. Posso desistir da compra em até 7 dias/);
});

test("termo 2026-11-16-3: igual à 2026-11-16-2, só o 5.1 e o 5.2 com preço único; os valores batem com PRECOS", () => {
  const [nova, antiga] = TERMOS.map((t) => t.modelo);
  const sem = (m) => m.replace(/\n5\.1\. .*/, "").replace(/\n5\.2\. .*/, "");
  assert.equal(sem(nova), sem(antiga));
  assert.ok(nova.includes("\n5.1. O primeiro treino custa R$ 9,99, pago por Pix ou cartão de crédito, e inclui 30 dias de acesso. Para continuar vendo o treino, pago a mensalidade de R$ 9,99 a cada 30 dias. Sem o pagamento, o treino deixa de aparecer no app até eu renovar. Meus check-ins e meu histórico continuam guardados.\n"));
  assert.ok(nova.includes("\n5.2. Depois de 8 semanas do plano, com o acesso em dia, posso pedir um novo treino por R$ 4,99.\n"));
  const reais = (c) => "R$ " + (c / 100).toFixed(2).replace(".", ",");
  const item5 = nova.match(/5\. Pagamento e acesso[\s\S]*?(?=\n\n6\.)/)[0];
  const todos = new Set(Object.values(PRECOS).map(reais));
  for (const v of item5.match(/R\$ \d+,\d\d/g)) assert.ok(todos.has(v), `${v} está em PRECOS`);
  assert.doesNotMatch(item5, /11,99|5,99/);
});

test("termo: variável faltando aparece na lista e o marcador fica visível; valor com $& não vira padrão de troca", () => {
  try {
    assert.deepEqual(termoFaltando(), []);
    process.env.TERMO_DOCUMENTO = "  ";
    delete process.env.TERMO_FORO;
    assert.deepEqual(termoFaltando(), ["TERMO_DOCUMENTO", "TERMO_FORO"]);
    assert.match(montarTermo().texto, /\{\{documento\}\}.*\{\{foro\}\}/s);
    process.env.TERMO_DOCUMENTO = "$& $1"; process.env.TERMO_FORO = "X";
    assert.match(montarTermo().texto, /oferecido por Fulana de Tal, \$& \$1, monta/);
  } finally { comTermo(); }
});

test("hash: SHA-256 do texto exato mostrado; muda quando uma variável muda", () => {
  const t = montarTermo();
  assert.match(t.hash, /^[0-9a-f]{64}$/);
  assert.equal(t.hash, createHash("sha256").update(t.texto, "utf8").digest("hex"));
  try {
    process.env.TERMO_EMAIL = "outro@exemplo.com";
    assert.notEqual(montarTermo().hash, t.hash);
  } finally { comTermo(); }
});

test("aceite do termo: recusado sem aceite, com versão antiga, com hash diferente ou com variável faltando; grava hash, hora do servidor, IP e navegador", () => {
  const h = { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Mozilla/5.0 " + "x".repeat(300) };
  const { hash } = montarTermo();
  assert.ok(registrarAceite(undefined, hash, h, AGORA).erro, "sem aceite");
  assert.ok(registrarAceite("", hash, h, AGORA).erro);
  assert.ok(registrarAceite("2026-11-15", hash, h, AGORA).erro, "versão antiga");
  assert.ok(registrarAceite({ versao: TERMO_VERSAO }, hash, h, AGORA).erro, "objeto não vale");
  assert.match(registrarAceite(TERMO_VERSAO, "0".repeat(64), h, AGORA).erro, /atualizado/, "hash de outro texto");
  assert.ok(registrarAceite(TERMO_VERSAO, undefined, h, AGORA).erro, "sem hash");
  try { delete process.env.TERMO_RESPONSAVEL; assert.ok(registrarAceite(TERMO_VERSAO, hash, h, AGORA).erro, "termo incompleto"); } finally { comTermo(); }
  const { aceite } = registrarAceite(TERMO_VERSAO, hash, h, AGORA);
  assert.deepEqual(Object.keys(aceite).sort(), ["aceito_em", "hash", "ip", "user_agent", "versao"]);
  assert.equal(aceite.hash, hash);
  assert.equal(aceite.aceito_em, AGORA.toISOString(), "hora do servidor");
  assert.equal(aceite.ip, "203.0.113.7");
  assert.equal(aceite.user_agent.length, 200);
  assert.equal(registrarAceite(TERMO_VERSAO, hash, { "x-real-ip": "198.51.100.1", "x-forwarded-for": "1.1.1.1" }, AGORA).aceite.ip, "198.51.100.1");
  assert.equal(registrarAceite(TERMO_VERSAO, hash, {}, AGORA).aceite.ip, "");
});

test("limparPedidos: fotos e comprovante de 90 dias e pedido aguardando pagamento há mais de 30 dias cancelado e sem fotos", async () => {
  const chamadas = [];
  const sql = async (partes, ...valores) => { chamadas.push({ q: partes.join("?"), valores }); return []; };
  await limparPedidos(sql, "a@x.com");
  assert.equal(chamadas.length, 2);
  const [cancela, fotos] = chamadas;
  assert.match(cancela.q, /update pedidos set status = 'cancelado', fotos = null, comprovante = null, pagador_nome = null, atualizado = now\(\)/, "termo 5.4: fotos e comprovante apagados no cancelamento");
  assert.match(cancela.q, /status = 'aguardando_pagamento' and greatest\(criado, aviso_em\) < now\(\) - interval '30 days'/, "conta do último aviso do Pix");
  assert.doesNotMatch(cancela.q, /aguardando_confirmacao/, "quem avisou o Pix nunca é cancelado pelo prazo");
  assert.match(fotos.q, /set fotos = null, comprovante = null, pagador_nome = null/);
  assert.match(fotos.q, /status = 'pronto' and coalesce\(gerado_em, pago_em\) < now\(\) - interval '90 days'/, "a mensalidade fica pronta sem gerado_em");
  assert.match(fotos.q, /status in \('cancelado', 'erro'\) and atualizado < now\(\) - interval '90 days'/);
  for (const c of chamadas) assert.deepEqual(c.valores, ["a@x.com", "a@x.com"], "só os pedidos deste usuário");
  chamadas.length = 0;
  await limparPedidos(sql, null);
  for (const c of chamadas) assert.deepEqual(c.valores, [null, null], "admin: todos");
});
