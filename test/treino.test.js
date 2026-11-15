import assert from "node:assert/strict";
import test from "node:test";
import { foto, lerTreino } from "../api/_treino.js";

// Trecho do texto extraído do PDF de exemplo, com as quebras de página no meio das tabelas.
const PDF = `Meu treino – Emagrecer e definir
Nov 15, 2026
Dia Treino
Segunda A – Superior (ênfase peito/costas)
Terça B – Inferior (ênfase quadríceps)
Descanso: 2–3 min nos básicos (até 4 no leg press e terra romeno); 1–2 min nos
isoladores.
Os 4 treinos
Séries indicadas = séries de trabalho das semanas 1–4. B = básico (nunca até a
falha), I = isolador/máquina.
A – Superior (ênfase peito e costas)
# Exercício (toque para ver a
execução)
Tipo Séries x
reps
Observação
1 Supino reto com halteres B 3 x 6–8 Substitui o supino com barra.
Escápulas presas no banco.
Meu treino – Emagrecer e definir
Page 2 of 8
B – Inferior (ênfase quadríceps)
# Exercício (toque para ver a
execução)
Tipo Séries x
reps
Observação
2 Barra fixa B 3 x 6–8 Se não fizer 6 reps, use puxada
frontal ou barra assistida.
3 Crucifixo na máquina ou
crossover
I 3 x 10–12
4 Remada baixa na polia
(pegada neutra)
I 3 x 10–12 Puxe retraindo as escápulas.
5 Rosca direta (barra W) I 3 x 8–10
# Exercício (toque para ver a
execução)
Tipo Séries x
reps
Observação
1 Leg press 45° B 3 x 6–8 Substitui o agachamento.
Amplitude completa sem tirar o
quadril do banco.
2 Levantamento terra
romeno
B 3 x 6–8 Coluna neutra, quadril para trás;
pare antes de arredondar as
costas.
3 Afundo no Smith B 3 x 8–10 (cada
perna)
Se não curtir, troque por leg
press unilateral.
4 Panturrilha em pé
(máquina)
I 2 x 12–15 Pausa de 1 s embaixo.
Meu treino – Emagrecer e definir
Page 3 of 8
Treino de abdômen 2 (alternativo)
# Exercício (toque para ver a
execução)
Séries x reps Observação
1 Roda abdominal (ab wheel) 3 x 6–10 Comece de joelhos.
2 Pallof press na polia 2 x 10–12
(cada lado)
Oblíquos: segure o tronco sem
girar.
Semana 1 Semana 2 Semana 3 Semana 4
Básicos (B) 3 séries, RIR 4–5 3 séries, RIR 3–4
Abdômen 6 Crunch na polia, elevação de pernas 6–10
Comece com pouco e aumente aos poucos (ex.: 3 x 20 min → 3 x 30 min → 4 x 30 min)
só se a perda de peso travar.
`;

test("lê o PDF de exemplo", () => {
  const p = lerTreino(PDF);
  assert.equal(p.nome, "Meu treino – Emagrecer e definir");
  assert.deepEqual(p.treinos.map((t) => t.nome), ["A – Superior (ênfase peito e costas)", "B – Inferior (ênfase quadríceps)"]);
  assert.deepEqual(p.treinos[0].exercicios, [
    ["Supino reto com halteres", "db:Dumbbell_Bench_Press", 3, "6–8", 0, 150, "Substitui o supino com barra. Escápulas presas no banco."],
    ["Barra fixa", "db:Pullups", 3, "6–8", 0, 150, "Se não fizer 6 reps, use puxada frontal ou barra assistida."],
    ["Crucifixo na máquina ou crossover", "db:Butterfly", 3, "10–12", 0, 90, ""],
    ["Remada baixa na polia (pegada neutra)", "db:Seated_Cable_Rows", 3, "10–12", 0, 90, "Puxe retraindo as escápulas."],
    ["Rosca direta (barra W)", "db:EZ-Bar_Curl", 3, "8–10", 0, 90, ""],
  ]);
  assert.deepEqual(p.treinos[1].exercicios.map((e) => [e[0], e[1], e[2], e[3], e[6]]), [
    ["Leg press 45°", "db:Leg_Press", 3, "6–8", "Substitui o agachamento. Amplitude completa sem tirar o quadril do banco."],
    ["Levantamento terra romeno", "db:Romanian_Deadlift", 3, "6–8", "Coluna neutra, quadril para trás; pare antes de arredondar as costas."],
    ["Afundo no Smith", "db:Smith_Single-Leg_Split_Squat", 3, "8–10", "(cada perna) Se não curtir, troque por leg press unilateral."],
    ["Panturrilha em pé (máquina)", "db:Standing_Calf_Raises", 2, "12–15", "Pausa de 1 s embaixo."],
  ]);
});

