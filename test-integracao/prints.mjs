// Prints de todas as telas em 6 larguras + medições automáticas (rolagem horizontal, alvos pequenos, texto cortado,
// conteúdo atrás da barra de baixo). Site local com o backend real sobre PGlite; nada sai da máquina.
// Rodar: node --experimental-test-module-mocks test-integracao/prints.mjs [pasta]   (padrão: test-integracao/prints)
import http from "node:http";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { abrir } from "./harness.mjs";
import { planoIA, comTermo } from "../test/_fixtures.js";

const ADMIN = "admin@exemplo.com";
process.env.ADMIN_EMAILS = ADMIN; process.env.TREINO_IA_ATIVO = "1"; process.env.INFINITEPAY_HANDLE = "exemplo"; process.env.SITE_URL = "http://localhost";
comTermo();
const { sql, chamar, R } = await abrir();
const { validarPlanoIA } = await import(R + "api/_ia.js");
const { senhaHash } = await import(R + "api/_senha.js");
const SAIDA = process.argv[2] || join(R, "test-integracao/prints");
mkdirSync(SAIDA, { recursive: true });

// Dados de exemplo: aluna com treino de IA, check-ins, um pedido aguardando pagamento e um chamado; admin.
const ana = (await chamar({ acao: "criar", nome: "Ana Exemplo", email: "ana@exemplo.com", senha: "123456" })).token;
const bia = (await chamar({ acao: "criar", nome: "Bia Nova", email: "bia@exemplo.com", senha: "123456" })).token;
const { plano } = validarPlanoIA(planoIA(), { criado: new Date().toISOString(), pedido: "P1" });
const dia = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
await sql`update usuarios set dados = ${JSON.stringify({ plano, proximo: "A", checkins: [dia(0), dia(1), dia(2), dia(5)], sessoes: 3, cargas: {} })}::jsonb,
  acesso_ate = now() + interval '20 days' where email = 'ana@exemplo.com'`;
await sql`insert into pedidos (id, email, tipo, status, valor) values ('PEX1', 'bia@exemplo.com', 'inicial', 'aguardando_pagamento', 999)`;
await chamar({ acao: "chamado_abrir", assunto: "app", texto: "Não consigo ver meu treino na aba Treinos." }, ana);
await sql`insert into usuarios (email, nome, senha) values (${ADMIN}, 'Admin', ${senhaHash("123456")})`;
const adm = (await chamar({ acao: "entrar", email: ADMIN, senha: "123456" })).token;

// Servidor: arquivos estáticos + POST /api/app no handler real.
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".json": "application/json" };
const srv = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url.startsWith("/api/app")) {
    let s = ""; for await (const c of req) s += c;
    const tk = /(?:^|;\s*)mt=([^;]*)/.exec(req.headers.cookie || "");
    const r = await chamar(JSON.parse(s || "{}"), tk && tk[1]);
    const h = { "content-type": "application/json" };
    if (r.token !== undefined) h["set-cookie"] = `mt=${r.token}; Path=/; SameSite=Strict`;
    res.writeHead(r.status, h); return res.end(JSON.stringify(r.corpo));
  }
  const p = join(R, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
  if (!p.startsWith(R) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TIPOS[extname(p)] || "application/octet-stream" }); res.end(readFileSync(p));
});
await new Promise((ok) => srv.listen(0, ok));
const BASE = `http://localhost:${srv.address().port}/`;

// Telas: [nome, conta, hash, passos opcionais na página]
const ir = (h) => async (pg) => { await pg.evaluate((x) => (location.hash = x), h); };
const TELAS = [
  ["login", null, ""], ["cadastro", null, "", async (pg) => pg.click('[data-mode="criar"]')], ["esqueci", null, "", async (pg) => pg.click("text=Esqueci a senha")],
  ["politica", null, "#/privacidade"],
  ["inicio", ana, "#/"], ["treinos", ana, "#/treinos"], ["treino-aberto", ana, "#/treino/A"], ["ranking", ana, "#/ranking"], ["perfil", ana, "#/perfil"],
  ["perfil-editar", ana, "#/perfil", async (pg) => pg.click("#editar")], ["perfil-senha", ana, "#/perfil", async (pg) => pg.click("#trocarSenha")],
  ["termo", ana, "#/termo"], ["suporte", ana, "#/suporte"], ["perfil-novo", bia, "#/perfil"], ["pagamento", bia, "#/pagamento/PEX1"],
  ["admin-usuarios", adm, "#/admin"], ["admin-usuario", adm, "#/admin/ana%40exemplo.com"], ["admin-pedidos", adm, "#/admin/pedidos"],
  ["admin-suporte", adm, "#/admin/suporte"],
];
// Formulário do pedido em cada etapa (usuária nova sem pedido: precisa tirar o pedido de exemplo antes).
const ETAPAS = [1, 2, 3, 4, 5, 6];
const LARGURAS = (process.env.PRINTS_LARGURAS || "320,375,414,768,1024,1440").split(",").map(Number); // PRINTS_LARGURAS=320,375,768 para uma rodada menor

