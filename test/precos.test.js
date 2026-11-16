import { test } from "node:test";
import assert from "node:assert/strict";
import { ABERTOS, PRECOS, precoDe, linkPix, metodosDisponiveis, podePedir, efeitoDoPagamento, acessoAtivo, planoVisivel } from "../api/_precos.js";

const AGORA = new Date("2026-11-15T12:00:00Z");
const diasAtras = (n) => new Date(AGORA - n * 864e5).toISOString();
const diasDepois = (n) => new Date(+AGORA + n * 864e5).toISOString();
const treinos = [{ id: "A", nome: "A", exercicios: [["Leg press", "", 3, "10", 0, 60, ""]] }];
const ia = (criadoHa, acesso) => ({ acesso_ate: acesso, dados: { plano: { nome: "P", origem: "ia", criado: diasAtras(criadoHa), treinos } } });
const pdf = (acesso) => ({ acesso_ate: acesso, dados: { plano: { nome: "P", treinos } } });

test("PRECOS em centavos por meio, num lugar só", () => {
  assert.deepEqual(PRECOS, { pix: { inicial: 999, mensalidade: 999, novo_treino: 499 }, cartao: { inicial: 1199, mensalidade: 1199, novo_treino: 599 } });
});

test("ABERTOS inclui aguardando_confirmacao (no máximo 1 pedido aberto por pessoa)", () => {
  assert.deepEqual(ABERTOS, ["aguardando_pagamento", "aguardando_confirmacao", "pago", "gerando"]);
});

test("precoDe: meio e tipo conhecidos; o resto é undefined", () => {
  assert.equal(precoDe("pix", "novo_treino"), 499);
  assert.equal(precoDe("cartao", "inicial"), 1199);
  for (const [m, t] of [["boleto", "inicial"], ["pix", "gratis"], ["toString", "inicial"], ["pix", "toString"], ["__proto__", "inicial"], ["pix", "__proto__"], [undefined, undefined]])
    assert.equal(precoDe(m, t), undefined, `${m}/${t}`);
});

