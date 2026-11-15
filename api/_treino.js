import { extractText, getDocumentProxy } from "unpdf";

// Lê o texto de um PDF de treino com regras fixas (sem IA) e monta o plano no formato de js/data.js.
// Espera linhas numeradas com "séries x repetições", como "1 Supino reto com halteres B 3 x 6–8 Observação".

const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Nome em português -> exercício do free-exercise-db (domínio público). A primeira regra que casar vence,
// então as mais específicas ficam antes. Nome que não casar fica sem foto.
const FOTOS = [
  // peito
  [/supino.*inclinad.*smith/, "Smith_Machine_Incline_Bench_Press", "Supino inclinado no Smith"],
  [/supino.*declinad.*smith/, "Smith_Machine_Decline_Press", "Supino declinado no Smith"],
  [/supino.*smith/, "Smith_Machine_Bench_Press", "Supino reto no Smith"],
  [/supino.*inclinad.*halter/, "Incline_Dumbbell_Press", "Supino inclinado com halteres"],
  [/supino.*declinad.*halter/, "Decline_Dumbbell_Bench_Press", "Supino declinado com halteres"],
  [/supino.*halter/, "Dumbbell_Bench_Press", "Supino reto com halteres"],
  [/supino.*inclinad.*maquina/, "Leverage_Incline_Chest_Press", "Supino inclinado na máquina"],
  [/supino.*declinad.*maquina/, "Leverage_Decline_Chest_Press", "Supino declinado na máquina"],
  [/supino.*maquina/, "Machine_Bench_Press", "Supino reto na máquina"],
  [/supino.*inclinad/, "Barbell_Incline_Bench_Press_-_Medium_Grip", "Supino inclinado com barra"],
  [/supino.*declinad/, "Decline_Barbell_Bench_Press", "Supino declinado com barra"],
  [/supino.*fechad/, "Close-Grip_Barbell_Bench_Press", "Supino fechado"],
  [/supino/, "Barbell_Bench_Press_-_Medium_Grip", "Supino reto com barra"],
  [/(crucifixo|voador|peck).*invers/, "Reverse_Machine_Flyes", "Crucifixo inverso na máquina"],
  [/crucifixo.*inclinad/, "Incline_Dumbbell_Flyes", "Crucifixo inclinado com halteres"],
  [/crucifixo.*(maquina|peck)|peck ?deck|voador/, "Butterfly", "Voador (peck deck)"],
  [/cross ?over|crucifixo.*(polia|cabo)/, "Cable_Crossover", "Crossover na polia"],
  [/crucifixo/, "Dumbbell_Flyes", "Crucifixo reto com halteres"],
  [/flexao.*(braco|solo)|push ?up/, "Pushups", "Flexão de braço"],
  [/pull ?over/, "Straight-Arm_Dumbbell_Pullover", "Pullover com halter"],
  // tríceps (antes de "pulldown" e "paralela")
  [/triceps.*frances.*(polia|corda|cabo)/, "Cable_Rope_Overhead_Triceps_Extension", "Tríceps francês na polia"],
  [/triceps.*frances/, "Standing_Dumbbell_Triceps_Extension", "Tríceps francês com halter"],
  [/triceps.*corda/, "Triceps_Pushdown_-_Rope_Attachment", "Tríceps corda"],
  [/triceps.*testa/, "EZ-Bar_Skullcrusher", "Tríceps testa"],
  [/triceps.*(coice|kickback|para tras)/, "Tricep_Dumbbell_Kickback", "Tríceps coice"],
  [/triceps.*maquina/, "Machine_Triceps_Extension", "Tríceps na máquina"],
  [/triceps.*banco/, "Bench_Dips", "Tríceps banco"],
  [/triceps/, "Triceps_Pushdown", "Tríceps pulley"],
  [/paralela|mergulho/, "Dips_-_Chest_Version", "Mergulho nas paralelas"],
  // costas
  [/barra fixa.*supinad|chin ?up/, "Chin-Up", "Barra fixa supinada"],
  [/barra fixa|pull ?up/, "Pullups", "Barra fixa"],
  [/puxada.*unilateral/, "One_Arm_Lat_Pulldown", "Puxada unilateral na polia"],
  [/puxada.*(triangulo|neutra|fechad)/, "V-Bar_Pulldown", "Puxada com triângulo"],
  [/puxada.*supinad/, "Underhand_Cable_Pulldowns", "Puxada supinada"],
  [/puxada.*(atras|nuca)/, "Wide-Grip_Pulldown_Behind_The_Neck", "Puxada por trás da nuca"],
  [/pull ?down|puxada.*braco.*estendido/, "Straight-Arm_Pulldown", "Pulldown com braços estendidos"],
  [/puxada|pulley/, "Wide-Grip_Lat_Pulldown", "Puxada frontal"],
  [/remada.*alta/, "Upright_Barbell_Row", "Remada alta"],
  [/remada.*(baixa|sentad|polia|cabo)/, "Seated_Cable_Rows", "Remada baixa na polia"],
  [/remada.*cavalinho|barra t\b/, "T-Bar_Row_with_Handle", "Remada cavalinho"],
  [/remada.*unilateral|serrote/, "One-Arm_Dumbbell_Row", "Remada unilateral (serrote)"],
  [/remada.*(apoiad|inclinad)/, "Dumbbell_Incline_Row", "Remada apoiada no banco inclinado"],
  [/remada.*(maquina|articulad)/, "Leverage_Iso_Row", "Remada na máquina"],
  [/remada.*halter/, "Bent_Over_Two-Dumbbell_Row", "Remada curvada com halteres"],
  [/remada/, "Bent_Over_Barbell_Row", "Remada curvada com barra"],
  [/face ?pull/, "Face_Pull", "Face pull"],
  [/encolhimento/, "Dumbbell_Shrug", "Encolhimento com halteres"],
  [/hiperextens|lombar/, "Hyperextensions_Back_Extensions", "Hiperextensão lombar"],
  // ombros
  [/arnold/, "Arnold_Dumbbell_Press", "Desenvolvimento Arnold"],
  [/desenvolvimento.*smith/, "Smith_Machine_Overhead_Shoulder_Press", "Desenvolvimento no Smith"],
  [/desenvolvimento.*maquina/, "Machine_Shoulder_Military_Press", "Desenvolvimento na máquina"],
  [/desenvolvimento.*halter/, "Dumbbell_Shoulder_Press", "Desenvolvimento com halteres"],
  [/desenvolvimento|militar/, "Seated_Barbell_Military_Press", "Desenvolvimento militar com barra"],
  [/elevacao.*lateral.*(polia|cabo)/, "Standing_Low-Pulley_Deltoid_Raise", "Elevação lateral na polia"],
  [/elevacao.*lateral/, "Side_Lateral_Raise", "Elevação lateral com halteres"],
  [/elevacao.*frontal.*(polia|cabo)/, "Front_Cable_Raise", "Elevação frontal na polia"],
  [/elevacao.*frontal/, "Front_Dumbbell_Raise", "Elevação frontal com halteres"],
  // bíceps
  [/(rosca|biceps).*martelo/, "Hammer_Curls", "Rosca martelo"],
  [/biceps.*scott/, "Preacher_Curl", "Bíceps no banco Scott"],
  [/biceps.*(polia|cabo)/, "Standing_Biceps_Cable_Curl", "Bíceps na polia"],
  [/biceps.*concentrad/, "Concentration_Curls", "Bíceps concentrado"],
  [/biceps.*halter/, "Dumbbell_Bicep_Curl", "Bíceps com halteres"],
  [/biceps/, "Barbell_Curl", "Bíceps com barra"],
  [/rosca.*scott.*maquina/, "Machine_Preacher_Curls", "Rosca Scott na máquina"],
  [/rosca.*scott/, "Preacher_Curl", "Rosca Scott"],
  [/rosca.*concentrad/, "Concentration_Curls", "Rosca concentrada"],
  [/rosca.*punho/, "Palms-Up_Barbell_Wrist_Curl_Over_A_Bench", "Rosca punho"],
  [/rosca.*invers/, "Reverse_Barbell_Curl", "Rosca inversa"],
  [/rosca.*bayesian/, "Standing_One-Arm_Cable_Curl", "Rosca bayesian na polia"],
  [/rosca.*(polia|cabo)/, "Standing_Biceps_Cable_Curl", "Rosca na polia"],
  [/rosca.*inclinad/, "Incline_Dumbbell_Curl", "Rosca inclinada com halteres"],
  [/rosca.*alternad/, "Dumbbell_Alternate_Bicep_Curl", "Rosca alternada"],
  [/rosca.*(barra w|\bw\b|ez)/, "EZ-Bar_Curl", "Rosca com barra W"],
  [/rosca.*halter/, "Dumbbell_Bicep_Curl", "Rosca com halteres"],
  [/rosca/, "Barbell_Curl", "Rosca direta com barra"],
  // abdômen (antes de "elevação de pernas" e "máquina")
  [/roda abdominal|ab wheel/, "Ab_Roller", "Roda abdominal"],
  [/(abdominal|crunch).*(polia|cabo)/, "Cable_Crunch", "Abdominal na polia"],
  [/abdominal.*maquina/, "Ab_Crunch_Machine", "Abdominal na máquina"],
  [/abdominal.*declinad/, "Decline_Crunch", "Abdominal declinado"],
  [/abdominal.*obliqu/, "Oblique_Crunches", "Abdominal oblíquo"],
  [/elevacao.*pernas?|abdominal.*infra/, "Hanging_Leg_Raise", "Elevação de pernas"],
  [/pallof/, "Pallof_Press", "Pallof press"],
  [/prancha.*lateral/, "Side_Bridge", "Prancha lateral"],
  [/prancha/, "Plank", "Prancha"],
  [/abdominal|crunch/, "Crunches", "Abdominal reto"],
  // pernas e glúteo
  [/elevacao.*pelvica|hip ?thrust/, "Barbell_Hip_Thrust", "Elevação pélvica"],
  [/ponte/, "Butt_Lift_Bridge", "Ponte de glúteo"],
  [/panturrilha.*leg/, "Calf_Press_On_The_Leg_Press_Machine", "Panturrilha no leg press"],
  [/panturrilha.*sentad/, "Seated_Calf_Raise", "Panturrilha sentada"],
  [/panturrilha/, "Standing_Calf_Raises", "Panturrilha em pé"],
  [/leg ?press/, "Leg_Press", "Leg press"],
  [/extensora/, "Leg_Extensions", "Cadeira extensora"],
  [/(flexao|flexora).*posterior.*(polia|cabo)|flexora.*(polia|cabo)/, "Standing_Leg_Curl", "Flexora na polia"],
  [/flexora.*sentad|cadeira flexora/, "Seated_Leg_Curl", "Cadeira flexora"],
  [/flexora.*em pe/, "Standing_Leg_Curl", "Flexora em pé"],
  [/flexora/, "Lying_Leg_Curls", "Mesa flexora"],
  [/abdutora/, "Thigh_Abductor", "Cadeira abdutora"],
  [/adutora/, "Thigh_Adductor", "Cadeira adutora"],
  [/romeno|\brdl\b/, "Romanian_Deadlift", "Levantamento terra romeno"],
  [/stiff/, "Stiff-Legged_Barbell_Deadlift", "Stiff com barra"],
  [/terra/, "Barbell_Deadlift", "Levantamento terra"],
  [/afundo.*smith/, "Smith_Single-Leg_Split_Squat", "Afundo no Smith"],
  [/bulgaro/, "Split_Squat_with_Dumbbells", "Agachamento búlgaro"],
  [/afundo|avanco|passada/, "Dumbbell_Lunges", "Afundo com halteres"],
  [/agachamento.*smith/, "Smith_Machine_Squat", "Agachamento no Smith"],
  [/hack/, "Hack_Squat", "Agachamento hack"],
  [/agachamento.*frontal/, "Front_Barbell_Squat", "Agachamento frontal"],
  [/agachamento.*sumo/, "Plie_Dumbbell_Squat", "Agachamento sumô"],
  [/goblet/, "Goblet_Squat", "Agachamento goblet"],
  [/agachamento.*halter/, "Dumbbell_Squat", "Agachamento com halteres"],
  [/agachamento/, "Barbell_Squat", "Agachamento livre"],
  [/(gluteo|coice).*(polia|cabo)/, "One-Legged_Cable_Kickback", "Glúteo na polia"],
  [/good ?morning|bom dia/, "Stiff_Leg_Barbell_Good_Morning", "Good morning"],
  [/\bombro/, "Dumbbell_Shoulder_Press", "Ombro com halteres"],
  [/gluteo|coice/, "Glute_Kickback", "Glúteo 4 apoios"],
];
export const IDS_FOTOS = FOTOS.map((r) => r[1]);
// Um nome em português por regra, com foto garantida (test/admin.test.js confere que cada um cai na própria regra).
export const NOMES_FOTOS = FOTOS.map((r) => r[2]);

