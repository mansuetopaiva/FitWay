// Tarefa diária (Vercel Cron): acesso protegido por CRON_SECRET e prazos da LGPD rodando sem alguém abrir uma tela. PGlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrir } from "./harness.mjs";
const { sql, R } = await abrir();
const cron = (await import(R + "api/cron.js?" + Math.random())).default;
const SEGREDO = "segredo-do-cron-com-bastante-tamanho-1234567890";
const chamarCron = async (authorization, method = "GET") => {
  let st = 200, corpo; const headers = authorization === undefined ? {} : { authorization };
  await cron({ method, headers }, { status(x) { st = x; return this; }, json(x) { corpo = x; return this; } });
  return { status: st, corpo };
};
const FOTOS = '{"frente":"data:image/jpeg;base64,/9j/AAAA"}';
// Datas em "dias atrás" (null = vazio).
const pedido = (id, status, { criado = 0, atualizado = 0, pago = null, gerado = null } = {}) => sql`insert into pedidos (id, email, tipo, status, valor, fotos, respostas, plano_gerado, criado, atualizado, pago_em, gerado_em)
  values (${id}, ${id + "@x.com"}, 'inicial', ${status}, 999, ${FOTOS}::jsonb, '{"objetivo":["x"]}'::jsonb, '{"nome":"Plano"}'::jsonb,
    now() - make_interval(days => ${criado}), now() - make_interval(days => ${atualizado}),
    case when ${pago}::int is null then null else now() - make_interval(days => ${pago}::int) end,
    case when ${gerado}::int is null then null else now() - make_interval(days => ${gerado}::int) end)`;
const p = async (id) => (await sql`select status, fotos, respostas, plano_gerado, valor from pedidos where id = ${id}`)[0];
const estado = async () => JSON.stringify([
  await sql`select id, status, fotos is null as sem from pedidos order by id`, await sql`select id, anexo is null as sem from chamado_mensagens order by id`,
  await sql`select chave from login_tentativas order by chave`, await sql`select id, status from chamados order by id`]);

test("sem CRON_SECRET configurado, o endpoint recusa tudo (até um Bearer vazio ou 'undefined')", async () => {
  delete process.env.CRON_SECRET;
  for (const h of [undefined, "", "Bearer ", "Bearer undefined", "Bearer " + SEGREDO]) assert.equal((await chamarCron(h)).status, 401, String(h));
});

test("com CRON_SECRET: sem token, token errado, sem 'Bearer' e token parecido são recusados e nada é limpo", async () => {
  process.env.CRON_SECRET = SEGREDO;
  await pedido("velho", "aguardando_pagamento", { criado: 40, atualizado: 40 });
  for (const h of [undefined, "", "Bearer errado", SEGREDO, "Bearer " + SEGREDO + "x", "Bearer " + SEGREDO.slice(0, -1), "bearer " + SEGREDO]) {
    const r = await chamarCron(h);
    assert.equal(r.status, 401, String(h)); assert.deepEqual(r.corpo, { erro: "Não autorizado." });
  }
  assert.equal((await p("velho")).status, "aguardando_pagamento", "nada rodou");
  assert.equal((await sql`select count(*)::int as n from admin_log where acao = 'limpeza_diaria'`)[0].n, 0);
  await sql`delete from pedidos`;
});

