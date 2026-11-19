// Tarefa diária (Vercel Cron, api/cron.js): os prazos da política de privacidade, sem depender de alguém abrir uma tela.
// As telas continuam rodando as mesmas limpezas (limparPedidos, limparChamados). Cada passo é idempotente.
import { limparPedidos } from "./_pedido.js";
import { limparChamados } from "./_suporte.js";

export async function rodarLimpezas(sql) {
  const ped = await limparPedidos(sql, null);   // sem pagamento há 30 dias: cancela; fotos 90 dias depois de pronto/cancelado/erro
  const ch = await limparChamados(sql, null);   // anexos 90 dias depois do fechamento
  // Pedido pago ou gerando há mais de 7 dias (travado): só as fotos saem; o pedido, as respostas e o plano ficam.
  const [t] = await sql`with x as (update pedidos set fotos = null where status in ('pago', 'gerando') and fotos is not null
    and coalesce(atualizado, pago_em, criado) < now() - interval '7 days' returning 1) select count(*)::int as n from x`;
  const [l] = await sql`with x as (delete from login_tentativas where atualizado < now() - interval '1 day' returning 1) select count(*)::int as n from x`;
  // Só números: nenhum email, nome ou id de pedido no registro.
  const resumo = { pedidos_cancelados: ped.cancelados, fotos_90_dias: ped.fotos, fotos_travados: (t && t.n) || 0,
    anexos_suporte: ch.anexos, chamados_fechados: ch.fechados, tentativas_login: (l && l.n) || 0 };
  await sql`insert into admin_log (admin_email, acao, alvo_email, detalhes) values ('cron', 'limpeza_diaria', null, ${JSON.stringify(resumo)}::jsonb)`;
  return resumo;
}