// Em "Crucifixo na máquina ou crossover" e "Bíceps na polia + ombro" vale o primeiro exercício.
export function foto(nome) {
  const n = semAcento(nome.split(/\s+\(?ou\s+|\s*\+\s*/i)[0]);
  const r = FOTOS.find(([re]) => re.test(n));
  return r ? "db:" + r[1] : "";
}

const SERIES = /(?:\s([BI]))?\s(\d{1,2})\s*[xX×]\s*(\d{1,3}(?:\s*[–—-]\s*\d{1,3})?(?!\d)|[Mm][aáAÁ][xX]\w*|[Ff]alha)/g;
const NUMERO = /(?:^|\s)(\d{1,2})[.)º]?\s+(?=\p{Lu})/gu;
const TITULO_TREINO = /(?:^|\n)[ \t]*((?:Treino\s+)?([A-Z])\s*[–—:-]\s+(\p{L}[^\n]{1,70}))/gu;
const DESCANSO = { B: 150, I: 90 }; // B = básico, I = isolador; sem tipo, 60 s

// PDF em base64 (vindo do navegador) -> { plano } ou { status, erro }. Usado pela ação "treino" e pelo admin.
// Limites contra arquivo hostil: 3 MB, 30 páginas e 200 mil caracteres de texto.
export async function lerPdf(base64) {
  const pdf = typeof base64 === "string" && base64.length >= 100 && base64.length <= 4200000 ? Buffer.from(base64, "base64") : null;
  if (!pdf || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return { status: 400, erro: "Envie um arquivo PDF de até 3 MB." };
  let lido;
  try {
    const doc = await getDocumentProxy(new Uint8Array(pdf));
    if (doc.numPages > 30) return { status: 400, erro: "O PDF pode ter no máximo 30 páginas." };
    lido = (await extractText(doc, { mergePages: true })).text;
  } catch (e) { return { status: 422, erro: "Não consegui abrir este PDF." }; }
  const plano = lerTreino(lido.slice(0, 200000));
  if (!plano) return { status: 422, erro: "Não encontrei exercícios neste PDF. Ele precisa ter listas numeradas com séries x repetições, como “1 Supino reto 3 x 10”. PDF escaneado (foto) não funciona." };
  return { plano };
}

// Tabela numerada primeiro (entende nomes quebrados em várias linhas); se não houver, lista.
export const lerTreino = (texto) => lerTabela(texto) || lerLista(texto);

// Formato lista: uma linha por exercício, com ou sem marcador/número, e títulos de grupo entre elas.
//   "● Extensora — 3×10 unilateral", "- Supino 4x12", "Leg press: 3 séries de 12", "Panturrilha — 4× até a falha"
// Marcadores de PDF às vezes viram letras ("l" no lugar de ●, "n" no lugar de ■).
const MARCADOR = /^(?:[•●▪■◦○►▶✓✔→*·]|[-–—](?=\s)|[lo](?=\s+\p{Lu})|\d{1,2}(?:[.)º°-]|\s*-)?(?=\s+\p{L}))\s*/u;
const SERIES_LISTA = /(?:^|[\s—–:,(-])(\d{1,2})\s*(?:[xX×]\s*(\d{1,3}(?:\s*(?:[–—-]|a)\s*\d{1,3})?(?!\d)|at[ée]\s+a\s+falha|falha|m[aá]x\w*)?|s[ée]ries?\s*(?:de\s*)?(\d{1,3}(?:\s*(?:[–—-]|a)\s*\d{1,3})?)(?!\d))/iu;
const RODAPE = /p[aá]gina\s*\d|page\s*\d/i;

export function lerLista(texto) {
  const linhas = String(texto).replace(/\u00a0/g, " ").split("\n").map((s) => s.trim()).filter(Boolean);
  const titulo = (linhas.find((l) => !RODAPE.test(l)) || "Meu treino").slice(0, 80);
  const grupos = [];
  let cabecalho = "", atual = null;
  for (const linha of linhas) {
    if (RODAPE.test(linha)) continue;
    const m0 = linha.match(MARCADOR), corpo = m0 ? linha.slice(m0[0].length) : linha;
    const s = corpo.match(SERIES_LISTA);
    let nome = "", ex = null;
    const depois = s ? corpo.slice(s.index + s[0].length) : "";
    if (s && s.index > 0 && !/^\s*(?:\d+\s*)?(?:min|seg|minutos|segundos|s|h|km|m)\b/i.test(depois)) { // "3 x 20 min" é cárdio, não série
      nome = corpo.slice(0, s.index).replace(/[\s—–:,(-]+$/, "").replace(/\s[BI]$/, "").trim();
      const reps = /falha/i.test(s[0]) ? "falha" : /m[aá]x/i.test(s[0]) ? "máx" : s[2] || s[3] ? (s[2] || s[3]).replace(/\s+/g, "").replace(/[—-]/, "–").replace(/^(\d+)a(\d+)$/, "$1–$2") : "";
      const obs = depois.replace(/^[\s,;.)—–-]+/, "").trim();
      ex = [nome, Math.min(20, Math.max(1, +s[1])), reps, obs];
    } else if (m0 && corpo.length >= 3 && corpo.length <= 60 && /^\p{Lu}/u.test(corpo) && !/[.:]$/.test(corpo)) {
      ex = [(nome = corpo), 3, "", ""]; // exercício sem séries escritas
    }
    // Texto corrido também tem "3 x 10" no meio de frases: sem marcador, só vale nome curto começando com maiúscula.
    const palavras = nome.split(/\s+/).length;
    const parece = m0 ? palavras <= 10 && /^\p{L}/u.test(nome) : palavras <= 6 && /^\p{Lu}/u.test(nome) && !/[.:;!?]/.test(nome);
    if (ex && nome.length >= 2 && nome.length <= 70 && parece) {
      if (!atual || atual.cabecalho !== cabecalho) grupos.push((atual = { cabecalho, exercicios: [] }));
      atual.exercicios.push(ex);
    } else if (!m0 && linha.length >= 3 && linha.length <= 60 && /^[\p{Lu}\d]/u.test(linha) && !/[.,;?!]$/.test(linha)) {
      cabecalho = linha.replace(/\s+(?:n{1,5}|[■□▪●]+)$/, "").trim(); // "n" = quadradinhos decorativos do PDF
    }
  }
  // Grupo sem nenhum nome de exercício conhecido é texto corrido (ex.: e-book), não treino.
  const reais = grupos.filter((g) => g.exercicios.some(([nome]) => foto(nome)));
  if (!reais.length) return null;
  return {
    nome: titulo,
    totalSessoes: 0,
    validade: "",
    treinos: reais.slice(0, 12).map((g, i) => {
      const letra = g.cabecalho.match(/^(?:[Tt]reino\s*)?([A-Z])\s*[–—:-]\s*(.+)/u);
      const id = String.fromCharCode(65 + i);
      return {
        id,
        nome: (letra ? `${id} – ${letra[2]}` : g.cabecalho ? `${id} – ${g.cabecalho}` : "Treino " + id).slice(0, 80),
        exercicios: g.exercicios.slice(0, 30).map(([nome, series, reps, obs]) => [nome.slice(0, 70), foto(nome), series, reps, 0, 60, obs.slice(0, 160)]),
      };
    }),
  };
}

function lerTabela(texto) {
  const t = String(texto).replace(/ /g, " ");
  const titulo = (t.split("\n").map((s) => s.trim()).find(Boolean) || "Meu treino").slice(0, 80);

  // Títulos como "A – Superior (ênfase peito e costas)". Vale a última vez que a letra aparece:
  // as anteriores costumam ser resumo da semana ou legenda ("B – básico").
  const porLetra = new Map();
  for (const m of t.matchAll(TITULO_TREINO)) porLetra.set(m[2], { id: m[2], nome: `${m[2]} – ${m[3].trim()}`, bruto: m[1], pos: m.index });
  const titulos = [...porLetra.values()].sort((a, b) => a.pos - b.pos);

  // Cada "N x N" fecha uma linha de tabela; o nome é o texto desde o último "<número> Nome" antes dele.
  // Só vale se a numeração for 1 (tabela nova) ou seguir a da tabela atual (pulando no máximo uma linha ilegível):
  // isso descarta "3 x 20 min" em texto corrido.
  const tabelas = [], linhas = [];
  let atual = null, fim = 0;
  for (const m of t.matchAll(SERIES)) {
    const base = Math.max(fim, m.index - 400), antes = t.slice(base, m.index); // janela fixa: sem isso, texto hostil deixa o laço quadrático
    let ini = null;
    for (const c of antes.matchAll(NUMERO)) ini = c;
    if (!ini) continue;
    const n = +ini[1], nome = antes.slice(ini.index + ini[0].length).replace(/\s+/g, " ").trim();
    if (nome.length < 3 || nome.length > 80 || (n !== 1 && !(atual && n > atual.length && n <= atual.length + 2))) continue;
    if (n === 1) tabelas.push((atual = Object.assign([], { pos: m.index })));
    if (linhas.length) linhas[linhas.length - 1].ateh = base + ini.index;
    fim = m.index + m[0].length;
    const linha = { nome, tipo: m[1], series: +m[2], reps: /^\d/.test(m[3]) ? m[3].replace(/\s+/g, "").replace(/[—-]/, "–") : "máx", de: fim, ateh: fim + 300 };
    atual.push(linha);
    linhas.push(linha);
  }

  // Observação: o que vem depois das séries, cortado onde começa rodapé, cabeçalho de tabela ou outro título.
  const cortes = [titulo, ...titulos.map((c) => c.bruto)];
  const obs = (l) => {
    let o = t.slice(l.de, l.ateh);
    for (const c of cortes) { const i = o.indexOf(c); if (i >= 0) o = o.slice(0, i); }
    return o.split(/#|Page \d+ of \d+|P[aá]gina \d+|\btreino\s+[a-z]\b/i)[0].replace(/\s+/g, " ").trim().slice(0, 160);
  };

  // Cada título fica com a primeira tabela ainda livre que começa depois dele (títulos podem vir
  // juntos antes das tabelas por causa da quebra de página). Sem nenhum título casado, cada tabela vira Treino A, B…
  const validas = tabelas.filter((x) => x.length >= 2), livres = new Set(validas);
  let treinos = titulos.map((c) => {
    const tab = validas.find((x) => livres.has(x) && x.pos > c.pos);
    if (tab) livres.delete(tab);
    return tab && { id: c.id, nome: c.nome, tab };
  }).filter(Boolean);
  if (!treinos.length) treinos = validas.slice(0, 8).map((tab, i) => ({ id: String.fromCharCode(65 + i), nome: "Treino " + String.fromCharCode(65 + i), tab }));
  if (!treinos.length) return null;
  return {
    nome: titulo,
    totalSessoes: 0,
    validade: "",
    treinos: treinos.map(({ id, nome, tab }) => ({
      id,
      nome: nome.slice(0, 80),
      exercicios: tab.slice(0, 30).map((l) => [l.nome.slice(0, 70), foto(l.nome), Math.min(20, Math.max(1, l.series)), l.reps, 0, DESCANSO[l.tipo] || 60, obs(l)]),
    })),
  };
}
