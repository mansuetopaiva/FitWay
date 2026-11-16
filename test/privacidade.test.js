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

test("política 2026-11-16-2 (suporte): só acrescenta o 2.6, os anexos no 6 e o suporte no 7", () => {
  const nova = PRIVACIDADES.find((p) => p.versao === "2026-11-16-2"), antiga = PRIVACIDADES.find((p) => p.versao === "2026-11-16");
  const L26 = "2.6. Suporte: as mensagens e imagens que você enviar nos chamados.";
  const L6 = "- Imagens anexadas aos chamados: apagadas 90 dias depois que o chamado é encerrado. As mensagens ficam enquanto você tiver conta.";
  const L7 = " Pedidos sobre seus dados também podem ser feitos pelo suporte do app, no assunto Conta e dados.";
  assert.ok(nova.modelo.includes("\n2.5. ") && nova.modelo.includes("\n" + L26 + "\n\n3. "));
  assert.match(nova.modelo, new RegExp("\\n6\\. Por quanto tempo guardamos\\n[\\s\\S]*" + L6.replace(/[.()]/g, "\\$&") + "\\n[\\s\\S]*\\n\\n7\\. "));
  assert.ok(nova.modelo.includes("Respondemos em até 15 dias." + L7 + "\n"));
  assert.equal(nova.modelo.replace("\n" + L26, "").replace("\n" + L6, "").replace(L7, ""), antiga.modelo, "o resto é igual");
  comTermo();
  assert.ok(montarPrivacidade().texto.includes(L26));
});

test("política 2026-11-16-3 (email): é a atual e só acrescenta o Google (Gmail) no item 5", () => {
  const [nova, antiga] = PRIVACIDADES;
  assert.equal(nova.versao, "2026-11-16-3"); assert.equal(PRIVACIDADE_VERSAO, "2026-11-16-3"); assert.equal(antiga.versao, "2026-11-16-2");
  const L = "- Google (Gmail), usado para enviar os emails do FitWay, como o de troca de senha; recebe o seu email e o conteúdo da mensagem.";
  const item5 = nova.modelo.match(/\n5\. Com quem compartilhamos\n[\s\S]*?\n\n6\. /)[0];
  assert.ok(item5.includes("\n" + L + "\n"));
  assert.equal(nova.modelo.replace("\n" + L, ""), antiga.modelo, "o resto é igual");
});
