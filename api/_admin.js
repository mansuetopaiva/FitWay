// Área de administração: acao "admin" com campo "op". O "_" no nome impede a Vercel de expor este arquivo como rota.
// Recebe o sql por parâmetro para o teste provar que quem não é admin não chega a consultar o banco.

export const OPS = ["resumo", "usuarios", "usuario", "acesso", "plano_salvar", "plano_pdf", "plano_remover"];

// Lido a cada chamada: tirar alguém da variável na Vercel vale sem depender do navegador.
export function ehAdmin(email) {
  if (typeof email !== "string" || !email) return false;
  return (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

const ok = (corpo) => ({ status: 200, corpo });
const falha = (status, erro) => ({ status, corpo: { erro } });

export async function acaoAdmin(sql, u, b) {
  if (!ehAdmin(u && u.email)) return falha(403, "Acesso restrito.");
  if (!OPS.includes(b.op)) return falha(400, "Operação desconhecida.");
  return falha(400, "Operação ainda não disponível.");
}
