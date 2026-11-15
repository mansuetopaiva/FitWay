// Validação e fusão dos dados do usuário. O "_" no nome impede a Vercel de expor este arquivo como rota.
import { foto } from "./_treino.js";

export const DIA = /^\d{4}-\d{2}-\d{2}$/;

// Nunca confia no que vem do navegador: devolve só o formato esperado, com limites.
export function limpar(d) {
  d = d && typeof d === "object" ? d : {};
  const cargas = {};
  if (d.cargas && typeof d.cargas === "object")
    for (const [k, v] of Object.entries(d.cargas).slice(0, 300))
      if (k.length <= 90 && Number.isFinite(v) && v >= 0 && v <= 500) cargas[k] = v;
  // O plano só entra pelo servidor (ação "treino"), já no formato certo; aqui basta conferir que existe.
  const plano = d.plano && Array.isArray(d.plano.treinos) && d.plano.treinos.length ? { plano: d.plano } : {};
  return {
    checkins: Array.isArray(d.checkins)
      ? [...new Set(d.checkins.filter((x) => typeof x === "string" && DIA.test(x)))].sort().slice(-4000)
      : [],
    sessoes: Number.isInteger(d.sessoes) && d.sessoes >= 0 && d.sessoes <= 100000 ? d.sessoes : 0,
    proximo: typeof d.proximo === "string" && d.proximo.length <= 10 ? d.proximo : "B",
    cargas,
    ...plano,
  };
}

// Junta o que está no banco (a) com o que o aparelho mandou (b), para um aparelho
// desatualizado não apagar check-ins ou sessões feitos em outro.
export function juntar(a, b) {
  return limpar({
    checkins: [...a.checkins, ...b.checkins],
    sessoes: Math.max(a.sessoes, b.sessoes),
    proximo: b.sessoes >= a.sessoes ? b.proximo : a.proximo,
    cargas: { ...a.cargas, ...b.cargas },
    plano: a.plano, // o aparelho nunca troca o plano por aqui, então um aparelho desatualizado não desfaz o envio do PDF
  });
}

// Plano editado pelo admin. Devolve { plano } já limpo ou { erro } dizendo onde está o problema.
// A foto que vier do navegador é descartada e recalculada pelo nome.
export function validarPlano(p) {
  const txt = (v, max, min = 1) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
  const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  if (!p || typeof p !== "object" || Array.isArray(p)) return { erro: "Plano inválido." };
  if (!txt(p.nome, 80)) return { erro: "O nome do plano precisa ter de 1 a 80 caracteres." };
  if (!Array.isArray(p.treinos) || !p.treinos.length) return { erro: "O plano precisa de pelo menos 1 treino." };
  if (p.treinos.length > 12) return { erro: "O plano pode ter no máximo 12 treinos." };
  const ids = new Set(), treinos = [];
  for (const [ti, t] of p.treinos.entries()) {
    const onde = `Treino ${t && typeof t.id === "string" && /^[A-Za-z0-9]{1,10}$/.test(t.id) ? t.id : ti + 1}`;
    if (!t || typeof t !== "object" || typeof t.id !== "string" || !/^[A-Za-z0-9]{1,10}$/.test(t.id))
      return { erro: `${onde}: o identificador precisa ter de 1 a 10 letras ou números.` };
    if (ids.has(t.id)) return { erro: `${onde}: identificador repetido.` };
    ids.add(t.id);
    if (!txt(t.nome, 80)) return { erro: `${onde}: o nome do treino precisa ter de 1 a 80 caracteres.` };
    if (!Array.isArray(t.exercicios) || !t.exercicios.length) return { erro: `${onde}: o treino precisa de pelo menos 1 exercício.` };
    if (t.exercicios.length > 30) return { erro: `${onde}: o treino pode ter no máximo 30 exercícios.` };
    const exercicios = [];
    for (const [ei, e] of t.exercicios.entries()) {
      const aqui = `${onde}, exercício ${ei + 1}`;
      if (!Array.isArray(e) || e.length !== 7) return { erro: `${aqui}: formato inválido.` };
      const [nome, , series, reps, carga, descanso, obs] = e;
      if (!txt(nome, 70)) return { erro: `${aqui}: o nome precisa ter de 1 a 70 caracteres.` };
      if (!int(series, 1, 20)) return { erro: `${aqui}: séries precisa ser um número inteiro de 1 a 20.` };
      if (!txt(reps, 12, 0)) return { erro: `${aqui}: repetições pode ter no máximo 12 caracteres.` };
      if (typeof carga !== "number" || !Number.isFinite(carga) || carga < 0 || carga > 500) return { erro: `${aqui}: a carga precisa ser de 0 a 500 kg.` };
      if (!int(descanso, 0, 600)) return { erro: `${aqui}: o descanso precisa ser um número inteiro de 0 a 600 segundos.` };
      if (!txt(obs, 160, 0)) return { erro: `${aqui}: a observação pode ter no máximo 160 caracteres.` };
      exercicios.push([nome.trim(), foto(nome.trim()), series, reps.trim(), carga, descanso, obs.trim()]);
    }
    treinos.push({ id: t.id, nome: t.nome.trim(), exercicios });
  }
  return { plano: { nome: p.nome.trim(), treinos } };
}

// Busca com ilike: % e _ digitados pelo admin são texto, não curinga. "\\" é o escape padrão do Postgres.
export const escaparLike = (s) => String(s).replace(/[\\%_]/g, (c) => "\\" + c);
