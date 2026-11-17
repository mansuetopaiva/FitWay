// Atualização automática do suporte: depois_de, mensagens novas sem recarregar, status, aviso, parar ao sair, recuo nas falhas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { abrir } from "./harness.mjs";
import { navegador } from "./navegador.mjs";
process.env.ADMIN_EMAILS = "dono@x.com";
const { sql, chamar } = await abrir();
const sha = (t) => createHash("sha256").update(t).digest("hex");
await sql`insert into usuarios (email, nome, senha) values ('dono@x.com', 'Dono', 'x')`;
const TD = "d".repeat(64);
await sql`insert into sessoes (token, email, expira) values (${sha(TD)}, 'dono@x.com', now() + interval '1 day')`;
const adm = (b) => chamar({ acao: "admin", ...b }, TD);
const conta = async (email) => (await chamar({ acao: "criar", nome: email.split("@")[0], email, senha: "123456" })).token;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test("depois_de no servidor: só as mensagens novas, só do chamado da própria conta", async () => {
  const A = await conta("ana@x.com"), B = await conta("bia@x.com");
  const id = (await chamar({ acao: "chamado_abrir", assunto: "app", texto: "1" }, A)).corpo.id;
  await chamar({ acao: "chamado_responder", id, texto: "2" }, A);
  const todas = (await chamar({ acao: "chamado", id }, A)).corpo.mensagens;
  const ult = Number(todas[0].id);
  const r = await chamar({ acao: "chamado", id, depois_de: ult }, A);
  assert.deepEqual(r.corpo.mensagens.map((m) => m.texto), ["2"]);
  assert.equal((await chamar({ acao: "chamado", id, depois_de: 0 }, B)).status, 404, "outra conta");
  assert.deepEqual((await adm({ op: "suporte_chamado", id, depois_de: Number(todas[1].id) })).corpo.mensagens, []);
});

test("aluno: resposta chega sem recarregar, sem perder o texto digitado, já lida, status atualizado; ao sair, para de consultar", async () => {
  const A = await conta("cai@x.com");
  const id = (await chamar({ acao: "chamado_abrir", assunto: "app", texto: "travou" }, A)).corpo.id;
  const vistos = [];
  const n = await navegador(async (b, t) => { vistos.push(b); return chamar(b, t); }, { hash: "#/suporte/" + id, token: A, rapido: true });
  await n.espera(() => n.$("#supResp"));
  const tit = n.$("#supTit");
  n.$("#supTexto").value = "digitando...";
  await adm({ op: "suporte_responder", id, texto: "Já vamos ver." });
  await n.espera(() => /Já vamos ver\./.test(n.texto()));
  assert.equal(n.$("#supTit"), tit, "a tela não foi redesenhada");
  assert.equal(n.$("#supTexto").value, "digitando...");
  assert.equal(n.$("#supStatus").textContent, "Respondido");
  assert.equal(n.$(".sup-conversa").getAttribute("aria-live"), "polite");
  assert.equal(n.$$ ? 0 : n.w.document.querySelectorAll(".sup-msg").length, 2);
  assert.equal((await chamar({ acao: "suporte_aviso" }, A)).corpo.naoLido, false, "chegou com a conversa aberta: lida");
  // encerrado pelo admin: a tela troca para "encerrado"
  await adm({ op: "suporte_encerrar", id });
  await n.espera(() => /Este chamado foi encerrado/.test(n.texto()));
  // sair da conversa para a consulta
  n.ir("#/perfil");
  await n.espera(() => n.$("#supCard"));
  await pausa(50);
  const antes = vistos.filter((b) => b.acao === "chamado").length;
  await pausa(600);
  assert.equal(vistos.filter((b) => b.acao === "chamado").length, antes, "nenhuma consulta depois de sair");
  assert.deepEqual(n.erros.map(String), []);
});

