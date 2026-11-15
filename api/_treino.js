// Lê o texto de um PDF de treino com regras fixas (sem IA) e monta o plano no formato de js/data.js.
// Espera linhas numeradas com "séries x repetições", como "1 Supino reto com halteres B 3 x 6–8 Observação".

const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Nome em português -> exercício do free-exercise-db (domínio público). A primeira regra que casar vence,
// então as mais específicas ficam antes. Nome que não casar fica sem foto.
const FOTOS = [
  // peito
  [/supino.*inclinad.*smith/, "Smith_Machine_Incline_Bench_Press"],
  [/supino.*declinad.*smith/, "Smith_Machine_Decline_Press"],
  [/supino.*smith/, "Smith_Machine_Bench_Press"],
  [/supino.*inclinad.*halter/, "Incline_Dumbbell_Press"],
  [/supino.*declinad.*halter/, "Decline_Dumbbell_Bench_Press"],
  [/supino.*halter/, "Dumbbell_Bench_Press"],
  [/supino.*inclinad.*maquina/, "Leverage_Incline_Chest_Press"],
  [/supino.*declinad.*maquina/, "Leverage_Decline_Chest_Press"],
  [/supino.*maquina/, "Machine_Bench_Press"],
  [/supino.*inclinad/, "Barbell_Incline_Bench_Press_-_Medium_Grip"],
  [/supino.*declinad/, "Decline_Barbell_Bench_Press"],
  [/supino.*fechad/, "Close-Grip_Barbell_Bench_Press"],
  [/supino/, "Barbell_Bench_Press_-_Medium_Grip"],
  [/(crucifixo|voador|peck).*invers/, "Reverse_Machine_Flyes"],
  [/crucifixo.*inclinad/, "Incline_Dumbbell_Flyes"],
  [/crucifixo.*(maquina|peck)|peck ?deck|voador/, "Butterfly"],
  [/cross ?over|crucifixo.*(polia|cabo)/, "Cable_Crossover"],
  [/crucifixo/, "Dumbbell_Flyes"],
  [/flexao.*(braco|solo)|push ?up/, "Pushups"],
  [/pull ?over/, "Straight-Arm_Dumbbell_Pullover"],
  // tríceps (antes de "pulldown" e "paralela")
  [/triceps.*frances.*(polia|corda|cabo)/, "Cable_Rope_Overhead_Triceps_Extension"],
  [/triceps.*frances/, "Standing_Dumbbell_Triceps_Extension"],
  [/triceps.*corda/, "Triceps_Pushdown_-_Rope_Attachment"],
  [/triceps.*testa/, "EZ-Bar_Skullcrusher"],
  [/triceps.*(coice|kickback)/, "Tricep_Dumbbell_Kickback"],
  [/triceps.*maquina/, "Machine_Triceps_Extension"],
  [/triceps.*banco/, "Bench_Dips"],
  [/triceps/, "Triceps_Pushdown"],
  [/paralela|mergulho/, "Dips_-_Chest_Version"],
  // costas
  [/barra fixa.*supinad|chin ?up/, "Chin-Up"],
  [/barra fixa|pull ?up/, "Pullups"],
  [/puxada.*unilateral/, "One_Arm_Lat_Pulldown"],
  [/puxada.*(triangulo|neutra|fechad)/, "V-Bar_Pulldown"],
  [/puxada.*supinad/, "Underhand_Cable_Pulldowns"],
  [/puxada.*(atras|nuca)/, "Wide-Grip_Pulldown_Behind_The_Neck"],
  [/pull ?down|puxada.*braco.*estendido/, "Straight-Arm_Pulldown"],
  [/puxada|pulley/, "Wide-Grip_Lat_Pulldown"],
  [/remada.*alta/, "Upright_Barbell_Row"],
  [/remada.*(baixa|sentad|polia|cabo)/, "Seated_Cable_Rows"],
  [/remada.*cavalinho|barra t\b/, "T-Bar_Row_with_Handle"],
  [/remada.*unilateral|serrote/, "One-Arm_Dumbbell_Row"],
  [/remada.*(apoiad|inclinad)/, "Dumbbell_Incline_Row"],
  [/remada.*(maquina|articulad)/, "Leverage_Iso_Row"],
  [/remada.*halter/, "Bent_Over_Two-Dumbbell_Row"],
  [/remada/, "Bent_Over_Barbell_Row"],
  [/face ?pull/, "Face_Pull"],
  [/encolhimento/, "Dumbbell_Shrug"],
  [/hiperextens|lombar/, "Hyperextensions_Back_Extensions"],
  // ombros
  [/arnold/, "Arnold_Dumbbell_Press"],
  [/desenvolvimento.*smith/, "Smith_Machine_Overhead_Shoulder_Press"],
  [/desenvolvimento.*maquina/, "Machine_Shoulder_Military_Press"],
  [/desenvolvimento.*halter/, "Dumbbell_Shoulder_Press"],
  [/desenvolvimento|militar/, "Seated_Barbell_Military_Press"],
  [/elevacao.*lateral.*(polia|cabo)/, "Standing_Low-Pulley_Deltoid_Raise"],
  [/elevacao.*lateral/, "Side_Lateral_Raise"],
  [/elevacao.*frontal.*(polia|cabo)/, "Front_Cable_Raise"],
  [/elevacao.*frontal/, "Front_Dumbbell_Raise"],
  // bíceps
  [/rosca.*martelo/, "Hammer_Curls"],
  [/rosca.*scott.*maquina/, "Machine_Preacher_Curls"],
  [/rosca.*scott/, "Preacher_Curl"],
  [/rosca.*concentrad/, "Concentration_Curls"],
  [/rosca.*punho/, "Palms-Up_Barbell_Wrist_Curl_Over_A_Bench"],
  [/rosca.*invers/, "Reverse_Barbell_Curl"],
  [/rosca.*bayesian/, "Standing_One-Arm_Cable_Curl"],
  [/rosca.*(polia|cabo)/, "Standing_Biceps_Cable_Curl"],
  [/rosca.*inclinad/, "Incline_Dumbbell_Curl"],
  [/rosca.*alternad/, "Dumbbell_Alternate_Bicep_Curl"],
  [/rosca.*(barra w|\bw\b|ez)/, "EZ-Bar_Curl"],
  [/rosca.*halter/, "Dumbbell_Bicep_Curl"],
  [/rosca/, "Barbell_Curl"],
  // abdômen (antes de "elevação de pernas" e "máquina")
  [/roda abdominal|ab wheel/, "Ab_Roller"],
  [/(abdominal|crunch).*(polia|cabo)/, "Cable_Crunch"],
  [/abdominal.*maquina/, "Ab_Crunch_Machine"],
  [/abdominal.*declinad/, "Decline_Crunch"],
  [/abdominal.*obliqu/, "Oblique_Crunches"],
  [/elevacao.*pernas?|abdominal.*infra/, "Hanging_Leg_Raise"],
  [/pallof/, "Pallof_Press"],
  [/prancha.*lateral/, "Side_Bridge"],
  [/prancha/, "Plank"],
  [/abdominal|crunch/, "Crunches"],
  // pernas e glúteo
  [/elevacao.*pelvica|hip ?thrust/, "Barbell_Hip_Thrust"],
  [/ponte/, "Butt_Lift_Bridge"],
  [/panturrilha.*leg/, "Calf_Press_On_The_Leg_Press_Machine"],
  [/panturrilha.*sentad/, "Seated_Calf_Raise"],
  [/panturrilha/, "Standing_Calf_Raises"],
  [/leg ?press/, "Leg_Press"],
  [/extensora/, "Leg_Extensions"],
  [/flexora.*sentad|cadeira flexora/, "Seated_Leg_Curl"],
  [/flexora.*em pe/, "Standing_Leg_Curl"],
  [/flexora/, "Lying_Leg_Curls"],
  [/abdutora/, "Thigh_Abductor"],
  [/adutora/, "Thigh_Adductor"],
  [/romeno|\brdl\b/, "Romanian_Deadlift"],
  [/stiff/, "Stiff-Legged_Barbell_Deadlift"],
  [/terra/, "Barbell_Deadlift"],
  [/afundo.*smith/, "Smith_Single-Leg_Split_Squat"],
  [/bulgaro/, "Split_Squat_with_Dumbbells"],
  [/afundo|avanco|passada/, "Dumbbell_Lunges"],
  [/agachamento.*smith/, "Smith_Machine_Squat"],
  [/hack/, "Hack_Squat"],
  [/agachamento.*frontal/, "Front_Barbell_Squat"],
  [/agachamento.*sumo/, "Plie_Dumbbell_Squat"],
  [/goblet/, "Goblet_Squat"],
  [/agachamento.*halter/, "Dumbbell_Squat"],
  [/agachamento/, "Barbell_Squat"],
  [/gluteo.*(polia|cabo)/, "One-Legged_Cable_Kickback"],
  [/gluteo|coice/, "Glute_Kickback"],
];
export const IDS_FOTOS = FOTOS.map((r) => r[1]);

