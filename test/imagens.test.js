// Imagens que o app pede: existem e são pequenas (o logo era um PNG de 374 KB, inserido só pelo JS).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
const R = fileURLToPath(new URL("../", import.meta.url));
const fontes = ["index.html", "css/style.css", ...readdirSync(R + "js").map((f) => "js/" + f)];
const pedidas = [...new Set(fontes.flatMap((f) => readFileSync(R + f, "utf8").match(/img\/[\w./-]+\.(?:png|webp|jpg|svg)/g) || []))];

test("toda imagem pedida existe; logo até 60 KB, ícones até 50 KB", () => {
  assert.ok(pedidas.length >= 3, pedidas.join());
  for (const p of pedidas) {
    if (/^img\/ex\//.test(p)) continue; // miniaturas dos exercícios: teste próprio
    const t = statSync(R + p).size;
    assert.ok(t <= (/logo/.test(p) ? 60000 : 50000), `${p}: ${t} bytes`);
  }
});

test("o logo da tela de login é baixado antes do JS pedir (preload no index.html)", () => {
  const html = readFileSync(R + "index.html", "utf8");
  const logo = pedidas.find((p) => /logo/.test(p));
  assert.ok(logo, "logo pedido");
  assert.match(html, new RegExp(`<link rel="preload" as="image" href="${logo.replace(".", "\\.")}"`));
});
