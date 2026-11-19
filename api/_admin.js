// Área de administração: acao "admin" com campo "op". O "_" no nome impede a Vercel de expor este arquivo como rota.
// Recebe o sql por parâmetro para o teste provar que quem não é admin não chega a consultar o banco.

import { DIA, escaparLike, limpar, validarPlano } from "./_dados.js";
import { NOMES_FOTOS, lerPdf } from "./_treino.js";
import { PARQ, limparPedidos } from "./_pedido.js";
import { termoFaltando } from "./_termo.js";
import { ABERTOS, PRECOS, efeitoDoPagamento, tipoValido } from "./_precos.js";
import { confirmarPagamento } from "./_pagamento.js";
import { OPS_ADMIN as OPS_SUPORTE, acaoAdminSuporte, limparChamados } from "./_suporte.js";
import { createHmac } from "node:crypto";

export const OPS = ["resumo", "usuarios", "usuario", "acesso", "plano_salvar", "plano_pdf", "plano_remover",
  "pedidos", "pedido", "pedido_verificar", "pedido_gerar_de_novo", "pedido_cancelar",
  "pedido_estornar", "devolucao_marcar", ...OPS_SUPORTE, "usuario_excluir"];
// Estorno: o dinheiro o admin devolve no app do InfinitePay; aqui só se registra e se desfaz o efeito no app.
const MOTIVOS = { desistencia: "Desistência em 7 dias", duplicado: "Pagamento duplicado", outro: "Outro" };
const DIAS = Object.fromEntries(Object.keys(PRECOS).map((t) => [t, efeitoDoPagamento(t).dias]));
const STATUS = ["aguardando_pagamento", "aguardando_confirmacao", "pago", "gerando", "pronto", "erro", "cancelado"];