test("sem títulos de letra, cada lista numerada vira um treino", () => {
  const p = lerTreino("Ficha\n1 Supino reto 4x10\n2 Tríceps corda 3 x 12\n1 Agachamento livre 4x8\n2 Cadeira extensora 3x15\n");
  assert.deepEqual(p.treinos.map((t) => [t.id, t.nome, t.exercicios.length]), [["A", "Treino A", 2], ["B", "Treino B", 2]]);
  assert.deepEqual(p.treinos[0].exercicios[1], ["Tríceps corda", "db:Triceps_Pushdown_-_Rope_Attachment", 3, "12", 0, 60, ""]);
});

test("PDF sem exercícios não vira plano", () => {
  assert.equal(lerTreino("Faça cárdio 3 x 20 min por semana."), null);
});

test("nomes sem correspondência ficam sem foto", () => {
  assert.equal(foto("Exercício inventado"), "");
  assert.equal(foto("Flexora sentada (ou mesa flexora)"), "db:Seated_Leg_Curl");
  assert.equal(foto("Abdominal elevação de pernas"), "db:Hanging_Leg_Raise");
  assert.equal(foto("Cadeira abdutora"), "db:Thigh_Abductor");
});

test("linha com 'máx' não derruba o resto da tabela, e aceita '1.' e '1)'", () => {
  const p = lerTreino("Ficha\n1. Supino reto 3x10\n2) Barra fixa 3 x máx\n3 Rosca direta 3x10\n4 Tríceps corda 3x12\n");
  assert.deepEqual(p.treinos[0].exercicios.map((e) => [e[0], e[3]]), [["Supino reto", "10"], ["Barra fixa", "máx"], ["Rosca direta", "10"], ["Tríceps corda", "12"]]);
});

test("legenda e aquecimento não deslocam os treinos", () => {
  const p = lerTreino(`Ficha
B – básico, nunca até a falha
Aquecimento
1 Esteira 1 x 10
2 Mobilidade de ombro 2 x 10
A – Peito
1 Supino reto 3 x 10
2 Crucifixo 3 x 12
B – Pernas
1 Leg press 3 x 10
2 Cadeira extensora 3 x 12
Treino C
`);
  assert.deepEqual(p.treinos.map((t) => [t.id, t.nome, t.exercicios[0][0]]), [["A", "A – Peito", "Supino reto"], ["B", "B – Pernas", "Leg press"]]);
  assert.equal(p.treinos[1].exercicios[1][6], "");
});

// Texto real extraído de um PDF em lista: marcadores viram "l" e quadradinhos viram "n".
test("lê treino em lista com marcadores, sem números", () => {
  const p = lerTreino(`TREINO • ACADEMIA Página 1
PLANO DE TREINO
Divisão de exercícios por grupo muscular
Quadríceps e posterior nn
l Extensora — 3×10 unilateral + 3×10 normal, carga alta
l Leg press — 3×10, carga alta
Superiores nn
l Puxada aberta — 3×15
l Bíceps barra + ombro barra
l Panturrilha sentada — 4× até a falha + ombro (elevação lateral) — 3×15
TREINO • ACADEMIA Página 2
l Búlgaro — 3×10
Observação: respeite a execução correta, os intervalos e a carga adequada ao seu nível. Ajuste o treino com
orientação do profissional responsável.`);
  assert.equal(p.nome, "PLANO DE TREINO");
  assert.deepEqual(p.treinos.map((t) => t.nome), ["A – Quadríceps e posterior", "B – Superiores"]);
  assert.deepEqual(p.treinos[0].exercicios[0], ["Extensora", "db:Leg_Extensions", 3, "10", 0, 60, "unilateral + 3×10 normal, carga alta"]);
  assert.deepEqual(p.treinos[1].exercicios.map((e) => [e[0], e[1], e[2], e[3]]), [
    ["Puxada aberta", "db:Wide-Grip_Lat_Pulldown", 3, "15"],
    ["Bíceps barra + ombro barra", "db:Barbell_Curl", 3, ""],
    ["Panturrilha sentada", "db:Seated_Calf_Raise", 4, "falha"],
    ["Búlgaro", "db:Split_Squat_with_Dumbbells", 3, "10"],
  ]);
});

test("outros jeitos comuns de escrever séries", () => {
  const p = lerTreino("Treino A - Peito\n- Supino reto: 4 séries de 12\n* Crucifixo 3x10-12\n• Flexão de braço 3 x máx\nTreino B - Costas\n1) Remada curvada 4x8 a 10\n");
  assert.deepEqual(p.treinos.map((t) => [t.nome, t.exercicios.map((e) => `${e[0]} ${e[2]}x${e[3]}`)]), [
    ["A – Peito", ["Supino reto 4x12", "Crucifixo 3x10–12", "Flexão de braço 3xmáx"]],
    ["B – Costas", ["Remada curvada 4x8–10"]],
  ]);
});

test("texto corrido de e-book não vira treino", () => {
  assert.equal(lerTreino(`Volume de treino
O volume pode ser medido de algumas formas:
Pelo número total de repetições, por exemplo 3 x 10 = 30
Tipos de séries
Já as séries de 6 a 8 repetições servem para força.
Carga (KG) 100 100 100 100 105
Séries X Rep 3x8-10`), null);
});
