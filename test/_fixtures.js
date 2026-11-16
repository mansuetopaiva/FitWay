// Plano válido no formato da saída estruturada (usado em ia.test.js e geracao.test.js).
export const planoIA = () => ({
  nome_plano: "Plano 8 semanas", resumo: "Três treinos por semana.", avaliacao_fotos: "",
  fases: [{ semanas: "1–2", foco: "Técnica" }, { semanas: "3–8", foco: "Progressão" }],
  cardio: "2x 20 min", progressao: "+1 repetição por semana", cuidados: "Joelho: leg press no lugar do agachamento.",
  treinos: ["A", "B"].map((n) => ({ nome: "Treino " + n, exercicios: [
    { nome: "Leg press", series: 3, reps: "10-12", descanso_s: 90, obs: "" },
    { nome: "Supino reto com halteres", series: 3, reps: "8-10", descanso_s: 120, obs: " controle " },
    { nome: "Remada baixa na polia", series: 4, reps: "10", descanso_s: 60, obs: "" },
  ] })),
});

// Variáveis do termo com valores de exemplo (os reais ficam só no .env.local e na Vercel).
export const ENV_TERMO = { TERMO_RESPONSAVEL: "Fulana de Tal", TERMO_DOCUMENTO: "00.000.000/0001-00", TERMO_EMAIL: "contato@exemplo.com", TERMO_FORO: "Cidade/UF" };
export const comTermo = () => Object.assign(process.env, ENV_TERMO);