// Lido a cada chamada: tirar alguém da variável na Vercel vale sem depender do navegador.
export function ehAdmin(email) {
  if (typeof email !== "string" || !email) return false;
  return (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

// HMAC-SHA256 do email com HASH_SEGREDO (32+ caracteres): sem o segredo, ninguém confirma um email por dicionário.
// Sem a variável, devolve "" e a exclusão de conta é recusada.
const segredo = () => ((process.env.HASH_SEGREDO || "").length >= 32 ? process.env.HASH_SEGREDO : "");
export const hmacEmail = (email) => (segredo() ? createHmac("sha256", segredo()).update(email).digest("hex") : "");

const ok = (corpo) => ({ status: 200, corpo });
const falha = (status, erro) => ({ status, corpo: { erro } });
const emailAlvo = (v) => (typeof v === "string" && v.length >= 3 && v.length <= 120 ? v.trim().toLowerCase() : "");

// Campos de lista, calculados no SQL para não trazer o "dados" inteiro (plano + histórico) de cada linha.
// shortcut: conta check-ins dentro do JSON "dados"; mover check-ins para uma tabela própria se passar de alguns milhares de usuários.
const paginaValida = (p) => p === undefined || (Number.isInteger(p) && p >= 0 && p <= 100000);
const linha = (x) => ({ nome: x.nome, email: x.email, criado: x.criado, acessoAte: x.acesso_ate, checkins: x.checkins, ultimoCheckin: x.ultimo || null, temTreino: x.tem_treino });


// opc.gerar(id): gera o treino de um pedido pago (gerarSeDevido); injetado para o teste não chamar a IA.
// opc.fetch: chamada ao InfinitePay (pedido_verificar); injetado no teste.
export async function acaoAdmin(sql, u, b, opc = {}) {
  if (!ehAdmin(u && u.email)) return falha(403, "Acesso restrito.");
  if (!OPS.includes(b.op)) return falha(400, "Operação desconhecida.");

  if (b.op === "resumo") {
    // Dias contados no horário de Brasília; a semana começa no domingo, como no app.
    const [r] = await sql`with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
      select count(*)::int as usuarios,
        count(*) filter (where criado > now() - interval '7 days')::int as novos7d,
        count(*) filter (where dados->'plano' is not null)::int as com_treino,
        count(*) filter (where acesso_ate > now())::int as com_acesso,
        coalesce(sum((select count(*) from jsonb_array_elements_text(coalesce(dados->'checkins', '[]')) c(dia)
          where dia = to_char((select d from hoje), 'YYYY-MM-DD'))), 0)::int as checkins_hoje,
        coalesce(sum((select count(*) from jsonb_array_elements_text(coalesce(dados->'checkins', '[]')) c(dia)
          where dia >= to_char((select d - extract(dow from d)::int from hoje), 'YYYY-MM-DD') and dia <= to_char((select d from hoje), 'YYYY-MM-DD'))), 0)::int as checkins_semana,
        col_description('usuarios'::regclass, (select attnum from pg_attribute where attrelid = 'usuarios'::regclass and attname = 'criado')) as cadastro_antes
      from usuarios`;
    await limparPedidos(sql, null); // prazos de pedidos e fotos (sem cron: roda aqui e no pedido_status)
    await limparChamados(sql, null);
    const [ch] = await sql`select count(*)::int as n from chamados where status = 'aberto'`;
    const [p] = await sql`select count(*) filter (where status = 'aguardando_pagamento')::int as aguardando,
        coalesce(sum(valor) filter (where estornado_em is null and pago_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0)::int as receita_mes,
        (select count(*) from usuarios where acesso_ate > now() and acesso_ate <= now() + interval '7 days')::int as vencendo7d
      from pedidos`;
    // Pago sem liberar o pedido (pedido já fechado, os dois links pagos, ou valor menor): devolver o dinheiro.
    const semPedido = await sql`select l.criado, l.alvo_email as email, l.detalhes->>'transaction_nsu' as transaction_nsu,
        (l.detalhes->>'paid_amount')::int as valor, l.detalhes->>'motivo' as motivo, coalesce(p.codigo, p.id) as codigo
      from admin_log l left join pedidos p on p.id = l.detalhes->>'pedido'
      where l.acao = 'cartao_sem_pedido' and l.criado > now() - interval '30 days'
        and not exists (select 1 from admin_log d where d.acao = 'devolvido' and d.detalhes->>'transaction_nsu' = l.detalhes->>'transaction_nsu')
      order by l.criado desc limit 10`;
    return ok({ usuarios: r.usuarios, novos7d: r.novos7d, comTreino: r.com_treino, comAcesso: r.com_acesso,
      checkinsHoje: r.checkins_hoje, checkinsSemana: r.checkins_semana, cadastroAntes: r.cadastro_antes || "",
      aguardando: p.aguardando, cartaoSemPedido: semPedido, receitaMes: p.receita_mes, vencendo7d: p.vencendo7d,
      iaLigada: process.env.TREINO_IA_ATIVO === "1", termoFaltando: termoFaltando(), suporteAguardando: (ch && ch.n) || 0 });
  }

  if (b.op === "usuarios") {
    const busca = typeof b.busca === "string" ? b.busca.trim().slice(0, 80) : "";
    if (!paginaValida(b.pagina)) return falha(400, "Página inválida.");
    const pagina = b.pagina || 0;
    const q = "%" + escaparLike(busca) + "%";
    const xs = await sql`select nome, email, criado, acesso_ate, coalesce(jsonb_array_length(dados->'checkins'), 0)::int as checkins, dados->'checkins'->>-1 as ultimo, dados->'plano' is not null as tem_treino from usuarios
      where nome ilike ${q} or email ilike ${q}
      order by criado desc nulls last, email limit 21 offset ${pagina * 20}`;
    return ok({ itens: xs.slice(0, 20).map(linha), temMais: xs.length > 20 });
  }

  if (b.op === "pedidos") {
    const status = b.status === undefined ? "" : b.status, tipo = b.tipo === undefined ? "" : b.tipo;
    if (status !== "" && !STATUS.includes(status)) return falha(400, "Status inválido.");
    if (tipo !== "" && !tipoValido(tipo)) return falha(400, "Tipo inválido.");
    if (!paginaValida(b.pagina)) return falha(400, "Página inválida.");
    const xs = await sql`select p.id, p.tipo, p.status, p.valor, p.criado, p.email, coalesce(u.nome, 'Conta excluída') as nome from pedidos p left join usuarios u on u.email = p.email
      where (${status} = '' or p.status = ${status}) and (${tipo} = '' or p.tipo = ${tipo})
      order by p.criado desc, p.id limit 21 offset ${(b.pagina || 0) * 20}`;
    return ok({ itens: xs.slice(0, 20), temMais: xs.length > 20 });
  }

  if (b.op.startsWith("suporte_")) return acaoAdminSuporte(sql, u, b);

  if (b.op === "devolucao_marcar") {
    const t = typeof b.transaction_nsu === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(b.transaction_nsu) ? b.transaction_nsu : "";
    if (!t) return falha(400, "Informe o pagamento.");
    // Só um item que está na lista "para devolver", e uma vez.
    let x;
    try {
      [x] = await sql`insert into admin_log (admin_email, acao, alvo_email, detalhes)
      select ${u.email}, 'devolvido', l.alvo_email, jsonb_build_object('transaction_nsu', ${t}::text, 'valor', l.detalhes->'paid_amount', 'pedido', l.detalhes->'pedido')
      from admin_log l where l.acao = 'cartao_sem_pedido' and l.detalhes->>'transaction_nsu' = ${t}
        and not exists (select 1 from admin_log d where d.acao = 'devolvido' and d.detalhes->>'transaction_nsu' = ${t})
      limit 1 returning id`;
    } catch (e) { if (!(e && e.code === "23505")) throw e; } // dois cliques ao mesmo tempo: o índice admin_log_devolvido segura
    if (!x) return falha(400, "Este pagamento não está na lista para devolver (ou já foi marcado).");
    return ok({});
  }

  if (b.op.startsWith("pedido")) {
    const id = typeof b.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(b.id) ? b.id : "";
    if (!id) return falha(400, "Informe o pedido.");
    let motivo = "", texto = null;
    if (b.op === "pedido_estornar") {
      motivo = typeof b.motivo === "string" && Object.hasOwn(MOTIVOS, b.motivo) ? MOTIVOS[b.motivo] : "";
      if (b.motivo === "outro") texto = typeof b.texto === "string" ? b.texto.trim() : "";
      if (!motivo || (texto !== null && (!texto || texto.length > 200))) return falha(400, "Escolha o motivo (em \"Outro\", escreva até 200 caracteres).");
    }
    // Cada escrita e o seu registro no admin_log vão numa única instrução.
    const log = (acao) => JSON.stringify({ pedido: id, acao });
    if (b.op === "pedido") {
      if (b.gerar === true && opc.gerar) await opc.gerar(id); // logo depois de marcar como pago: gera sem esperar o aluno abrir o app
      // Ver dados de saúde ou fotos fica registrado.
      const [x] = await sql`with p as (select p.id, p.email, p.tipo, p.status, p.valor, p.criado, p.pago_em, p.gerado_em, p.atualizado, p.erro, p.tentativas, p.modelo,
          p.respostas, p.fotos, p.aceite, p.plano_gerado, p.metodo, p.codigo, p.confirmado_por, p.transaction_nsu, p.capture_method, p.checkout_ref,
          p.checkout_url, p.checkout_url_pix, p.estornado_em, p.estornado_por, u.nome, u.acesso_ate,
          -- Pix manual antigo ainda não conferido: o que a pessoa mandou, só para o admin decidir (cancelar e devolver, ou não).
          case when p.status = 'aguardando_confirmacao' then jsonb_build_object('pagador', p.pagador_nome, 'aviso', p.aviso_em,
            'e2e', p.pix_e2e_informado, 'comprovante', p.comprovante) end as pix_antigo from pedidos p left join usuarios u on u.email = p.email where p.id = ${id}),
          l as (insert into admin_log (admin_email, acao, alvo_email, detalhes)
            select ${u.email}, 'pedido_ver', email, jsonb_build_object('pedido', id) from p where respostas is not null or fotos is not null or pix_antigo is not null)
        select * from p`;
      if (!x) return falha(404, "Pedido não encontrado.");
      return ok({ id: x.id, email: x.email, nome: x.nome || "Conta excluída", contaExcluida: !x.nome, acessoAte: x.acesso_ate, tipo: x.tipo, status: x.status, valor: x.valor,
        criado: x.criado, pagoEm: x.pago_em, geradoEm: x.gerado_em, atualizado: x.atualizado, erro: x.erro, tentativas: x.tentativas,
        modelo: x.modelo, respostas: x.respostas, fotos: x.fotos, aceite: x.aceite, plano: x.plano_gerado, parq: PARQ,
        metodo: x.metodo, codigo: x.codigo, confirmadoPor: x.confirmado_por,
        transactionNsu: x.transaction_nsu, captureMethod: x.capture_method, checkoutRef: x.checkout_ref,
        temLink: !!(x.checkout_url || x.checkout_url_pix), pixAntigo: x.pix_antigo || null,
        estornadoEm: x.estornado_em || null, estornadoPor: x.estornado_por || null, diasDoPedido: DIAS[x.tipo] || 0 });
    }
    let x;
    if (b.op === "pedido_verificar") {
      // Roda o payment_check de novo com o último retorno recebido (volta do checkout ou webhook), guardado em checkout_ref.
      const [p] = await sql`select checkout_ref from pedidos where id = ${id}`;
      if (!p) return falha(404, "Pedido não encontrado.");
      if (!p.checkout_ref) return falha(400, "Não há o que verificar: o InfinitePay ainda não mandou o retorno deste pagamento.");
      const r = await confirmarPagamento(sql, { ...p.checkout_ref, order_nsu: id }, { fetch: opc.fetch });
      if (r !== "pago") return falha(400, {
        ignorado: "Nada mudou: o pedido não tem link do InfinitePay (ou já foi pago).",
        recusado: "O InfinitePay diz que este pagamento não foi feito ou veio com valor menor (valor menor fica no aviso do resumo para devolver).",
        temporario: "O InfinitePay não respondeu (ou acabou de ser consultado). Tente de novo em alguns minutos.",
        sobra: "O InfinitePay diz que foi pago, mas o pedido já não estava aberto. O pagamento ficou no aviso do resumo: devolva o dinheiro.",
      }[r]);
      [x] = await sql`select status from pedidos where id = ${id}`;
    } else if (b.op === "pedido_gerar_de_novo") {
      if (!process.env.ANTHROPIC_API_KEY) return falha(400, "Chave da IA não configurada.");
      // Pronto só se ainda é o treino atual do usuário: não sobrescreve um treino mais novo nem um PDF.
      const recusa = "Só dá para gerar de novo um pedido com erro, ou o pronto que ainda é o treino atual do usuário, sem outro pedido em andamento.";
      try {
        [x] = await sql`with p as (update pedidos set status = 'pago', tentativas = 0, erro = null, atualizado = now()
              where id = ${id} and tipo <> 'mensalidade'
                and (status = 'erro' or (status = 'pronto' and (select dados->'plano'->>'pedido' from usuarios where email = pedidos.email) = pedidos.id))
                and not exists (select 1 from pedidos o where o.email = pedidos.email and o.id <> pedidos.id and o.status = any(${ABERTOS}))
              returning email, status),
            l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select ${u.email}, 'pedido_gerar_de_novo', email, ${log("gerar_de_novo")}::jsonb from p)
          select status from p`;
      } catch (e) {
        if (e && e.code === "23505") return falha(400, recusa); // outro pedido abriu ao mesmo tempo (índice pedidos_um_aberto)
        throw e;
      }
      if (!x) return falha(400, recusa);
    } else if (b.op === "pedido_cancelar") {
      // Cancelar não devolve dinheiro nem tira os dias de acesso já dados.
      [x] = await sql`with p as (update pedidos set status = 'cancelado', atualizado = now()
            where id = ${id} and status in ('aguardando_pagamento', 'aguardando_confirmacao', 'pago', 'erro') returning email, status),
          l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select ${u.email}, 'pedido_cancelar', email, ${log("cancelar")}::jsonb from p)
        select status from p`;
      if (!x) return falha(400, "Este pedido não pode mais ser cancelado.");
    } else if (b.op === "pedido_estornar") {
      // Numa instrução: cancela e marca o pedido, tira só os dias que ESTE pedido deu (sem passar de now() nem aumentar)
      // (também um pedido pago que já tinha sido cancelado) e, se o treino atual da conta é o deste pedido, tira o treino (continua em pedidos.plano_gerado). A condição
      // "estornado_em is null" faz o segundo clique não achar a linha: nunca desconta duas vezes.
      [x] = await sql`with p as (update pedidos set status = 'cancelado', estornado_em = now(), estornado_por = ${u.email}, atualizado = now()
            where id = ${id} and estornado_em is null
              and (status in ('pago', 'pronto', 'erro') or (status = 'cancelado' and pago_em is not null))
            returning id, email, tipo, valor, (${JSON.stringify(DIAS)}::jsonb->>tipo)::int as dias),
          a as (update usuarios set
              acesso_ate = case when (select dias from p) > 0 and acesso_ate is not null
                then least(acesso_ate, greatest(now(), acesso_ate - make_interval(days => (select dias from p)))) else acesso_ate end,
              -- O treino deste pedido sai; volta o do pedido pronto anterior (não estornado), se houver.
              dados = case when dados->'plano'->>'pedido' = (select id from p) then
                coalesce((select (dados - 'plano') || jsonb_build_object('plano', o.plano_gerado, 'proximo', 'A') from pedidos o
                  where o.email = usuarios.email and o.id <> (select id from p) and o.status = 'pronto' and o.estornado_em is null and o.plano_gerado is not null
                  order by o.gerado_em desc nulls last limit 1), dados - 'plano') else dados end
            where email = (select email from p) returning acesso_ate, (select dados->'plano'->>'pedido' from usuarios where email = (select email from p)) = (select id from p) as tirou),
          l as (insert into admin_log (admin_email, acao, alvo_email, detalhes)
            select ${u.email}, 'pedido_estornado', p.email, jsonb_build_object('pedido', p.id, 'tipo', p.tipo, 'valor', p.valor, 'dias', p.dias,
              'motivo', ${motivo}::text, 'texto', ${texto}::text, 'treino_removido', coalesce((select tirou from a), false)) from p)
        select 'cancelado' as status, (select acesso_ate from a) as acesso_ate from p`;
      if (!x) return falha(400, "Só dá para registrar a devolução de um pedido que foi pago, e uma vez só (este já foi estornado ou não foi pago).");
    } else return falha(400, "Operação desconhecida.");
    if (!x) return falha(400, "Este pedido não está aguardando pagamento.");
    return ok({ status: x.status, acessoAte: x.acesso_ate });
  }

  const alvo = emailAlvo(b.email);
  if (!alvo) return falha(400, "Informe o email do usuário.");
  const naoExiste = async () => !(await sql`select 1 from usuarios where email = ${alvo}`).length;

  if (b.op === "usuario_excluir") {
    // Duas etapas: o painel pede para digitar o email, e o servidor confere de novo. Conta de admin (inclusive a própria) não.
    if (typeof b.confirmacao !== "string" || b.confirmacao.trim().toLowerCase() !== alvo) return falha(400, "Digite o email da conta para confirmar.");
    if (ehAdmin(alvo)) return falha(400, "Conta de admin não pode ser excluída por aqui.");
    const h = hmacEmail(alvo);
    if (!h) return falha(400, "Configure a variável HASH_SEGREDO (32 ou mais caracteres aleatórios) na Vercel antes de excluir contas.");
    // Numa instrução:
    // - pedidos pagos, prontos ou estornados ficam (registro de pagamento exigido por lei), anonimizados: o email vira
    //   "excluida:<HMAC>" e saem respostas, fotos, plano, mensagem e os dados do aceite e do Pix manual;
    // - os outros pedidos saem; a conta sai (cascata: sessões, chamados, mensagens, links de senha);
    // - os registros antigos do admin_log perdem o email (fica o HMAC): quem se cadastrar depois com o mesmo email não vê o histórico.
    // Pedido aberto impede: o link dele ainda pode ser pago.
    const [x] = await sql`with a as (select email from usuarios where email = ${alvo}
          and not exists (select 1 from pedidos where email = ${alvo} and status in ('pago', 'gerando', 'aguardando_pagamento', 'aguardando_confirmacao'))),
        pk as (update pedidos set email = ${"excluida:" + h}, respostas = null, fotos = null, plano_gerado = null, mensagem_usuario = null,
            aceite = null, comprovante = null, pagador_nome = null, pix_e2e_informado = null, erro = null, checkout_ref = null
          where email in (select email from a) and (pago_em is not null or estornado_em is not null)),
        pd as (delete from pedidos where email in (select email from a) and pago_em is null and estornado_em is null),
        d as (delete from usuarios where email in (select email from a) returning email),
        hl as (update admin_log set alvo_email = null, detalhes = coalesce(detalhes, '{}'::jsonb) - 'texto' - 'email_sha256' || jsonb_build_object('email_hmac', ${h}::text)
          where alvo_email = ${alvo} and exists (select 1 from d)),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes)
          select ${u.email}, 'conta_excluida', null, jsonb_build_object('email_hmac', ${h}::text) from d)
      select true as ok from d`;
    if (x) return ok({});
    const [d] = await sql`select exists (select 1 from usuarios where email = ${alvo}) as existe,
      exists (select 1 from pedidos where email = ${alvo} and status in ('pago', 'gerando')) as andamento,
      exists (select 1 from pedidos where email = ${alvo} and status in ('aguardando_pagamento', 'aguardando_confirmacao')) as aberto`;
    if (d && d.andamento) return falha(400, "Esta conta tem um pedido pago ou gerando o treino. Resolva antes (gere o treino ou registre a devolução).");
    if (d && d.aberto) return falha(400, "Esta conta tem um pedido aguardando pagamento. Cancele o pedido antes de excluir.");
    return falha(404, "Usuário não encontrado.");
  }

  if (b.op === "usuario") {
    const [x] = await sql`select nome, email, criado, acesso_ate, dados, grupo,
      coalesce(jsonb_array_length(dados->'checkins'), 0)::int as checkins, dados->'checkins'->>-1 as ultimo, dados->'plano' is not null as tem_treino from usuarios where email = ${alvo}`;
    if (!x) return falha(404, "Usuário não encontrado.");
    const historico = await sql`select criado, admin_email, acao, detalhes from admin_log where alvo_email = ${alvo} order by criado desc limit 20`;
    const d = limpar(x.dados);
    return ok({ ...linha(x), plano: d.plano || null, sessoes: d.sessoes, grupo: x.grupo || null, historico, nomes: NOMES_FOTOS, podeExcluir: !!segredo() });
  }

  // Cada escrita e o seu registro no admin_log vão numa única instrução: nunca há alteração sem log.
  if (b.op === "acesso") {
    const formas = ["dias", "ate", "cortar"].filter((k) => b[k] !== undefined);
    if (formas.length !== 1) return falha(400, "Escolha uma forma: dias, data ou cortar.");
    let x;
    if (b.dias !== undefined) {
      if (!Number.isInteger(b.dias) || b.dias < 1 || b.dias > 365) return falha(400, "Os dias precisam ser um número inteiro de 1 a 365.");
      [x] = await sql`with a as (update usuarios set acesso_ate = greatest(now(), coalesce(acesso_ate, now())) + make_interval(days => ${b.dias})
          where email = ${alvo} returning email, acesso_ate),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select ${u.email}, 'acesso', email, ${JSON.stringify({ dias: b.dias })}::jsonb from a)
        select acesso_ate from a`;
    } else if (b.ate !== undefined) {
      const dt = typeof b.ate === "string" && DIA.test(b.ate) ? new Date(b.ate + "T00:00:00Z") : null;
      if (!dt || isNaN(dt) || dt.getUTCFullYear() < 2000 || dt.toISOString().slice(0, 10) !== b.ate)
        return falha(400, "Data inválida.");
      // Fim do dia escolhido no horário de Brasília = início do dia seguinte lá, independente do fuso do servidor.
      [x] = await sql`with a as (update usuarios set acesso_ate = ((${b.ate}::date + 1)::timestamp at time zone 'America/Sao_Paulo')
          where email = ${alvo} and ${b.ate}::date between (now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date + 730
          returning email, acesso_ate),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select ${u.email}, 'acesso', email, ${JSON.stringify({ ate: b.ate })}::jsonb from a)
        select acesso_ate from a`;
      if (!x && !(await naoExiste())) return falha(400, "A data precisa ser de hoje até daqui a 2 anos.");
    } else {
      if (b.cortar !== true) return falha(400, "Requisição inválida.");
      [x] = await sql`with a as (update usuarios set acesso_ate = now() where email = ${alvo} returning email, acesso_ate),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select ${u.email}, 'acesso', email, '{"cortar":true}'::jsonb from a)
        select acesso_ate from a`;
    }
    if (!x) return falha(404, "Usuário não encontrado.");
    return ok({ acessoAte: x.acesso_ate });
  }

  // Treino: só a chave "plano" (e "proximo", se apontar para um treino que sumiu) muda dentro de "dados";
  // check-ins, cargas e sessões ficam como estão.
  let plano = null;
  if (b.op === "plano_salvar") {
    const v = validarPlano(b.plano);
    if (v.erro) return falha(400, v.erro);
    plano = v.plano;
  } else if (b.op === "plano_pdf") {
    const r = await lerPdf(b.pdf);
    if (!r.plano) return falha(r.status, r.erro);
    plano = r.plano;
  }
  let x;
  if (plano) {
    const ids = plano.treinos.map((t) => t.id);
    const det = { treinos: ids.length, exercicios: plano.treinos.reduce((s, t) => s + t.exercicios.length, 0) };
    // Editar um plano de IA (decisão D4) mantém origem, criado, semanas, pedido e guia: continua pago e a contagem das 8 semanas não zera.
    // Já o PDF do admin substitui o plano de IA por inteiro (o painel avisa antes).
    [x] = await sql`with a as (update usuarios set dados = jsonb_set(dados, '{plano}', ${JSON.stringify(plano)}::jsonb
            || case when ${b.op === "plano_salvar"}::boolean and dados->'plano'->>'origem' = 'ia' then (dados->'plano') - 'nome' - 'treinos' else '{}'::jsonb end)
          || case when dados->>'proximo' = any(${ids}::text[]) then '{}'::jsonb else jsonb_build_object('proximo', ${ids[0]}::text) end
          where email = ${alvo} returning email),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select ${u.email}, ${b.op}, email, ${JSON.stringify(det)}::jsonb from a)
        select email from a`;
  } else if (b.op === "plano_remover") {
    [x] = await sql`with a as (update usuarios set dados = dados - 'plano' where email = ${alvo} returning email),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select ${u.email}, 'plano_remover', email, '{}'::jsonb from a)
        select email from a`;
  } else return falha(400, "Operação desconhecida."); // op nova em OPS sem ramo próprio nunca cai num remover
  if (!x) return falha(404, "Usuário não encontrado.");
  return ok({ plano });
}
