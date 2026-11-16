// App inteiro no jsdom, falando com o servidor real (PGlite). Um cookie por navegador.
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const REPO = fileURLToPath(new URL("../", import.meta.url)), R = REPO; // raiz do repositório
export async function navegador(chamar, { hash = "", confirmar = true, token: tk = null } = {}) {
  let token = tk; const erros = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => erros.push(e)); vc.on("error", (e) => erros.push(e));
  const html = readFileSync(R + "index.html", "utf8").replace(/<meta http-equiv[^>]*>/, "").replace(/<script src[^>]*><\/script>/, "");
  const dom = new JSDOM(html, { url: "https://fitway.test/" + hash, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.confirm = () => (typeof confirmar === "function" ? confirmar() : confirmar);
      w.scrollTo = () => {};
      // Scripts baixados sob demanda (admin, pedido, pagamento): lidos do disco.
      const ap = w.Node.prototype.appendChild;
      w.Node.prototype.appendChild = function (el) {
        if (el.tagName === "SCRIPT" && el.src) { const src = new URL(el.src).pathname.slice(1); setTimeout(() => { w.eval(readFileSync(R + src, "utf8")); el.onload && el.onload(); }, 0); return el; }
        return ap.call(this, el);
      };
      w.createImageBitmap = async () => ({ width: 10, height: 10 });
      w.fetch = async (url, o) => {
        const r = await chamar(JSON.parse(o.body), token);
        if (r.token !== undefined) token = r.token || null;
        return { ok: r.status < 400, status: r.status, json: async () => r.corpo };
      };
    } });
  const w = dom.window;
  w.eval(readFileSync(R + "js/app.js", "utf8"));
  const espera = async (f, ms = 3000) => { const t = Date.now(); for (;;) { try { const v = f(); if (v) return v; } catch (e) {} if (Date.now() - t > ms) throw new Error("tempo esgotado: " + f); await new Promise((r) => setTimeout(r, 20)); } };
  const texto = () => w.document.body.textContent.replace(/\s+/g, " ");
  const $ = (s) => w.document.querySelector(s);
  const clicar = (s) => { const e = typeof s === "string" ? $(s) : s; if (!e) throw new Error("não achei " + s); e.click(); };
  const ir = (h) => { w.location.hash = h; };
  return { w, $, espera, texto, clicar, ir, erros, set token(t) { token = t; }, get token() { return token; } };
}
