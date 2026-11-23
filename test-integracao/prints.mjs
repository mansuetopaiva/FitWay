// Prints de todas as telas em 6 larguras + medições automáticas (rolagem horizontal, alvos pequenos, texto cortado,
// conteúdo atrás da barra de baixo). Site local com o backend real sobre PGlite; nada sai da máquina.
// Rodar: node --experimental-test-module-mocks test-integracao/prints.mjs [pasta]   (padrão: test-integracao/prints)
import http from "node:http";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { abrir, entrarAdmin } from "./harness.mjs";
import { planoIA, comTermo } from "../test/_fixtures.js";
import { codigo, passoDe, desbase32, decifrar } from "../api/_totp.js";

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
const adm = (await entrarAdmin(chamar, sql, ADMIN, "123456")).token; // senha + código do autenticador (2º fator obrigatório)

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
// Abre o recorte da foto de perfil no Chromium de verdade: gera um JPEG (com EXIF de orientação, se pedido), escolhe no <input> e espera a tela.
const abrirRecorte = (w, h, orient = 1, altura = 0) => async (pg) => {
  if (altura) await pg.setViewportSize({ width: pg.viewportSize().width, height: altura });
  await pg.click("#editar"); await pg.waitForSelector("#fotoArq", { state: "attached" });
  await pg.evaluate(async ([w, h, o]) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"), g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#e53935"); g.addColorStop(0.5, "#fdd835"); g.addColorStop(1, "#1e88e5");
    x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = "#000"; x.font = `${h / 5}px sans-serif`; x.fillText("F", w / 10, h / 2); // um "F" mostra se a foto está deitada
    let bytes = new Uint8Array(await (await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9))).arrayBuffer());
    if (o !== 1) { // insere o APP1 EXIF com a orientação logo depois do SOI
      const t = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0];
      const corpo = [...new TextEncoder().encode("Exif\0\0"), ...t], n = corpo.length + 2;
      bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, n >> 8, n & 255, ...corpo, ...bytes.subarray(2)]);
    }
    const dt = new DataTransfer(); dt.items.add(new File([bytes], "foto.jpg", { type: "image/jpeg" }));
    const i = document.getElementById("fotoArq"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true }));
  }, [w, h, orient]);
  await pg.waitForSelector(".recorte");
  await pg.waitForTimeout(300);
  // A foto tem de aparecer na orientação certa (retrato quando o EXIF manda girar 90°), com o decodificador real do Chromium.
  const d = await pg.evaluate(() => ({ ...document.querySelector(".recorte").dataset }));
  const [L, A] = orient >= 5 ? [h, w] : [w, h];
  if (+d.largura !== L || +d.altura !== A) { console.error(`recorte: foto ${d.largura}x${d.altura}, esperado ${L}x${A} (EXIF ${orient})`); process.exit(1); }
};

