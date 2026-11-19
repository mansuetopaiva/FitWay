// Fotos dos exercícios servidas pelo próprio app (img/ex/<id>/): miniatura pequena e quadros de tamanho de tela.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IDS_FOTOS } from "../api/_treino.js";
const R = fileURLToPath(new URL("../", import.meta.url));

test("cada exercício com foto tem miniatura (até 8 KB) e os dois quadros (até 60 KB), em WebP", () => {
  for (const id of new Set(IDS_FOTOS)) for (const [arq, max] of [["t.webp", 8000], ["0.webp", 60000], ["1.webp", 60000]]) {
    const p = `${R}img/ex/${id}/${arq}`;
    assert.ok(existsSync(p), "falta " + p);
    assert.ok(statSync(p).size <= max, `${id}/${arq}: ${statSync(p).size} bytes`);
    assert.equal(readFileSync(p).subarray(8, 12).toString(), "WEBP", p);
  }
});

test("a CSP não libera mais imagens de outro domínio", () => {
  assert.ok(!/githubusercontent/.test(readFileSync(R + "index.html", "utf8")));
});
