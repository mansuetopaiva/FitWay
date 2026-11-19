// Contraste do texto (WCAG 2.x, razão de luminância relativa): mínimo de 4,5:1 no texto normal e 3:1 no texto grande,
// calculado a partir das cores do css/style.css, não a olho. Cada par abaixo é uma combinação de texto e fundo realmente usada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const css = readFileSync(fileURLToPath(new URL("../css/style.css", import.meta.url)), "utf8");
const token = (n) => new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`).exec(css)[1];
const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const T = Object.fromEntries(["bg", "card", "card2", "text", "muted", "green", "green-dark", "on-green", "danger"].map((n) => [n, token(n)]));

// [texto, fundo, o que é, mínimo]
const PARES = [
  [T.text, T.bg, "texto principal"], [T.text, T.card, "texto em cartão"], [T.text, T.card2, "texto em campo"],
  [T.muted, T.bg, "texto secundário no fundo"], [T.muted, T.card, "texto secundário em cartão"], [T.muted, T.card2, "texto secundário em campo/aba"],
  [T.green, T.bg, "verde sobre o fundo (links, valores)"], [T.green, T.card, "verde em cartão"], [T.green, T.card2, "verde em campo"],
  [T.danger, T.bg, "erro no fundo"], [T.danger, T.card, "erro em cartão"], [T.danger, T.card2, "erro em campo"],
  [T["on-green"], T.green, "botão principal e aba ativa"], ["#c9f7dd", T["green-dark"], "botão feito / selo ok"],
  ["#ffe08a", "#5a4300", "selo de aviso"], ["#ffb4b4", "#4a1414", "selo de erro"], ["#ffe08a", "#3a2f00", "aviso do PAR-Q"],
  ["#ffd0d0", "#4a1414", "caixa de erro do admin"], ["#ffe9b8", "#4a3a14", "aviso de saúde no suporte"], ["#cfcfcf", T.bg, "aba inativa da barra"],
  ["#111111", "#e8e8e8", "aviso (toast)"], ["#ffffff", "#c62828", "contador do admin"],
];
test("o contraste das cores de texto do app é de pelo menos 4,5:1", () => {
  const ruins = PARES.map(([t, f, nome]) => [nome, razao(t, f)]).filter(([, r]) => r < 4.5);
  assert.deepEqual(ruins.map(([n, r]) => `${n}: ${r.toFixed(2)}`), []);
});
test("a função de contraste confere com valores conhecidos (preto e branco 21:1; #767676 sobre branco 4,54:1)", () => {
  assert.ok(Math.abs(razao("#000000", "#ffffff") - 21) < 0.01);
  assert.ok(Math.abs(razao("#767676", "#ffffff") - 4.54) < 0.01);
});