test("com o token certo: prazos rodam, pedidos pagos e planos ficam intactos, resumo no admin_log sem dados pessoais", async () => {
  process.env.CRON_SECRET = SEGREDO;
  await sql`insert into usuarios (email, nome, senha, dados) values ('chamado@x.com', 'Cris', 'x', '{"plano":{"nome":"Meu plano","treinos":[{"id":"A","nome":"A","exercicios":[]}]}}')`;
  await pedido("nao_pago_31d", "aguardando_pagamento", { criado: 31, atualizado: 31 });       // cancela e apaga as fotos
  await pedido("nao_pago_5d", "aguardando_pagamento", { criado: 5, atualizado: 5 });          // fica
  await pedido("pronto_91d", "pronto", { criado: 100, atualizado: 95, pago: 95, gerado: 91 }); // só as fotos saem
  await pedido("pronto_10d", "pronto", { criado: 12, atualizado: 10, pago: 12, gerado: 10 });  // fica
  await pedido("pago_8d", "pago", { criado: 9, atualizado: 8, pago: 8 });                      // travado: só as fotos saem
  await pedido("pago_3d", "pago", { criado: 4, atualizado: 3, pago: 3 });                      // fica
  await pedido("gerando_8d", "gerando", { criado: 9, atualizado: 8, pago: 9 });                // travado: só as fotos saem
  await pedido("gerando_1h", "gerando", { criado: 1, atualizado: 0, pago: 1 });                // fica
  await sql`insert into chamados (id, email, assunto, status, fechado_em) values ('c91', 'chamado@x.com', 'app', 'fechado', now() - interval '91 days'), ('c10', 'chamado@x.com', 'app', 'fechado', now() - interval '10 days')`;
  await sql`insert into chamado_mensagens (chamado_id, autor, texto, anexo) values ('c91', 'aluno', 'oi', 'data:image/jpeg;base64,/9j/AAAA'), ('c10', 'aluno', 'oi', 'data:image/jpeg;base64,/9j/AAAA')`;
  await sql`insert into login_tentativas (chave, falhas, atualizado) values ('c:velha', 3, now() - interval '2 days'), ('c:nova', 3, now() - interval '1 hour')`;
  await sql`insert into chamados (id, email, assunto, status, atualizado) values ('c8', 'chamado@x.com', 'app', 'respondido', now() - interval '8 days'), ('c3', 'chamado@x.com', 'app', 'respondido', now() - interval '3 days')`; // respondido há 8 dias: o prazo fecha; há 3: fica

  const r = await chamarCron("Bearer " + SEGREDO);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));

  assert.equal((await p("nao_pago_31d")).status, "cancelado"); assert.equal((await p("nao_pago_31d")).fotos, null);
  assert.equal((await p("nao_pago_5d")).status, "aguardando_pagamento"); assert.ok((await p("nao_pago_5d")).fotos);
  assert.equal((await p("pronto_91d")).fotos, null); assert.equal((await p("pronto_91d")).status, "pronto"); assert.deepEqual((await p("pronto_91d")).plano_gerado, { nome: "Plano" });
  assert.ok((await p("pronto_10d")).fotos);
  for (const id of ["pago_8d", "gerando_8d"]) {
    const x = await p(id);
    assert.equal(x.fotos, null, id + ": fotos apagadas");
    assert.equal(x.status, id === "pago_8d" ? "pago" : "gerando", id + ": o pedido continua pago/gerando");
    assert.equal(x.valor, 999); assert.deepEqual(x.respostas, { objetivo: ["x"] }, id + ": respostas ficam");
  }
  assert.ok((await p("pago_3d")).fotos); assert.ok((await p("gerando_1h")).fotos);
  assert.equal((await sql`select anexo from chamado_mensagens where chamado_id = 'c91'`)[0].anexo, null);
  assert.ok((await sql`select anexo from chamado_mensagens where chamado_id = 'c10'`)[0].anexo);
  assert.deepEqual((await sql`select chave from login_tentativas`).map((x) => x.chave), ["c:nova"]);
  assert.ok((await sql`select dados->'plano' as plano from usuarios where email = 'chamado@x.com'`)[0].plano, "o plano do aluno não é tocado");

  const [l] = await sql`select admin_email, alvo_email, detalhes from admin_log where acao = 'limpeza_diaria'`;
  assert.equal(l.admin_email, "cron"); assert.equal(l.alvo_email, null);
  assert.deepEqual(l.detalhes, { pedidos_cancelados: 1, fotos_90_dias: 1, fotos_travados: 2, anexos_suporte: 1, chamados_fechados: 1, tentativas_login: 1 });
  assert.equal((await sql`select status from chamados where id = 'c8'`)[0].status, "fechado"); assert.equal((await sql`select status from chamados where id = 'c3'`)[0].status, "respondido");
  assert.deepEqual(r.corpo, l.detalhes);
  assert.ok(!/@|data:image/.test(JSON.stringify(l.detalhes)), "sem dados pessoais");
});

test("idempotente: rodar de novo dá o mesmo estado e um resumo zerado", async () => {
  process.env.CRON_SECRET = SEGREDO;
  const antes = await estado();
  const r = await chamarCron("Bearer " + SEGREDO);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { pedidos_cancelados: 0, fotos_90_dias: 0, fotos_travados: 0, anexos_suporte: 0, chamados_fechados: 0, tentativas_login: 0 });
  assert.equal(await estado(), antes);
  assert.equal((await chamarCron("Bearer " + SEGREDO, "POST")).status, 405, "só GET (é o que o Vercel Cron manda)");
});

test("o vercel.json agenda uma vez por dia um caminho que existe em api/ (renomear um dos dois quebra o teste)", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const cfg = JSON.parse(readFileSync(R + "vercel.json", "utf8"));
  assert.equal(cfg.crons.length, 1);
  const [c] = cfg.crons;
  assert.ok(existsSync(R + c.path.replace(/^\//, "") + ".js"), c.path + " sem arquivo");
  assert.match(c.schedule, /^\d+ \d+ \* \* \*$/, "uma vez por dia (compatível com o plano gratuito)");
});
