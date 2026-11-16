// Pagamento dos pedidos pelo checkout do InfinitePay. O "_" impede a Vercel de expor como rota.
// Recebe sql (e fetch) por parâmetro para o teste. Nenhuma ação do usuário grava "pago": só aplicarPagamento, chamado por confirmarCartao.
import { efeitoDoPagamento, metodosDisponiveis, precoDe } from "./_precos.js";

export const ACOES = ["pagamento", "pagar_cartao", "confirmar_cartao"];
const idValido = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v);
const ok = (corpo) => ({ status: 200, corpo });
const falha = (status, erro) => ({ status, corpo: { erro } });
const INDISPONIVEL = "Pagamento indisponível no momento.";

const meios = (tipo) => metodosDisponiveis(tipo).map((metodo) => ({ metodo, valor: precoDe(metodo, tipo) }));

// Marca como pago numa instrução só: pedido, dias de acesso e admin_log. UPDATE condicional: dois cliques ou um
// webhook repetido não somam dias (a 2ª chamada não acha a linha). Sem linha devolvida, nada mudou.
// opc: quem ("infinitepay"), metodo, de (status de onde pode vir), transaction_nsu, checkout_slug e capture_method.
export async function aplicarPagamento(sql, pedido, { quem, metodo, de, transaction_nsu = null, checkout_slug = null, capture_method = null }) {
  const ef = efeitoDoPagamento(pedido.tipo), valor = precoDe(metodo, pedido.tipo);
  if (!ef || valor === undefined) return null;
  const status = ef.gerar ? "pago" : "pronto";
  const [x] = await sql`with p as (update pedidos set status = ${status}, pago_em = now(), atualizado = now(), metodo = ${metodo}, valor = ${valor},
          confirmado_por = ${quem}, transaction_nsu = coalesce(${transaction_nsu}::text, transaction_nsu),
          checkout_slug = coalesce(${checkout_slug}::text, checkout_slug), capture_method = coalesce(${capture_method}::text, capture_method), mensagem_usuario = null
        where id = ${pedido.id} and status = any(${de}::text[]) and tipo = ${pedido.tipo}
          and (${transaction_nsu}::text is null or transaction_nsu is null)
        returning id, email, tipo, valor, status),
      a as (update usuarios set acesso_ate = greatest(now(), acesso_ate) + make_interval(days => ${ef.dias}::int)
        where email = (select email from p) and ${ef.dias}::int > 0 returning acesso_ate),
      l as (insert into admin_log (admin_email, acao, alvo_email, detalhes)
        select ${quem}, 'pedido_pago', email, jsonb_build_object('pedido', id, 'tipo', tipo, 'valor', valor, 'dias', ${ef.dias}::int,
          'metodo', ${metodo}::text, 'transaction_nsu', ${transaction_nsu}::text) from p)
    select p.status, (select acesso_ate from a) as acesso_ate from p`;
  return x || null;
}

// ---------- cartão (InfinitePay) ----------
const API = "https://api.checkout.infinitepay.io";
const REF = /^[A-Za-z0-9_-]{1,100}$/; // transaction_nsu e slug: só o formato, nunca enviados sem esta checagem
async function postar(fetch, caminho, corpo) {
  return fetch(API + caminho, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(10000) });
}

// Webhook, volta do checkout e "Verificar no InfinitePay". Nunca usa valor nem "paid" vindos de fora:
// só o payment_check, com o handle do servidor. Devolve "pago", "ignorado", "recusado", "temporario" ou "sobra"
// (pago de verdade num pedido que já não está aberto: fica no admin_log para o admin devolver o dinheiro).
const ABERTO = ["aguardando_pagamento", "aguardando_confirmacao"];
export async function confirmarCartao(sql, ref, { fetch = globalThis.fetch } = {}) {
  const handle = process.env.INFINITEPAY_HANDLE;
  const txt = (v) => (typeof v === "string" || (typeof v === "number" && Number.isSafeInteger(v)) ? String(v) : "");
  const order_nsu = txt(ref.order_nsu), transaction_nsu = txt(ref.transaction_nsu), slug = txt(ref.slug);
  if (!handle || !idValido(order_nsu) || !REF.test(transaction_nsu) || !REF.test(slug)) return "ignorado";
  // Pedido que tem ou teve link de cartão (P3), em qualquer status: um link pago depois do pedido fechado também precisa aparecer.
  const [p] = await sql`select id, tipo, status, email, transaction_nsu from pedidos where id = ${order_nsu} and (metodo = 'cartao' or checkout_url is not null)`;
  if (!p || p.transaction_nsu === transaction_nsu) return "ignorado"; // não é cartão, ou webhook repetido de um pagamento já aplicado
  // O webhook não tem assinatura nem login: no máximo uma consulta ao InfinitePay a cada 10 s por pedido.
  const [vez] = await sql`update pedidos set checado_em = now() where id = ${p.id} and (checado_em is null or checado_em < now() - interval '10 seconds') returning id`;
  if (!vez) return "temporario";
  let j;
  try {
    const r = await postar(fetch, "/payment_check", { handle, order_nsu, transaction_nsu, slug });
    if (r.status >= 500 || r.status === 429) return "temporario";
    if (!r.ok) return "recusado";
    j = await r.json();
  } catch (e) {
    return "temporario"; // rede, tempo esgotado ou resposta que não é JSON
  }
  if (!j || j.success !== true || (j.order_nsu !== undefined && String(j.order_nsu) !== order_nsu)) return "recusado";
  // Guarda o par para o "Verificar no InfinitePay" só depois que o InfinitePay o reconheceu: lixo não troca um par bom.
  await sql`update pedidos set checkout_ref = ${JSON.stringify({ slug, transaction_nsu })}::jsonb where id = ${p.id} and status = any(${ABERTO}::text[])`;
  if (j.paid !== true) return "recusado";
  const pago = typeof j.paid_amount === "number" ? Math.round(j.paid_amount) : null;
  // Registra o dinheiro recebido sem pedido aberto, uma vez por pagamento (e nunca um pagamento que já confirmou algum pedido).
  const sobra = async () => {
    await sql`insert into admin_log (admin_email, acao, alvo_email, detalhes)
      select 'infinitepay', 'cartao_sem_pedido', ${p.email}, jsonb_build_object('pedido', ${p.id}::text, 'transaction_nsu', ${transaction_nsu}::text, 'slug', ${slug}::text, 'paid_amount', ${pago}::int)
      where not exists (select 1 from pedidos where transaction_nsu = ${transaction_nsu} or checkout_slug = ${slug})
        and not exists (select 1 from admin_log where acao = 'cartao_sem_pedido' and detalhes->>'transaction_nsu' = ${transaction_nsu})`;
    return "sobra";
  };
  if (!ABERTO.includes(p.status)) return sobra();
  const minimo = precoDe("cartao", p.tipo);
  // paid_amount pode passar de amount (juros do parcelamento pagos pelo comprador); nenhum dos dois pode ser menor que o preço do cartão.
  if (!(pago !== null && pago >= minimo) || (typeof j.amount === "number" && j.amount < minimo)) return "recusado";
  const cm = typeof j.capture_method === "string" ? j.capture_method.slice(0, 20) : null;
  try {
    const x = await aplicarPagamento(sql, p, { quem: "infinitepay", metodo: "cartao", de: ABERTO, transaction_nsu, checkout_slug: slug, capture_method: cm });
    return x ? "pago" : sobra(); // fechou entre a leitura e a gravação
  } catch (e) {
    if (e && e.code === "23505") return "ignorado"; // transaction_nsu ou slug já usado em outro pedido
    throw e;
  }
}