// Troca as variáveis só durante o teste e devolve como estavam.
const comEnv = (vars, fn) => {
  const antes = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const poe = (o) => { for (const [k, v] of Object.entries(o)) if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  poe(vars);
  try { fn(); } finally { poe(antes); }
};
const L999 = "https://nubank.com.br/cobrar/exemplo999", L499 = "https://nubank.com.br/cobrar/exemplo499";
const SEM_CARTAO = { INFINITEPAY_HANDLE: undefined, SITE_URL: undefined };

test("linkPix: inicial e mensalidade usam o de 9,99; novo_treino o de 4,99", () => {
  comEnv({ PIX_LINK_999: L999, PIX_LINK_499: L499 }, () => {
    assert.equal(linkPix("inicial"), L999);
    assert.equal(linkPix("mensalidade"), L999);
    assert.equal(linkPix("novo_treino"), L499);
    assert.equal(linkPix("toString"), undefined);
    assert.equal(linkPix("__proto__"), undefined);
  });
});

test("linkPix: URL fora de https://nubank.com.br/cobrar/ é recusada", () => {
  for (const ruim of ["http://nubank.com.br/cobrar/x", "https://nubank.com.br.evil.com/cobrar/x", "https://evil.com/?https://nubank.com.br/cobrar/x",
    "https://nubank.com.br/cobrar/", "https://nubank.com.br/outra/x", "https://nubank.com.br/cobrar/x y", " https://nubank.com.br/cobrar/x", "javascript:alert(1)", ""])
    comEnv({ PIX_LINK_999: ruim }, () => assert.equal(linkPix("inicial"), undefined, JSON.stringify(ruim)));
});

test("metodosDisponiveis: sem o link do valor do pedido, o Pix não aparece", () => {
  comEnv({ PIX_LINK_999: L999, PIX_LINK_499: undefined, ...SEM_CARTAO }, () => {
    assert.deepEqual(metodosDisponiveis("inicial"), ["pix"]);
    assert.deepEqual(metodosDisponiveis("mensalidade"), ["pix"]);
    assert.deepEqual(metodosDisponiveis("novo_treino"), [], "o link de 9,99 não serve para 4,99");
  });
  comEnv({ PIX_LINK_999: "https://evil.com/cobrar/x", PIX_LINK_499: L499, ...SEM_CARTAO }, () => {
    assert.deepEqual(metodosDisponiveis("inicial"), []);
    assert.deepEqual(metodosDisponiveis("novo_treino"), ["pix"]);
  });
});

test("metodosDisponiveis: cartão precisa de INFINITEPAY_HANDLE e SITE_URL; tipo desconhecido não tem meio", () => {
  comEnv({ PIX_LINK_999: L999, PIX_LINK_499: L499, INFINITEPAY_HANDLE: "exemplo", SITE_URL: "https://exemplo.app" }, () => {
    assert.deepEqual(metodosDisponiveis("inicial"), ["pix", "cartao"]);
    assert.deepEqual(metodosDisponiveis("toString"), []);
  });
  comEnv({ PIX_LINK_999: undefined, PIX_LINK_499: undefined, INFINITEPAY_HANDLE: "exemplo", SITE_URL: undefined }, () => {
    assert.deepEqual(metodosDisponiveis("inicial"), []);
  });
});

test("podePedir inicial: só sem plano de IA (PDF não conta)", () => {
  assert.ok(podePedir("inicial", { dados: {} }, AGORA, false).ok);
  assert.ok(podePedir("inicial", pdf(null), AGORA, false).ok);
  assert.ok(podePedir("inicial", ia(10, diasDepois(5)), AGORA, false).erro);
  assert.ok(podePedir("inicial", ia(10, diasAtras(5)), AGORA, false).erro, "IA vencido continua sendo plano de IA");
});

test("podePedir mensalidade: com plano de IA ativo ou vencido", () => {
  assert.ok(podePedir("mensalidade", ia(10, diasDepois(5)), AGORA, false).ok);
  assert.ok(podePedir("mensalidade", ia(10, diasAtras(5)), AGORA, false).ok);
  assert.ok(podePedir("mensalidade", ia(10, null), AGORA, false).ok);
  assert.ok(podePedir("mensalidade", pdf(diasDepois(5)), AGORA, false).erro);
  assert.ok(podePedir("mensalidade", { dados: {} }, AGORA, false).erro);
});

test("podePedir novo_treino: 56 dias ou mais e acesso ativo", () => {
  assert.ok(podePedir("novo_treino", ia(55, diasDepois(5)), AGORA, false).erro, "55 dias ainda não");
  assert.ok(podePedir("novo_treino", ia(56, diasDepois(5)), AGORA, false).ok, "56 dias pode");
  assert.ok(podePedir("novo_treino", ia(90, diasAtras(1)), AGORA, false).erro, "acesso vencido");
  assert.ok(podePedir("novo_treino", ia(90, null), AGORA, false).erro, "sem acesso");
  assert.ok(podePedir("novo_treino", pdf(diasDepois(5)), AGORA, false).erro, "PDF não é plano de IA");
  for (const criado of [undefined, "lixo", null]) {
    const u = ia(90, diasDepois(5)); u.dados.plano.criado = criado;
    assert.ok(podePedir("novo_treino", u, AGORA, false).erro, `criado ${criado}`);
  }
});

test("podePedir: pedido aberto bloqueia qualquer tipo; tipo desconhecido é recusado", () => {
  for (const tipo of ["inicial", "mensalidade", "novo_treino"])
    assert.ok(podePedir(tipo, ia(90, diasDepois(5)), AGORA, true).erro, tipo);
  assert.ok(podePedir("inicial", { dados: {} }, AGORA, true).erro);
  for (const t of ["gratis", "toString", "__proto__", "", undefined]) assert.ok(podePedir(t, { dados: {} }, AGORA, false).erro, String(t));
});

test("efeitoDoPagamento", () => {
  assert.deepEqual(efeitoDoPagamento("inicial"), { dias: 30, gerar: true });
  assert.deepEqual(efeitoDoPagamento("mensalidade"), { dias: 30, gerar: false });
  assert.deepEqual(efeitoDoPagamento("novo_treino"), { dias: 0, gerar: true });
  assert.equal(efeitoDoPagamento("toString"), undefined);
});

test("acessoAtivo: estritamente depois de agora", () => {
  assert.equal(acessoAtivo({ acesso_ate: diasDepois(1) }, AGORA), true);
  assert.equal(acessoAtivo({ acesso_ate: AGORA.toISOString() }, AGORA), false);
  assert.equal(acessoAtivo({ acesso_ate: null }, AGORA), false);
  assert.equal(acessoAtivo({ acesso_ate: new Date(+AGORA + 1000) }, AGORA), true, "aceita Date vindo do banco");
});

test("planoVisivel: IA vencido some; PDF e admin ficam sempre", () => {
  assert.ok(planoVisivel(ia(10, diasDepois(1)), AGORA));
  assert.equal(planoVisivel(ia(10, diasAtras(1)), AGORA), null);
  assert.equal(planoVisivel(ia(10, null), AGORA), null);
  assert.ok(planoVisivel(pdf(null), AGORA), "PDF sem acesso");
  assert.ok(planoVisivel({ acesso_ate: null, dados: { plano: { nome: "P", origem: "admin", treinos } } }, AGORA), "admin sem acesso");
  assert.equal(planoVisivel({ dados: {} }, AGORA), null);
});
