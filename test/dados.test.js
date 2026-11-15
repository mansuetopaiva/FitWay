import assert from "node:assert/strict";
import test from "node:test";
import { juntar, limpar } from "../api/_dados.js";

test("limpar descarta lixo e mantém o formato", () => {
  const d = limpar({ checkins: ["2026-11-15", "x", 3, "2026-11-15"], sessoes: -1, proximo: 9, cargas: { "A:x": 20, b: "1", c: 9999 } });
  assert.deepEqual(d, { checkins: ["2026-11-15"], sessoes: 0, proximo: "B", cargas: { "A:x": 20 } });
  assert.deepEqual(limpar(null), { checkins: [], sessoes: 0, proximo: "B", cargas: {} });
});

test("juntar não perde check-ins nem sessões de outro aparelho", () => {
  const banco = { checkins: ["2026-11-14", "2026-11-15"], sessoes: 5, proximo: "C", cargas: { a: 10, b: 20 } };
  const velho = { checkins: ["2026-11-13"], sessoes: 3, proximo: "A", cargas: { a: 12 } };
  assert.deepEqual(juntar(banco, velho), {
    checkins: ["2026-11-13", "2026-11-14", "2026-11-15"], sessoes: 5, proximo: "C", cargas: { a: 12, b: 20 },
  });
  assert.equal(juntar(banco, { ...velho, sessoes: 6 }).proximo, "A");
});
