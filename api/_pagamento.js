// Pagamento dos pedidos pelo checkout do InfinitePay. O "_" impede a Vercel de expor como rota.
// Recebe sql (e fetch) por parâmetro para o teste. Nenhuma ação do usuário grava "pago": só aplicarPagamento, chamado por confirmarPagamento.
// O checkout aceita Pix e cartão em qualquer link (a documentação: "o cartão fica sempre ligado"; restringir exige API Key):
// cada pedido tem até um link por meio, com o preço daquele meio, e qualquer um deles pago confirma o pedido uma vez.
import { efeitoDoPagamento, metodosDisponiveis, precoDe } from "./_precos.js";

export const ACOES = ["pagamento", "pagar", "confirmar_pagamento"];
const idValido = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v);
const ok = (corpo) => ({ status: 200, corpo });
const falha = (status, erro) => ({ status, corpo: { erro } });
const INDISPONIVEL = "Pagamento indisponível no momento.";

const meios = (tipo) => metodosDisponiveis(tipo).map((metodo) => ({ metodo, valor: precoDe(metodo, tipo) }));

// Marca como pago numa instrução só: pedido, dias de acesso e admin_log. UPDATE condicional: dois cliques ou um
// webhook repetido não somam dias (a 2ª chamada não acha a linha). Sem linha devolvida, nada mudou.
// opc: quem ("infinitepay"), de (status de onde pode vir), valor (centavos pagos, do payment_check), transaction_nsu,
// checkout_slug e capture_method (o meio real). O meio escolhido (metodo) não muda.
export async function aplicarPagamento(sql, pedido, { quem, de, valor, transaction_nsu = null, checkout_slug = null, capture_method = null }) {
  const ef = efeitoDoPagamento(pedido.tipo);
  if (!ef || !Number.isSafeInteger(valor) || valor <= 0) return null;
  const status = ef.gerar ? "pago" : "pronto";
  const [x] = await sql`with p as (update pedidos set status = ${status}, pago_em = now(), atualizado = now(), valor = ${valor},
          confirmado_por = ${quem}, transaction_nsu = coalesce(${transaction_nsu}::text, transaction_nsu),
          checkout_slug = coalesce(${checkout_slug}::text, checkout_slug), capture_method = coalesce(${capture_method}::text, capture_method), mensagem_usuario = null
        where id = ${pedido.id} and status = any(${de}::text[]) and tipo = ${pedido.tipo}
          and (${transaction_nsu}::text is null or transaction_nsu is null)
        returning id, email, tipo, valor, status, metodo),
      a as (update usuarios set acesso_ate = greatest(now(), acesso_ate) + make_interval(days => ${ef.dias}::int)
        where email = (select email from p) and ${ef.dias}::int > 0 returning acesso_ate),
      l as (insert into admin_log (admin_email, acao, alvo_email, detalhes)
        select ${quem}, 'pedido_pago', email, jsonb_build_object('pedido', id, 'tipo', tipo, 'valor', valor, 'dias', ${ef.dias}::int,
          'metodo', metodo, 'capture_method', ${capture_method}::text, 'transaction_nsu', ${transaction_nsu}::text) from p)
    select p.status, (select acesso_ate from a) as acesso_ate from p`;
  return x || null;
}

// ---------- InfinitePay ----------
const API = "https://api.checkout.infinitepay.io";
const REF = /^[A-Za-z0-9_-]{1,100}$/; // transaction_nsu e slug: só o formato, nunca enviados sem esta checagem
async function postar(fetch, caminho, corpo) {
  return fetch(API + caminho, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(10000) });
}

// Diagnóstico nos Runtime Logs da Vercel quando o InfinitePay falha. Nunca o valor do handle, nem nome ou email:
// do corpo saem o handle, os textos de "ocultar" (nome e email do cliente) e qualquer email; das variáveis, só o tamanho.
const corpoDe = async (r) => { try { return String(await r.text()); } catch (e) { return ""; } };
function diagnostico(etapa, { status = null, corpo = "", erro = "", ocultar = [] } = {}) {
  const h = process.env.INFINITEPAY_HANDLE || "", site = process.env.SITE_URL || "";
  let t = String(corpo || "");
  for (const x of [h, ...ocultar]) if (x) t = t.split(x).join("<oculto>");
  t = t.replace(/[^\s"'<>,;:@]+@[^\s"'<>,;:@]+\.[^\s"'<>,;:@]+/g, "<email>").slice(0, 500);
  const tam = (v) => (v ? `presente (${v.length} caracteres)` : "ausente");
  console.error(`[infinitepay] ${etapa} ` + JSON.stringify({ status, corpo: t, erro: String(erro).slice(0, 200),
    INFINITEPAY_HANDLE: tam(h), SITE_URL: tam(site) }));
}