// Medições na página: rolagem horizontal, alvos de toque < 44 px, texto que transborda, botões atrás da barra de baixo.
const medir = () => {
  // Contraste do texto (cor do texto sobre o primeiro fundo opaco acima dele), WCAG: 4,5:1 (3:1 para texto grande).
  const rgba = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const mistura = (topo, base) => ({ r: topo.r * topo.a + base.r * (1 - topo.a), g: topo.g * topo.a + base.g * (1 - topo.a), b: topo.b * topo.a + base.b * (1 - topo.a), a: 1 });
  const fundoDe = (e) => { let f = { r: 18, g: 18, b: 18, a: 1 }; const pilha = []; for (let x = e; x; x = x.parentElement) pilha.push(rgba(getComputedStyle(x).backgroundColor)); for (const c of pilha.reverse()) if (c.a > 0) f = mistura(c, f); return f; };
  const contraste = [];
  for (const e of document.querySelectorAll("#app *, #toast")) {
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const st = getComputedStyle(e), r = e.getBoundingClientRect();
    if (!r.width || st.visibility === "hidden" || e.closest("[hidden], .sr") || +st.opacity === 0) continue;
    const fundo = fundoDe(e), cor = mistura(rgba(st.color), fundo), a = lum(cor), b = lum(fundo);
    const razao = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), px = parseFloat(st.fontSize), grande = px >= 24 || (px >= 18.66 && +st.fontWeight >= 700);
    if (razao < (grande ? 3 : 4.5) && !e.matches(":disabled, [disabled]")) contraste.push(`${(e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30)} ${razao.toFixed(2)}`);
  }
  const out = { contraste, rolagemH: document.documentElement.scrollWidth > innerWidth ? document.documentElement.scrollWidth : 0, alvos: [], transborda: [], atrasDaBarra: [] };
  const nome = (e) => (e.getAttribute("aria-label") || e.textContent || e.id || e.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
  const nav = document.querySelector("nav.tabbar, .tabbar, nav");
  const topoNav = nav && getComputedStyle(nav).position === "fixed" ? nav.getBoundingClientRect().top : Infinity;
  for (const e of document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, label[for], [role=tab]")) {
    const r = e.getBoundingClientRect(), st = getComputedStyle(e);
    if (!r.width || st.visibility === "hidden" || e.closest("[hidden]") || e.closest(".sr") || e.classList.contains("sr")) continue;
    // O rótulo de um campo de texto não é alvo (o campo é); só conta o label que é o próprio botão (caixa, opção, foto).
    // Link no meio de uma frase é exceção da regra (WCAG 2.5.8): só conta o que está sozinho na linha.
    if (e.matches("a") && [...e.parentElement.childNodes].some((n) => n !== e && n.nodeType === 3 && n.textContent.trim())) continue;
    if (e.matches("label[for]")) { const alvo = document.getElementById(e.htmlFor); if (!alvo || !/^(checkbox|radio|file)$/.test(alvo.type)) continue; }
    if ((e.type === "checkbox" || e.type === "radio" || e.type === "file") && st.opacity === "0") continue;
    if (e.matches("input[type=checkbox], input[type=radio]") && e.closest("label")) continue; // o alvo é o label
    if (r.height < 44 || r.width < 44) out.alvos.push(`${nome(e)} (${Math.round(r.width)}x${Math.round(r.height)})`);
  }
  for (const e of document.querySelectorAll("#app *")) {
    if (e.children.length || !e.textContent.trim()) continue;
    if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible") out.transborda.push(nome(e));
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < -1) out.transborda.push("fora da tela: " + nome(e));
  }
  // Último elemento clicável do conteúdo, rolado até o fim: fica atrás da barra fixa?
  scrollTo(0, document.documentElement.scrollHeight);
  const cliq = [...document.querySelectorAll("#app button, #app a[href], #app input, #app textarea")].filter((e) => !nav || !nav.contains(e));
  for (const e of cliq.slice(-3)) { const r = e.getBoundingClientRect(); if (r.bottom > topoNav + 1 && r.top < innerHeight) out.atrasDaBarra.push(nome(e)); }
  scrollTo(0, 0);
  return out;
};

