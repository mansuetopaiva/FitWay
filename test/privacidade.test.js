// Política de privacidade (api/_privacidade.js): pública, sem CPF, sem marcador sobrando.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIVACIDADES, PRIVACIDADE_VERSAO, montarPrivacidade } from "../api/_privacidade.js";
import { TERMOS } from "../api/_termo.js";
import { ENV_TERMO, comTermo } from "./_fixtures.js";

test("política: versão 2026-11-16 na lista; marcadores trocados; nenhum sobrando; nunca usa {{documento}}", () => {
  comTermo();
  assert.ok(PRIVACIDADES.some((p) => p.versao === "2026-11-16"));
  for (const p of PRIVACIDADES) assert.doesNotMatch(p.modelo, /\{\{documento\}\}/, p.versao);
  const t = montarPrivacidade();
  assert.equal(t.versao, PRIVACIDADE_VERSAO);
  assert.doesNotMatch(t.texto, /\{\{|\}\}/);
  assert.ok(t.texto.includes(`mantido por ${ENV_TERMO.TERMO_RESPONSAVEL}, que é o controlador`));
  assert.ok(t.texto.includes(`escreva para ${ENV_TERMO.TERMO_EMAIL}.`));
  assert.ok(!t.texto.includes(ENV_TERMO.TERMO_DOCUMENTO), "o documento não aparece");
  assert.match(t.texto, /^POLÍTICA DE PRIVACIDADE — FITWAY\n/);
  assert.match(t.texto, /Lei 13\.709\/2018/);
});

test("política: sem TERMO_RESPONSAVEL e TERMO_EMAIL mostra 'o responsável pelo FitWay' e nenhum email, sem quebrar", () => {
  const { TERMO_RESPONSAVEL: r, TERMO_EMAIL: e } = process.env;
  try {
    delete process.env.TERMO_RESPONSAVEL; process.env.TERMO_EMAIL = "  ";
    const t = montarPrivacidade();
    assert.doesNotMatch(t.texto, /\{\{|\}\}/);
    assert.ok(t.texto.includes("mantido pelo responsável pelo FitWay, que é o controlador"));
    assert.doesNotMatch(t.texto, /escreva para|pelo email/);
    assert.match(t.texto, /\n7\. Seus direitos\nVocê pode pedir: confirmação/);
  } finally { process.env.TERMO_RESPONSAVEL = r; process.env.TERMO_EMAIL = e; }
});

test("política: valor com $& não vira padrão de troca", () => {
  const r = process.env.TERMO_RESPONSAVEL;
  try { process.env.TERMO_RESPONSAVEL = "A $& B"; assert.ok(montarPrivacidade().texto.includes("mantido por A $& B,")); }
  finally { process.env.TERMO_RESPONSAVEL = r; }
});

test("termo 2026-11-16-2 aponta para a Política de privacidade no item 4; a versão publicada não muda", () => {
  const [nova, antiga] = TERMOS.map((t) => t.modelo);
  assert.match(nova, /\n4\.5\. .*Política de privacidade/);
  assert.doesNotMatch(antiga, /Política de privacidade/);
});