// Webhook, volta do checkout e "Verificar no InfinitePay". Nunca usa valor nem "paid" vindos de fora:
// só o payment_check, com o handle do servidor. Devolve "pago", "ignorado", "recusado", "temporario" ou "sobra"
// (pago de verdade num pedido que já não está aberto: fica no admin_log para o admin devolver o dinheiro).
const ABERTO = ["aguardando_pagamento", "aguardando_confirmacao"];
export async function confirmarPagamento(sql, ref, { fetch = globalThis.fetch } = {}) {
  const handle = process.env.INFINITEPAY_HANDLE;
  const txt = (v) => (typeof v === "string" || (typeof v === "number" && Number.isSafeInteger(v)) ? String(v) : "");
  const order_nsu = txt(ref.order_nsu), transaction_nsu = txt(ref.transaction_nsu), slug = txt(ref.slug);
  if (!handle || !idValido(order_nsu) || !REF.test(transaction_nsu) || !REF.test(slug)) return "ignorado";
  // Pedido com algum link do InfinitePay, em qualquer status: um link pago depois do pedido fechado também precisa aparecer.
  const [p] = await sql`select id, tipo, status, email, transaction_nsu, checkout_url_pix is not null as tem_pix from pedidos
    where id = ${order_nsu} and (checkout_url is not null or checkout_url_pix is not null)`;
  if (!p || p.transaction_nsu === transaction_nsu) return "ignorado"; // sem link, ou webhook repetido de um pagamento já aplicado
  // O webhook não tem assinatura nem login: no máximo uma consulta ao InfinitePay a cada 10 s por pedido.
  const [vez] = await sql`update pedidos set checado_em = now() where id = ${p.id} and (checado_em is null or checado_em < now() - interval '10 seconds') returning id`;
  if (!vez) return "temporario";
  let j;
  try {
    const r = await postar(fetch, "/payment_check", { handle, order_nsu, transaction_nsu, slug });
    if (!r.ok) {
      diagnostico("payment_check falhou", { status: r.status, corpo: await corpoDe(r) });
      return r.status >= 500 || r.status === 429 ? "temporario" : "recusado";
    }
    j = await r.json();
  } catch (e) {
    diagnostico("payment_check falhou", { erro: `${e && e.name}: ${e && e.message}` });
    return "temporario"; // rede, tempo esgotado ou resposta que não é JSON
  }
  if (!j || j.success !== true || (j.order_nsu !== undefined && String(j.order_nsu) !== order_nsu)) {
    diagnostico("payment_check recusou", { status: 200, corpo: JSON.stringify(j) });
    return "recusado";
  }
  // Guarda o par para o "Verificar no InfinitePay" só depois que o InfinitePay o reconheceu: lixo não troca um par bom.
  await sql`update pedidos set checkout_ref = ${JSON.stringify({ slug, transaction_nsu })}::jsonb where id = ${p.id} and status = any(${ABERTO}::text[])`;
  if (j.paid !== true) return "recusado";
  const pago = typeof j.paid_amount === "number" ? Math.round(j.paid_amount) : null;
  // Dinheiro recebido sem liberar o pedido (pedido fechado ou valor menor): registra para o admin devolver, uma vez por
  // pagamento (e nunca um pagamento que já confirmou algum pedido). A ação no log continua 'cartao_sem_pedido' (nome antigo).
  const amount = typeof j.amount === "number" ? Math.round(j.amount) : null;
  const recebido = pago ?? amount;
  const devolver = async (motivo) => {
    if (recebido === null) return;
    await sql`insert into admin_log (admin_email, acao, alvo_email, detalhes)
      select 'infinitepay', 'cartao_sem_pedido', ${p.email}, jsonb_build_object('pedido', ${p.id}::text, 'transaction_nsu', ${transaction_nsu}::text, 'slug', ${slug}::text,
        'paid_amount', ${recebido}::int, 'motivo', ${motivo}::text)
      where not exists (select 1 from pedidos where transaction_nsu = ${transaction_nsu})
        and not exists (select 1 from admin_log where acao = 'cartao_sem_pedido' and detalhes->>'transaction_nsu' = ${transaction_nsu})`;
  };
  const sobra = async () => { await devolver("pedido_fechado"); return "sobra"; };
  if (!ABERTO.includes(p.status)) return sobra();
  // Mínimo: o preço do link mais barato do pedido. O handle é público: alguém pode criar um link próprio de R$ 1,00 com
  // este order_nsu; o valor é o que barra. Pagar o link do Pix com cartão (ou o contrário) vale: o checkout não restringe o meio.
  // O pago também não pode ser menor que o valor do próprio link (amount). paid_amount pode passar de amount (juros do
  // parcelamento pagos pelo comprador). Desconto do Pix ligado nas configurações do checkout faria paid_amount < amount: fica recusado.
  // Sem amount não dá para saber o valor do link pago (um link próprio barato, parcelado com juros, passaria): recusa e registra.
  const base = precoDe(p.tem_pix ? "pix" : "cartao", p.tipo);
  if (pago === null && amount === null) return "recusado";
  if (amount === null || pago === null || amount < base || pago < Math.max(base, amount)) { await devolver("valor_menor"); return "recusado"; }
  // Pagamento que já ficou para devolução (pedido fechado ou valor menor) nunca confirma outro pedido depois: o admin pode
  // já ter devolvido, e o payment_check pode não amarrar o order_nsu (P8).
  if ((await sql`select 1 from admin_log where acao = 'cartao_sem_pedido' and detalhes->>'transaction_nsu' = ${transaction_nsu} limit 1`).length) return "recusado";
  const cm = typeof j.capture_method === "string" ? j.capture_method.slice(0, 20) : null;
  try {
    const x = await aplicarPagamento(sql, p, { quem: "infinitepay", de: ABERTO, valor: amount ?? pago, transaction_nsu, checkout_slug: slug, capture_method: cm });
    return x ? "pago" : sobra(); // fechou entre a leitura e a gravação (ex.: o outro link pago ao mesmo tempo)
  } catch (e) {
    if (e && e.code === "23505") return "ignorado"; // transaction_nsu ou slug já usado em outro pedido
    throw e;
  }
}