const browser = await chromium.launch();
const relatorio = {};
async function foto(nome, conta, hash, passo, largura) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: largura < 768 ? 740 : 900 }, deviceScaleFactor: 1, hasTouch: largura < 768 });
  if (conta) await ctx.addCookies([{ name: "mt", value: conta, url: BASE }]);
  const pg = await ctx.newPage(); const erros = [];
  pg.on("pageerror", (e) => erros.push(String(e))); pg.on("console", (m) => m.type() === "error" && erros.push(m.text()));
  await pg.goto(BASE + hash); await pg.waitForLoadState("networkidle"); await pg.waitForTimeout(300);
  if (passo) { await passo(pg); await pg.waitForLoadState("networkidle"); await pg.waitForTimeout(300); }
  const m = await pg.evaluate(medir);
  if (!process.env.PRINTS_SEM_FOTO) await pg.screenshot({ path: join(SAIDA, `${nome}-${largura}.png`), fullPage: true });
  (relatorio[nome] ||= {})[largura] = { ...m, erros };
  await ctx.close();
}
for (const [nome, conta, hash, passo] of TELAS) for (const l of LARGURAS) await foto(nome, conta, hash, passo, l);

// Formulário: Bia sem pedido aberto, preenchendo até cada etapa.
await sql`delete from pedidos where id = 'PEX1'`;
const preencher = (ate) => async (pg) => {
  await pg.waitForSelector("#pedForm");
  const cont = async () => { await pg.click("#pedForm button[type=submit]"); await pg.waitForTimeout(150); };
  const passos = [
    async () => { await pg.check('[name="objetivo"][value="Emagrecer"]'); await pg.check('[name="nivel"] >> nth=0'); await pg.fill("#p_idade", "30"); await pg.check('[name="sexo"] >> nth=0'); await pg.fill("#p_altura", "170"); await pg.fill("#p_peso", "70"); },
    async () => { await pg.check('[name="dias"] >> nth=1'); await pg.check('[name="minutos"] >> nth=1'); },
    async () => { for (let i = 0; i < 7; i++) await pg.check(`[name="parq${i}"][value="nao"]`); },
    async () => {}, async () => {},
  ];
  for (let i = 0; i < ate - 1; i++) { await passos[i](); await cont(); }
};
for (const e of ETAPAS) for (const l of LARGURAS) {
  await chamar({ acao: "eu" }, bia);
  await foto(`pedido-etapa${e}`, bia, "#/pedido/inicial", async (pg) => { await pg.evaluate(() => localStorage.clear()); await pg.reload(); await pg.waitForLoadState("networkidle"); await preencher(e)(pg); }, l);
}

writeFileSync(join(SAIDA, "medicoes.json"), JSON.stringify(relatorio, null, 1));
await browser.close(); srv.close();
console.log("prints em", SAIDA, "telas:", Object.keys(relatorio).length);
// PRINTS_ASSERT=1: vira teste de layout (npm run test:layout): alvo < 44 px, contraste abaixo do mínimo, rolagem horizontal, foco invisível, erro de console inesperado.
if (process.env.PRINTS_ASSERT) {
  const falhas = [];
  for (const [tela, ls] of Object.entries(relatorio)) for (const [l, d] of Object.entries(ls)) {
    for (const k of ["alvos", "contraste", "focoInvisivel", "semNome"]) for (const x of d[k] || []) falhas.push(`${tela}@${l} ${k}: ${x}`);
    if (d.rolagemH) falhas.push(`${tela}@${l} rolagem horizontal: ${d.rolagemH}px`);
    for (const x of d.erros.filter((e) => !/401/.test(e))) falhas.push(`${tela}@${l} console: ${x}`);
  }
  if (falhas.length) { console.error(falhas.join("\n")); console.error(falhas.length + " falha(s) de layout/acessibilidade"); process.exit(1); }
  console.log("layout: sem falhas");
}
