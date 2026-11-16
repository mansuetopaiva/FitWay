/* FitWay — pagamento de um pedido (#/pagamento/<id>). Baixado só quando a pessoa abre.
   O servidor decide meio, valor e status (api/_pagamento.js); aqui só se mostra e se pede. O pagamento é feito
   no checkout do InfinitePay e confirmado pelo servidor (payment_check). */
(function () {
  "use strict";
  const { api, esc, toast, shell, $, app } = window.FitWay;
  const TIT = "Pagamento";
  const reais = (c) => "R$ " + (c / 100).toFixed(2).replace(".", ",");
  const NOMES = { inicial: "Treino personalizado", mensalidade: "Renovação do acesso (30 dias)", novo_treino: "Novo treino" };
  const ROTULOS = { pix: (v) => `Pix — ${reais(v)}`, cartao: (v) => `Cartão de crédito — ${reais(v)}` };
  // Último retorno do checkout, para "Já paguei, verificar" depois de recarregar a página.
  const ses = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
  };
  const chaveRetorno = (pid) => "fw_cartao_" + pid;

  let id = "", st = null, escolher = false, ocupado = false, aviso = "";
  const aqui = () => location.hash.split("/")[1] === "pagamento" && location.hash.split("/")[2] === id;
  const sem = (e) => (e.status ? e.message : "Sem conexão com o servidor. Tente de novo.");
  // 400: o pedido mudou (pago ou cancelado em outra aba). Relê para não oferecer de novo o mesmo botão.
  async function recusado(e) {
    ocupado = false;
    if (!aqui()) return toast(sem(e));
    if (e.status === 400) { try { st = await api("pagamento", { id }); escolher = false; } catch (e2) { /* fica a tela que estava */ } }
    if (aqui()) { pintar(false); toast(sem(e)); }
  }
  // Voltou do checkout pelo botão Voltar (página restaurada do cache): solta o botão "Abrindo…".
  window.addEventListener("pageshow", (ev) => { if (ev.persisted && st && aqui()) { ocupado = false; pintar(false); } });

  async function render(pid) {
    id = pid || ""; st = null; escolher = false; ocupado = false; aviso = "";
    shell(TIT, `<p class="muted" style="margin-top:16px">Carregando…</p>`, "perfil");
    try { st = await api("pagamento", { id }); }
    catch (e) { return aqui() && shell(TIT, `<p class="err" role="alert" style="margin-top:16px">${esc(sem(e))}</p><a class="btn-sec pag-voltar" href="#/perfil">Voltar ao perfil</a>`, "perfil"); }
    if (!aqui()) return;
    // Volta do checkout: confere uma vez ao abrir (o webhook pode ter chegado antes ou não).
    const ret = ses.get(chaveRetorno(id));
    if (ret && ret.novo && st.pedido.status === "aguardando_pagamento") { ses.set(chaveRetorno(id), { ...ret, novo: false }); return verificar(true); }
    pintar(true);
  }

  function corpo() {
    const p = st.pedido, dis = ocupado ? "disabled" : "";
    const topo = `<p class="muted">${esc(NOMES[p.tipo] || "")}</p>`;
    if (["pago", "gerando", "pronto"].includes(p.status)) return topo + `<p class="ia-status ok">Pagamento confirmado.</p>`;
    if (p.status === "aguardando_confirmacao") return topo + `<p class="ia-status">Seu pedido está em análise.</p>`; // Pix manual antigo
    if (p.status !== "aguardando_pagamento") return topo + `<p class="ia-status">Este pedido não está aguardando pagamento.</p>`;
    if (!st.metodos.length) return topo + `<p class="ia-status">Pagamento indisponível no momento.</p><p class="muted">Tente de novo mais tarde.</p>`;
    const meio = st.metodos.find((m) => m.metodo === p.metodo), ret = ses.get(chaveRetorno(id));
    const trocar = st.metodos.length > 1 ? `<button type="button" class="btn-sec pag-trocar" data-trocar>Trocar meio de pagamento</button>` : "";
    if (!escolher && meio && (ret || aviso)) return topo + `<p class="ia-status">${esc(aviso || "Pagamento ainda não confirmado.")}</p>
      <p class="muted">Se você já pagou, a confirmação pode levar alguns minutos.</p>
      <div class="pag-botoes">${ret ? `<button type="button" class="btn" data-verificar ${dis}>Já paguei, verificar</button>` : ""}
      <button type="button" class="btn-sec" data-metodo="${meio.metodo}" ${dis}>Abrir o pagamento de novo</button></div>` + trocar;
    return topo + `<h3 class="pag-sub">Como quer pagar?</h3><div class="pag-meios">
      ${st.metodos.map((m) => `<button type="button" class="pag-meio" data-metodo="${m.metodo}" ${dis}>${ROTULOS[m.metodo](m.valor)}</button>`).join("")}</div>
      <p class="muted">${ocupado ? "Abrindo o pagamento…" : "Você vai para a página segura da InfinitePay e volta para cá depois de pagar."}</p>`;
  }

  function pintar(foco) {
    shell(TIT, `<a class="adm-voltar" href="#/perfil">${window.FitWay.icon("back")}Perfil</a>
      <section class="card ped pag"><h2 id="pagTit" tabindex="-1">Pagamento</h2>${corpo()}</section>`, "perfil");
    if (foco) $("#pagTit").focus();
    app.querySelectorAll("[data-metodo]").forEach((b) => b.onclick = () => pagar(b.dataset.metodo));
    const tr = $("[data-trocar]"); if (tr) tr.onclick = () => { escolher = true; aviso = ""; pintar(true); };
    const vf = $("[data-verificar]"); if (vf) vf.onclick = () => verificar(false);
  }

  // Cria (ou reaproveita) o link do InfinitePay do meio escolhido e vai para o checkout.
  async function pagar(metodo) {
    if (ocupado) return;
    ocupado = true; pintar(false);
    try {
      const { url } = await api("pagar_cartao", { id, metodo });
      location.href = url; // página da InfinitePay; a volta traz os parâmetros para confirmar
    } catch (e) { recusado(e); }
  }

  // Confere o pagamento com o último retorno guardado. auto: ao voltar do checkout.
  async function verificar(auto) {
    const ret = ses.get(chaveRetorno(id));
    if (!ret) return pintar(true);
    ocupado = true;
    if (!auto) pintar(false); else shell(TIT, `<p class="muted" style="margin-top:16px" role="status">Confirmando o pagamento…</p>`, "perfil");
    try {
      const r = await api("confirmar_cartao", { order_nsu: id, transaction_nsu: ret.transaction_nsu, slug: ret.slug });
      st = await api("pagamento", { id });
      aviso = r.resultado === "temporario" ? "Não conseguimos confirmar agora. Tente verificar de novo daqui a pouco." : "";
      escolher = false;
      if (r.resultado === "sobra") toast("Este pedido já estava fechado. Seu pagamento ficou registrado para devolução.");
      else if (["pago", "gerando", "pronto"].includes(st.pedido.status)) toast("Pagamento confirmado.");
    } catch (e) { toast(sem(e)); }
    ocupado = false;
    if (aqui() && st) pintar(true);
  }

  window.FitWayPagamento = { render };
})();