// Telas do 2º fator do admin: cada passo usa um admin novo (a ativação só acontece uma vez por conta).
let nAdm = 0;
const novoAdmin = async (ativado) => {
  const em = `df${++nAdm}@exemplo.com`;
  process.env.ADMIN_EMAILS += "," + em;
  await sql`insert into usuarios (email, nome, senha) values (${em}, 'Admin Novo', ${senhaHash("123456")})`;
  if (ativado) await entrarAdmin(chamar, sql, em, "123456");
  await sql`delete from login_tentativas`;
  return em;
};
const senhaCerta = (ativado, depois) => async (pg) => {
  const em = await novoAdmin(ativado);
  await pg.fill("#email", em); await pg.fill("#senha", "123456"); await pg.click("form .btn");
  await pg.waitForSelector("#dfCodigo");
  if (depois) await depois(pg, em);
};
// O campo com erro está inválido, focado e apontado (aria-describedby) por uma mensagem role="alert" com o texto esperado.
const erroLigado = async (pg, campo, re) => {
  await pg.waitForFunction(([c, r]) => new RegExp(r).test(document.querySelector("form .err").textContent), [campo, re.source]);
  const ruim = await pg.evaluate(([c, r]) => {
    const e = document.getElementById(c), msg = [...(e.getAttribute("aria-describedby") || "").split(" ")].map((i) => document.getElementById(i)).find((x) => x && x.classList.contains("err"));
    return [e.getAttribute("aria-invalid") !== "true" && "sem aria-invalid", !msg && "aria-describedby não aponta para a mensagem", msg && msg.getAttribute("role") !== "alert" && "mensagem sem role=alert",
      document.activeElement !== e && "foco fora do campo"].filter(Boolean);
  }, [campo, re.source]);
  if (ruim.length) { console.error(`erro do campo #${campo}: ${ruim.join("; ")}`); process.exit(1); }
};
const codigoDe = async (em) => { const [l] = await sql`select segredo_cifrado from admin_2fa where email = ${em}`; await sql`update admin_2fa set ultimo_passo = 0 where email = ${em}`; return codigo(decifrar(l.segredo_cifrado).segredo, passoDe(Date.now())); };
const ativarNaTela = async (pg) => { await pg.fill("#dfCodigo", codigo(desbase32(await pg.textContent("#dfChave")), passoDe(Date.now()))); await pg.click("#dfForm .btn"); await pg.waitForSelector("#dfCodigos"); };
const TELAS = [
  ["login", null, ""], ["cadastro", null, "", async (pg) => pg.click('[data-mode="criar"]')], ["esqueci", null, "", async (pg) => pg.click("text=Esqueci a senha")],
  ["politica", null, "#/privacidade"],
  ["inicio", ana, "#/"], ["treinos", ana, "#/treinos"], ["treino-aberto", ana, "#/treino/A"], ["ranking", ana, "#/ranking"], ["perfil", ana, "#/perfil"],
  ["perfil-editar", ana, "#/perfil", async (pg) => pg.click("#editar")], ["perfil-senha", ana, "#/perfil", async (pg) => pg.click("#trocarSenha")],
  ["termo", ana, "#/termo"], ["suporte", ana, "#/suporte"], ["perfil-novo", bia, "#/perfil"], ["pagamento", bia, "#/pagamento/PEX1"],
  ["perfil-recorte", ana, "#/perfil", abrirRecorte(1200, 800)], ["perfil-recorte-retrato-exif", ana, "#/perfil", abrirRecorte(4000, 3000, 6)],
  ["perfil-recorte-teclado", ana, "#/perfil", abrirRecorte(1200, 800, 1, 360)], // altura de 360 px: o teclado do celular tomou o resto da tela
  ["admin-usuarios", adm, "#/admin"], ["admin-usuario", adm, "#/admin/ana%40exemplo.com"], ["admin-pedidos", adm, "#/admin/pedidos"],
  ["admin-suporte", adm, "#/admin/suporte"],
  ["2fa-ativar", null, "", senhaCerta(false)],
  ["2fa-ativar-erro", null, "", senhaCerta(false, async (pg) => { await pg.click("#dfForm .btn"); await erroLigado(pg, "dfCodigo", /Digite o código/); })],
  ["2fa-recuperacao", null, "", senhaCerta(false, ativarNaTela)],
  ["2fa-codigo", null, "", senhaCerta(true)],
  ["2fa-codigo-erro", null, "", senhaCerta(true, async (pg) => { await pg.fill("#dfCodigo", "000000"); await pg.click("#dfForm .btn"); await erroLigado(pg, "dfCodigo", /Código incorreto/); })],
  ["perfil-admin", adm, "#/perfil", async (pg) => pg.waitForSelector("#dfCard")],
  ["perfil-admin-gerar", adm, "#/perfil", async (pg) => { await pg.click("#dfNovos"); await pg.click("#dfNovosForm .btn"); await erroLigado(pg, "dfSenha", /senha atual/i); }],
  ["perfil-admin-codigos", adm, "#/perfil", async (pg) => {
    await pg.click("#dfNovos"); await pg.fill("#dfSenha", "123456"); await pg.fill("#dfCodNovo", await codigoDe(ADMIN)); await pg.click("#dfNovosForm .btn"); await pg.waitForSelector("#dfCodigos");
  }],
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
  // Nome acessível: botão/link só com ícone precisa de aria-label (ou texto); campo precisa de <label> de verdade (ou aria-label).
  const semNome = [];
  for (const e of document.querySelectorAll("#app button, #app a[href], #app input:not([type=hidden]), #app select, #app textarea")) {
    if (e.closest("[hidden]") || e.closest(".sr") && !e.matches("input[type=file]")) continue;
    const tem = (e.getAttribute("aria-label") || "").trim() || (e.getAttribute("aria-labelledby") || "").trim();
    if (e.matches("button, a")) { if (!tem && !e.textContent.trim()) semNome.push(`${e.tagName.toLowerCase()}#${e.id || e.className}`); }
    else if (!tem && !(e.labels && [...e.labels].some((l) => l.textContent.trim()))) semNome.push(`${e.tagName.toLowerCase()}#${e.id || e.name}`);
  }
  // Com o recorte da foto aberto, os botões têm de estar inteiros na parte visível da tela (sem rolar): vale para o teclado do celular aberto.
  const cortados = [];
  for (const e of document.querySelectorAll(".recorte button, .recorte-palco")) { const r = e.getBoundingClientRect(); if (r.bottom > innerHeight + 0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.left < -0.5) cortados.push(`${e.id} (${Math.round(r.top)}-${Math.round(r.bottom)} de ${innerHeight})`); }
  const out = { semNome, cortados, contraste, rolagemH: document.documentElement.scrollWidth > innerWidth ? document.documentElement.scrollWidth : 0, alvos: [], transborda: [], atrasDaBarra: [] };
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
  // Teclado: Tab por tudo o que recebe foco; cada elemento precisa mostrar um indicador (contorno ou sombra; no caso de campo
  // escondido com opção desenhada ao lado, o irmão ou o label).
  if (largura === 375) {
    m.focoInvisivel = [];
    await pg.evaluate(() => document.activeElement && document.activeElement.blur());
    const vistos = new Set();
    for (let i = 0; i < 80; i++) {
      await pg.keyboard.press("Tab");
      const r = await pg.evaluate(() => {
        const e = document.activeElement; if (!e || e === document.body) return null;
        const marca = (x) => { const c = getComputedStyle(x); return (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) || c.boxShadow !== "none"; };
        let ok = marca(e);
        if (!ok && +getComputedStyle(e).opacity === 0) { const lab = e.labels && e.labels[0]; ok = marca(e.nextElementSibling || e) || (lab && marca(lab)); }
        return { nome: (e.getAttribute("aria-label") || e.textContent || e.id || e.tagName).trim().replace(/\s+/g, " ").slice(0, 40), ok, chave: e.tagName + (e.id || e.name || e.textContent.slice(0, 20)) };
      });
      if (!r) break;
      if (vistos.has(r.chave)) break; vistos.add(r.chave);
      if (!r.ok) m.focoInvisivel.push(r.nome);
    }
  }
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
  // Passar sem medir nada seria silêncio: toda tela da lista precisa ter sido medida em todas as larguras (e a medição ter rodado inteira).
  for (const [nome] of TELAS) for (const l of LARGURAS) if (!relatorio[nome] || !relatorio[nome][l] || !Array.isArray(relatorio[nome][l].alvos)) falhas.push(`${nome}@${l}: não foi medida`);
  for (const e of ETAPAS) for (const l of LARGURAS) if (!relatorio[`pedido-etapa${e}`] || !relatorio[`pedido-etapa${e}`][l]) falhas.push(`pedido-etapa${e}@${l}: não foi medida`);
  for (const [tela, ls] of Object.entries(relatorio)) for (const [l, d] of Object.entries(ls)) {
    for (const k of ["alvos", "contraste", "focoInvisivel", "semNome", "cortados"]) for (const x of d[k] || []) falhas.push(`${tela}@${l} ${k}: ${x}`);
    if (d.rolagemH) falhas.push(`${tela}@${l} rolagem horizontal: ${d.rolagemH}px`);
    for (const x of d.erros.filter((e) => !/^Failed to load resource.*\b401\b/.test(e))) falhas.push(`${tela}@${l} console: ${x}`);
  }
  if (falhas.length) { console.error(falhas.join("\n")); console.error(falhas.length + " falha(s) de layout/acessibilidade"); process.exit(1); }
  console.log("layout: sem falhas");
}
