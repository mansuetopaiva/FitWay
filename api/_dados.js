// Validação e fusão dos dados do usuário. O "_" no nome impede a Vercel de expor este arquivo como rota.
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