// Em "Crucifixo na máquina ou crossover" vale a primeira opção.
export function foto(nome) {
  const n = semAcento(nome.split(/\s+\(?ou\s+/i)[0]);
  const r = FOTOS.find(([re]) => re.test(n));
  return r ? "db:" + r[1] : "";
}

const SERIES = /(?:\s([BI]))?\s(\d{1,2})\s*[xX×]\s*(\d{1,3}(?:\s*[–—-]\s*\d{1,3})?(?!\d)|[Mm][aáAÁ][xX]\w*|[Ff]alha)/g;
const NUMERO = /(?:^|\s)(\d{1,2})[.)º]?\s+(?=\p{Lu})/gu;
const TITULO_TREINO = /(?:^|\n)[ \t]*((?:Treino\s+)?([A-Z])\s*[–—:-]\s+(\p{L}[^\n]{1,70}))/gu;
const DESCANSO = { B: 150, I: 90 }; // B = básico, I = isolador; sem tipo, 60 s

export function lerTreino(texto) {
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
    const antes = t.slice(fim, m.index);
    let ini = null;
    for (const c of antes.matchAll(NUMERO)) ini = c;
    if (!ini) continue;
    const n = +ini[1], nome = antes.slice(ini.index + ini[0].length).replace(/\s+/g, " ").trim();
    if (nome.length < 3 || nome.length > 80 || (n !== 1 && !(atual && n > atual.length && n <= atual.length + 2))) continue;
    if (n === 1) tabelas.push((atual = Object.assign([], { pos: m.index })));
    if (linhas.length) linhas[linhas.length - 1].ateh = fim + ini.index;
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
