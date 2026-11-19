// Copia as fotos de exercício usadas (IDS_FOTOS) do free-exercise-db (domínio público) para img/ex/<id>/ em tamanho de tela:
// 0.webp e 1.webp (até 480 px de largura, para exibir a 240 px em tela 2x) e t.webp (miniatura 96x96, recortada ao centro).
// Uso: node scripts/fotos-exercicios.mjs   (precisa de internet e do ffmpeg; só roda à mão, não faz parte do deploy)
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { IDS_FOTOS } from "../api/_treino.js";

const DB = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";
const SAIDA = new URL("../img/ex/", import.meta.url).pathname;
const converter = (entrada, saida, filtro, q) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", entrada, "-vf", filtro, "-c:v", "libwebp", "-quality", String(q), "-compression_level", "6", saida]);
  if (r.status !== 0) throw new Error("ffmpeg falhou em " + saida + ": " + r.stderr);
};
for (const id of [...new Set(IDS_FOTOS)]) {
  mkdirSync(SAIDA + id, { recursive: true });
  for (const q of [0, 1]) {
    const tmp = `${tmpdir()}/ex-${id}-${q}.jpg`;
    const r = await fetch(`${DB}${encodeURIComponent(id)}/${q}.jpg`);
    if (!r.ok) throw new Error(`${id}/${q}.jpg: HTTP ${r.status}`);
    writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    converter(tmp, `${SAIDA}${id}/${q}.webp`, "scale='min(480,iw)':-2:flags=lanczos", 72);
    if (q === 0) converter(tmp, `${SAIDA}${id}/t.webp`, "scale=96:96:force_original_aspect_ratio=increase:flags=lanczos,crop=96:96", 70);
    rmSync(tmp);
  }
  console.log("ok", id);
}
