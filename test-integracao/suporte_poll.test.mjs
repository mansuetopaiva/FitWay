// A consulta periódica da conversa (a cada 8 s) só grava no banco quando há resposta nova do suporte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
const { sql, chamar } = await abrir();
const lido = async () => (await sql`select lido_aluno_em as t, atualizado from chamados where id = 'ch1'`)[0];
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test("consulta sem mensagem nova não grava; com resposta nova do suporte marca como lida uma vez", async () => {
  const tk = (await chamar({ acao: "criar", nome: "Ana", email: "ana@x.com", senha: "senha123" })).token;
  await sql`insert into chamados (id, email, assunto, status) values ('ch1', 'ana@x.com', 'app', 'aberto')`;
  await sql`insert into chamado_mensagens (chamado_id, autor, texto) values ('ch1', 'aluno', 'oi')`;
  // sem resposta do suporte: abrir e consultar não muda nada
  let r = await chamar({ acao: "chamado", id: "ch1" }, tk);
  assert.equal(r.status, 200); assert.equal(r.corpo.chamado.id, "ch1"); assert.equal(r.corpo.naoLido, false);
  assert.equal((await lido()).t, null, "nada a marcar como lido");
  // chega resposta do suporte: a consulta marca como lida
  await sql`insert into chamado_mensagens (chamado_id, autor, texto) values ('ch1', 'admin', 'olá')`;
  r = await chamar({ acao: "chamado", id: "ch1" }, tk);
  assert.equal(r.corpo.mensagens.length, 2); assert.equal(r.corpo.naoLido, false, "lida ao abrir");
  const marca = (await lido()).t;
  assert.ok(marca);
  // consultas seguintes, sem mensagem nova: a marca não muda (nenhuma gravação)
  const ultima = r.corpo.mensagens.at(-1).id;
  for (let i = 0; i < 3; i++) { await espera(20); r = await chamar({ acao: "chamado", id: "ch1", depois_de: ultima }, tk); assert.equal(r.status, 200); assert.equal(r.corpo.mensagens.length, 0); }
  assert.deepEqual((await lido()).t, marca, "sem mensagem nova, sem gravação");
  // outra resposta: marca de novo
  await espera(20);
  await sql`insert into chamado_mensagens (chamado_id, autor, texto) values ('ch1', 'admin', 'mais uma')`;
  r = await chamar({ acao: "chamado", id: "ch1" }, tk);
  assert.equal(r.corpo.naoLido, false);
  assert.ok(new Date((await lido()).t) > new Date(marca), "resposta nova: marcada");
  // chamado de outra conta: não acha, não grava
  const bia = (await chamar({ acao: "criar", nome: "Bia", email: "bia@x.com", senha: "senha123" })).token;
  assert.equal((await chamar({ acao: "chamado", id: "ch1" }, bia)).status, 404);
});