// ---------- ações do usuário ----------
export async function acaoPagamento(sql, u, b, { fetch = globalThis.fetch } = {}) {
  if (b.acao === "confirmar_pagamento") {
    if (!idValido(b.order_nsu)) return falha(400, "Pedido inválido.");
    const [p] = await sql`select id from pedidos where id = ${b.order_nsu} and email = ${u.email}`;
    if (!p) return falha(404, "Pedido não encontrado.");
    const r = await confirmarPagamento(sql, { order_nsu: b.order_nsu, transaction_nsu: b.transaction_nsu, slug: b.slug }, { fetch });
    const [x] = await sql`select status from pedidos where id = ${p.id}`;
    return ok({ resultado: r, status: x && x.status });
  }
  if (!idValido(b.id)) return falha(400, "Pedido inválido.");
  const [p] = await sql`select id, tipo, status, metodo, valor from pedidos where id = ${b.id} and email = ${u.email}`;
  if (!p) return falha(404, "Pedido não encontrado.");
  const pendente = p.status === "aguardando_pagamento";

  if (b.acao === "pagamento") return ok({ pedido: p, metodos: meios(p.tipo) });

  if (b.acao === "pagar") {
    const disponiveis = metodosDisponiveis(p.tipo);
    if (!disponiveis.length) { diagnostico("pagar sem INFINITEPAY_HANDLE ou SITE_URL"); return falha(400, INDISPONIVEL); }
    if (!disponiveis.includes(b.metodo)) return falha(400, "Escolha Pix ou cartão.");
    if (!pendente) return falha(400, "Este pedido não está aguardando pagamento.");
    const metodo = b.metodo, valor = precoDe(metodo, p.tipo);
    const [x] = await sql`update pedidos set metodo = ${metodo}, valor = ${valor}, atualizado = now()
      where id = ${p.id} and email = ${u.email} and status = 'aguardando_pagamento' returning checkout_url, checkout_url_pix`;
    if (!x) return falha(400, "Este pedido não está aguardando pagamento.");
    const salvo = (r) => r && (metodo === "pix" ? r.checkout_url_pix : r.checkout_url);
    if (salvo(x)) return ok({ url: salvo(x) }); // "Abrir o pagamento de novo": o mesmo link, nunca um terceiro
    const site = process.env.SITE_URL.replace(/\/+$/, "");
    const NOMES = { inicial: "Treino personalizado FitWay", mensalidade: "Renovação do acesso FitWay (30 dias)", novo_treino: "Novo treino FitWay" };
    let url;
    const ocultar = [u.nome, u.email].filter((x) => typeof x === "string" && x.length >= 2);
    try {
      const r = await postar(fetch, "/links", {
        handle: process.env.INFINITEPAY_HANDLE, order_nsu: p.id, redirect_url: site + "/", webhook_url: site + "/api/infinitepay",
        items: [{ quantity: 1, price: valor, description: NOMES[p.tipo] }],
        customer: { name: u.nome, email: u.email },
      });
      if (!r.ok) { diagnostico("POST /links falhou", { status: r.status, corpo: await corpoDe(r), ocultar }); return falha(502, INDISPONIVEL); }
      const j = await r.json();
      url = j && j.url; // P2: campo "url", confirmado com link real
      if (typeof url !== "string" || !/^https:\/\/([a-z0-9-]+\.)*infinitepay\.io\/[^\s"'<>]*$/.test(url)) {
        diagnostico("POST /links devolveu URL fora do padrão", { status: r.status, corpo: JSON.stringify(j), ocultar });
        return falha(502, INDISPONIVEL);
      }
    } catch (e) {
      diagnostico("POST /links falhou", { erro: `${e && e.name}: ${e && e.message}`, ocultar });
      return falha(502, INDISPONIVEL);
    }
    // Dois cliques ao mesmo tempo: fica o primeiro link gravado daquele meio, e os dois recebem o mesmo. O link do outro meio fica como está.
    const [g] = await sql`update pedidos set checkout_url = case when ${metodo} = 'cartao' then coalesce(checkout_url, ${url}) else checkout_url end,
        checkout_url_pix = case when ${metodo} = 'pix' then coalesce(checkout_url_pix, ${url}) else checkout_url_pix end
      where id = ${p.id} returning checkout_url, checkout_url_pix`;
    return ok({ url: salvo(g) || url });
  }
  return falha(400, "Ação desconhecida.");
}
