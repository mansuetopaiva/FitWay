// Preços e regras de cobrança e acesso (puro, sem banco). O "_" no nome impede a Vercel de expor este arquivo como rota.

export const PRECOS = { inicial: 999, mensalidade: 999, novo_treino: 499 }; // centavos
export const ABERTOS = ["aguardando_pagamento", "pago", "gerando"];
const EFEITOS = { inicial: { dias: 30, gerar: true }, mensalidade: { dias: 30, gerar: false }, novo_treino: { dias: 0, gerar: true } };
const OITO_SEMANAS = 56 * 864e5;

const tipoValido = (t) => typeof t === "string" && Object.hasOwn(PRECOS, t);
const planoIA = (u) => (u && u.dados && u.dados.plano && u.dados.plano.origem === "ia" ? u.dados.plano : null);

export const acessoAtivo = (u, agora) => !!(u && u.acesso_ate) && new Date(u.acesso_ate) > agora;

export function podePedir(tipo, u, agora, pedidoAberto) {
  if (!tipoValido(tipo)) return { erro: "Tipo de pedido inválido." };
  if (pedidoAberto) return { erro: "Você já tem um pedido em andamento." };
  const p = planoIA(u);
  if (tipo === "inicial" && p) return { erro: "Você já tem um treino personalizado. Renove o acesso ou peça um novo treino." };
  if (tipo !== "inicial" && !p) return { erro: "Peça primeiro o seu treino personalizado." };
  if (tipo === "novo_treino") {
    if (!(agora - Date.parse(p.criado) >= OITO_SEMANAS)) return { erro: "O novo treino fica disponível 8 semanas depois do plano atual." };
    if (!acessoAtivo(u, agora)) return { erro: "Renove o acesso para pedir um novo treino." };
  }
  return { ok: true };
}

export const efeitoDoPagamento = (tipo) => (tipoValido(tipo) ? EFEITOS[tipo] : undefined);

// O plano feito pela IA é pago: só aparece com acesso ativo. PDF e admin aparecem sempre.
export function planoVisivel(u, agora) {
  const p = u && u.dados && u.dados.plano;
  if (!p) return null;
  return p.origem === "ia" && !acessoAtivo(u, agora) ? null : p;
}