test("aba escondida não consulta; ao voltar, consulta na hora", async () => {
  const A = await conta("dan@x.com");
  const id = (await chamar({ acao: "chamado_abrir", assunto: "app", texto: "oi" }, A)).corpo.id;
  const vistos = [];
  const n = await navegador(async (b, t) => { vistos.push(b.acao); return chamar(b, t); }, { hash: "#/suporte/" + id, token: A, rapido: true });
  await n.espera(() => n.$("#supResp"));
  Object.defineProperty(n.w.document, "hidden", { configurable: true, get: () => true });
  n.w.document.dispatchEvent(new n.w.Event("visibilitychange"));
  await pausa(150);
  const parado = vistos.filter((a) => a === "chamado").length;
  await pausa(400);
  assert.equal(vistos.filter((a) => a === "chamado").length, parado, "escondida: nada");
  Object.defineProperty(n.w.document, "hidden", { configurable: true, get: () => false });
  n.w.document.dispatchEvent(new n.w.Event("visibilitychange"));
  await n.espera(() => vistos.filter((a) => a === "chamado").length > parado, 100);
});

test("falhas: espera 16, 32... até 60 s (em escala) e volta para 8 s quando dá certo, sem mostrar erro", async () => {
  const A = await conta("eli@x.com");
  const id = (await chamar({ acao: "chamado_abrir", assunto: "app", texto: "oi" }, A)).corpo.id;
  let falhar = false; const horas = [];
  const n = await navegador(async (b, t) => {
    if (b.acao === "chamado" && b.depois_de !== undefined) { horas.push(Date.now()); if (falhar) throw new Error("rede"); }
    return chamar(b, t);
  }, { hash: "#/suporte/" + id, token: A, rapido: true });
  await n.espera(() => n.$("#supResp"));
  await n.espera(() => horas.length >= 1);
  falhar = true; const ini = horas.length;
  await n.espera(() => horas.length >= ini + 4, 5000);
  const gaps = horas.slice(ini, ini + 4).map((h, i, a) => (i ? h - a[i - 1] : 0)).slice(1);
  assert.ok(gaps[1] > gaps[0] * 1.5 && gaps[2] > gaps[1] * 1.5, "intervalo cresce: " + gaps);
  falhar = false; const ok = horas.length;
  await n.espera(() => horas.length >= ok + 3, 5000);
  const g2 = horas[ok + 2] - horas[ok + 1];
  assert.ok(g2 < 200, "voltou para 8 s (80 ms em escala): " + g2);
  assert.doesNotMatch(n.$("#toast").textContent, /conexão|rede/i, "sem aviso de erro");
});

test("admin: mensagem do aluno chega na conversa aberta sem perder o texto; lista atualiza sozinha", async () => {
  const A = await conta("fia@x.com");
  const id = (await chamar({ acao: "chamado_abrir", assunto: "conta", texto: "primeira" }, A)).corpo.id;
  const n = await navegador(chamar, { hash: "#/admin/chamado." + id, token: TD, rapido: true });
  await n.espera(() => n.$("#chResp"));
  n.$("#chTexto").value = "rascunho do admin";
  await chamar({ acao: "chamado_responder", id, texto: "segunda" }, A);
  await n.espera(() => /segunda/.test(n.$(".adm-det .sup-conversa").textContent));
  assert.equal(n.$("#chTexto").value, "rascunho do admin");
  // status muda (aluno encerra): redesenha com Reabrir
  await chamar({ acao: "chamado_encerrar", id }, A);
  await n.espera(() => n.$("[data-ch-reabrir]"));
  // lista: chamado novo aparece sem recarregar
  n.ir("#/admin/suporte");
  await n.espera(() => n.$("#chStatus"));
  n.$("#chStatus").value = ""; n.$("#chStatus").dispatchEvent(new n.w.Event("change"));
  const B = await conta("gui@x.com");
  await chamar({ acao: "chamado_abrir", assunto: "app", texto: "novo chamado" }, B);
  await n.espera(() => /novo chamado/.test(n.$("#admLista").textContent), 3000);
  assert.deepEqual(n.erros.map(String), []);
});

test("Perfil: o aviso de resposta aparece sozinho (30 s em escala)", async () => {
  const A = await conta("hal@x.com");
  const id = (await chamar({ acao: "chamado_abrir", assunto: "app", texto: "oi" }, A)).corpo.id;
  const n = await navegador(chamar, { hash: "#/perfil", token: A, rapido: true });
  await n.espera(() => n.$("#supCard"));
  assert.ok(!n.$("#supCard .ponto"));
  await adm({ op: "suporte_responder", id, texto: "ok" });
  await n.espera(() => n.$("#supCard .ponto") && n.$("[data-aba-perfil] .ponto"), 3000);
});