// ---------- ações do usuário ----------
export async function acaoPagamento(sql, u, b, { fetch = globalThis.fetch } = {}) {
  if (b.acao === "confirmar_cartao") {
    if (!idValido(b.order_nsu)) return falha(400, "Pedido inválido.");
    const [p] = await sql`select id from pedidos where id = ${b.order_nsu} and email = ${u.email}`;
    if (!p) return falha(404, "Pedido não encontrado.");
    const r = await confirmarCartao(sql, { order_nsu: b.order_nsu, transaction_nsu: b.transaction_nsu, slug: b.slug }, { fetch });
    const [x] = await sql`select status from pedidos where id = ${p.id}`;
    return ok({ resultado: r, status: x && x.status });
  }
  if (!idValido(b.id)) return falha(400, "Pedido inválido.");
  const [p] = await sql`select id, tipo, status, metodo, valor, checkout_url from pedidos where id = ${b.id} and email = ${u.email}`;
  if (!p) return falha(404, "Pedido não encontrado.");
  const pendente = p.status === "aguardando_pagamento";

  if (b.acao === "pagamento") {
    const { checkout_url, ...pedido } = p;
    return ok({ pedido, metodos: meios(p.tipo) });
  }

  if (b.acao === "pagar_cartao") {
    if (!metodosDisponiveis(p.tipo).includes("cartao")) return falha(400, INDISPONIVEL);
    if (!pendente) return falha(400, "Este pedido não está aguardando pagamento.");
    const valor = precoDe("cartao", p.tipo);
    const [x] = await sql`update pedidos set metodo = 'cartao', valor = ${valor}, atualizado = now()
      where id = ${p.id} and email = ${u.email} and status = 'aguardando_pagamento' returning id, checkout_url`;
    if (!x) return falha(400, "Este pedido não está aguardando pagamento.");
    if (x.checkout_url) return ok({ url: x.checkout_url }); // o mesmo link: um 2º link do mesmo pedido poderia ser pago duas vezes
    const site = process.env.SITE_URL.replace(/\/+$/, "");
    const NOMES = { inicial: "Treino personalizado FitWay", mensalidade: "Renovação do acesso FitWay (30 dias)", novo_treino: "Novo treino FitWay" };
    let url;
    try {
      const r = await postar(fetch, "/links", {
        handle: process.env.INFINITEPAY_HANDLE, order_nsu: p.id, redirect_url: site + "/", webhook_url: site + "/api/infinitepay",
        items: [{ quantity: 1, price: valor, description: NOMES[p.tipo] }],
        customer: { name: u.nome, email: u.email },
      });
      const j = r.ok ? await r.json() : null;
      url = j && j.url; // P2: a documentação não diz o nome do campo; confirmar com um link real antes de liberar
    } catch (e) { url = null; }
    if (typeof url !== "string" || !/^https:\/\/[^\s"'<>]+$/.test(url)) return falha(502, INDISPONIVEL);
    // Dois cliques ao mesmo tempo: fica o primeiro link gravado, e os dois recebem o mesmo.
    const [g] = await sql`update pedidos set checkout_url = coalesce(checkout_url, ${url}) where id = ${p.id} returning checkout_url`;
    return ok({ url: (g && g.checkout_url) || url });
  }
  return falha(400, "Ação desconhecida.");
}
