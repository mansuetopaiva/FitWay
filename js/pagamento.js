/* FitWay — pagamento de um pedido (#/pagamento/<id>). Baixado só quando a pessoa abre.
   O servidor decide meio, valor e status (api/_pagamento.js); aqui só se mostra e se pede. */
(function () {
  "use strict";
  const { api, esc, toast, shell, $, app } = window.FitWay;
  const TIT = "Pagamento";
  const reais = (c) => "R$ " + (c / 100).toFixed(2).replace(".", ",");
  const E2E = /^E[A-Za-z0-9]{31}$/;
  const NOMES = { inicial: "Treino personalizado", mensalidade: "Renovação do acesso (30 dias)", novo_treino: "Novo treino" };
  // Último retorno do checkout do cartão, para "Já paguei, verificar" depois de recarregar a página.
  const ses = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
  };
  const chaveRetorno = (pid) => "fw_cartao_" + pid;

  let id = "", st = null, escolher = false, comp = "", nomePagador = "", e2e = "", ocupado = false, aviso = "";
  const aqui = () => location.hash.split("/")[1] === "pagamento" && location.hash.split("/")[2] === id;
  const sem = (e) => (e.status ? e.message : "Sem conexão com o servidor. Tente de novo.");
  // 400: o pedido mudou (pago, avisado ou cancelado em outra aba). Relê para não oferecer de novo o mesmo botão.
  async function recusado(e) {
    ocupado = false;
    if (!aqui()) return toast(sem(e));
    if (e.status === 400) { try { st = await api("pagamento", { id }); escolher = false; } catch (e2) { /* fica a tela que estava */ } }
    if (aqui()) { pintar(false); toast(sem(e)); }
  }
  // Voltou do checkout pelo botão Voltar (página restaurada do cache): solta o botão "Abrindo…".
  window.addEventListener("pageshow", (ev) => { if (ev.persisted && st && aqui()) { ocupado = false; pintar(false); } });

  async function render(pid) {
    id = pid || ""; st = null; escolher = false; comp = ""; e2e = ""; ocupado = false; aviso = "";
    nomePagador = window.FitWay.nome || "";
    shell(TIT, `<p class="muted" style="margin-top:16px">Carregando…</p>`, "perfil");
    try { st = await api("pagamento", { id }); }
    catch (e) { return aqui() && shell(TIT, `<p class="err" role="alert" style="margin-top:16px">${esc(sem(e))}</p><a class="btn-sec pag-voltar" href="#/perfil">Voltar ao perfil</a>`, "perfil"); }
    if (!aqui()) return;
    // Volta do checkout do cartão: confere uma vez ao abrir (o webhook pode ter chegado antes ou não).
    const ret = ses.get(chaveRetorno(id));
    if (ret && ret.novo && st.pedido.status === "aguardando_pagamento") { ses.set(chaveRetorno(id), { ...ret, novo: false }); return verificar(true); }
    pintar(true);
  }

  function corpo() {
    const p = st.pedido;
    const topo = `<p class="muted">${esc(NOMES[p.tipo] || "")}${p.codigo ? ` · pedido <b class="pag-codigo">${esc(p.codigo)}</b>` : ""}</p>`;
    if (p.status === "aguardando_confirmacao")
      return topo + `<p class="ia-status">Recebemos seu aviso.</p><p>Estamos conferindo o Pix (até 24 horas). Você pode sair desta tela.</p>`;
    if (p.status !== "aguardando_pagamento")
      return topo + (["pago", "gerando", "pronto"].includes(p.status) ? `<p class="ia-status ok">Pagamento confirmado.</p>` : `<p class="ia-status">Este pedido não está aguardando pagamento.</p>`);
    const msg = p.mensagem_usuario ? `<div class="ped-aviso" role="alert"><p>${esc(p.mensagem_usuario)}</p></div>` : "";
    if (!st.metodos.length) return topo + msg + `<p class="ia-status">Pagamento indisponível no momento.</p><p class="muted">Tente de novo mais tarde.</p>`;
    const meio = st.metodos.find((m) => m.metodo === p.metodo);
    if (escolher || !meio) {
      const rot = { pix: (v) => `Pix — ${reais(v)}`, cartao: (v) => `Cartão de crédito — ${reais(v)}` };
      return topo + msg + `<h3 class="pag-sub">Como quer pagar?</h3><div class="pag-meios">
        ${st.metodos.map((m) => `<button type="button" class="pag-meio" data-metodo="${m.metodo}" ${ocupado ? "disabled" : ""}>${rot[m.metodo](m.valor)}</button>`).join("")}</div>`;
    }
    const trocar = st.metodos.length > 1 ? `<button type="button" class="btn-sec pag-trocar" data-trocar>Trocar meio de pagamento</button>` : "";
    if (p.metodo === "pix") return topo + msg + pixHtml(p) + trocar;
    const ret = ses.get(chaveRetorno(id));
    if (ret || aviso) return topo + msg + `<p class="ia-status">${esc(aviso || "Pagamento ainda não confirmado.")}</p>
      <p class="muted">Se você já pagou, a confirmação pode levar alguns minutos.</p>
      <div class="pag-botoes">${ret ? `<button type="button" class="btn" data-verificar ${ocupado ? "disabled" : ""}>Já paguei, verificar</button>` : ""}
      <button type="button" class="btn-sec" data-cartao ${ocupado ? "disabled" : ""}>Abrir o pagamento de novo</button></div>` + trocar;
    return topo + msg + `<div class="row ped-total"><span>Valor</span><b>${reais(p.valor)}</b></div>
      <p class="muted">Você vai para a página segura da InfinitePay e volta para cá depois de pagar.</p>
      <button type="button" class="btn" data-cartao ${ocupado ? "disabled" : ""}>${ocupado ? "Abrindo…" : `Pagar ${reais(p.valor)} com cartão`}</button>` + trocar;
  }

  function pixHtml(p) {
    const rec = st.pix && st.pix.recebedor;
    return `<div class="row ped-total"><span>Valor</span><b>${reais(p.valor)}</b></div>
      ${st.pix ? `<a class="btn pag-link" id="pixLink" target="_blank" rel="noopener noreferrer">Pagar ${reais(p.valor)} com Pix<span class="sr"> (abre em nova aba)</span></a>` : ""}
      ${rec ? `<p class="muted pag-rec">Recebedor: ${esc(rec)}. No app do banco aparece o nome do titular da conta Pix.</p>` : ""}
      <p class="pag-anote">Anote o código do pedido: <b class="pag-codigo">${esc(p.codigo || "—")}</b></p>
      <ol class="pag-passos">
        <li>Pague pelo link (o valor já vem preenchido).</li>
        <li>Volte aqui, anexe o comprovante e toque em Já paguei. A confirmação é feita em até 24 horas.</li>
      </ol>
      <form id="pagForm" novalidate class="pag-form">
        <div class="field"><label for="pagNome">Nome de quem pagou</label>
          <input id="pagNome" name="nome" maxlength="80" autocomplete="name" value="${esc(nomePagador)}"></div>
        <div class="field"><span class="pag-rot" id="compRot">Comprovante do Pix</span>
          ${comp ? `<img class="pag-comp" src="${esc(comp)}" alt="Comprovante anexado">` : ""}
          <input type="file" accept="image/*" id="pagComp" class="sr" aria-describedby="compRot">
          <label class="btn-sec pag-anexar" for="pagComp">${comp ? "Trocar comprovante" : "Anexar comprovante"}</label></div>
        <div class="field"><label for="pagE2e">ID da transação <span class="muted">(opcional, está no comprovante e começa com E)</span></label>
          <input id="pagE2e" name="e2e" maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(e2e)}"></div>
        <p class="err" role="alert" id="pagErr"></p>
        ${comp ? "" : `<p class="muted" id="pagFalta">Anexe o comprovante para tocar em Já paguei.</p>`}
        <button class="btn" type="submit" ${!comp || ocupado ? "disabled" : ""} ${comp ? "" : 'aria-describedby="pagFalta"'}>${ocupado ? "Enviando…" : "Já paguei"}</button>
      </form>`;
  }

  function pintar(foco) {
    shell(TIT, `<a class="adm-voltar" href="#/perfil">${window.FitWay.icon("back")}Perfil</a>
      <section class="card ped pag"><h2 id="pagTit" tabindex="-1">${st.pedido.status === "aguardando_pagamento" && !escolher && st.pedido.metodo === "pix" ? "Pagar com Pix" : "Pagamento"}</h2>${corpo()}</section>`, "perfil");
    if (foco) $("#pagTit").focus();
    const link = $("#pixLink");
    if (link) link.href = st.pix.link; // atribuído pelo DOM, nunca montado no HTML
    app.querySelectorAll("[data-metodo]").forEach((b) => b.onclick = () => escolherMeio(b.dataset.metodo));
    const tr = $("[data-trocar]"); if (tr) tr.onclick = () => { escolher = true; aviso = ""; pintar(true); };
    app.querySelectorAll("[data-cartao]").forEach((b) => b.onclick = abrirCartao);
    const vf = $("[data-verificar]"); if (vf) vf.onclick = () => verificar(false);
    const f = $("#pagForm");
    if (f) {
      f.oninput = () => { nomePagador = $("#pagNome").value; e2e = $("#pagE2e").value; };
      $("#pagComp").onchange = () => lerComprovante($("#pagComp"));
      f.onsubmit = (ev) => { ev.preventDefault(); avisar(); };
    }
  }

  async function escolherMeio(metodo) {
    if (ocupado) return;
    ocupado = true; pintar(false);
    try {
      const r = await api("pedido_metodo", { id, metodo });
      st.pedido = r.pedido; if (r.pix) st.pix = r.pix;
      escolher = false; aviso = "";
    } catch (e) { return recusado(e); }
    ocupado = false;
    if (!aqui()) return;
    if (metodo === "cartao" && st.pedido.metodo === "cartao") return abrirCartao();
    pintar(true);
  }

  async function abrirCartao() {
    if (ocupado) return;
    ocupado = true; pintar(false);
    try {
      const { url } = await api("pagar_cartao", { id });
      location.href = url; // página da InfinitePay; a volta traz os parâmetros para confirmar
    } catch (e) { recusado(e); }
  }

  // Confere o pagamento do cartão com o último retorno guardado. auto: ao voltar do checkout.
  async function verificar(auto) {
    const ret = ses.get(chaveRetorno(id));
    if (!ret) return pintar(true);
    ocupado = true;
    if (!auto) pintar(false); else shell(TIT, `<p class="muted" style="margin-top:16px" role="status">Confirmando o pagamento…</p>`, "perfil");
    try {
      const r = await api("confirmar_cartao", { order_nsu: id, transaction_nsu: ret.transaction_nsu, slug: ret.slug });
      st = await api("pagamento", { id });
      aviso = r.resultado === "temporario" ? "Não conseguimos confirmar agora. Tente verificar de novo daqui a pouco." : "";
      if (r.resultado === "sobra") toast("Este pedido já estava fechado. Seu pagamento ficou registrado para devolução.");
      else if (["pago", "gerando", "pronto"].includes(st.pedido.status)) toast("Pagamento confirmado.");
    } catch (e) { toast(sem(e)); }
    ocupado = false;
    if (aqui() && st) pintar(true);
  }

  async function avisar() {
    const err = $("#pagErr");
    nomePagador = $("#pagNome").value.trim(); e2e = $("#pagE2e").value.trim();
    if (nomePagador.length < 2) { err.textContent = "Digite o nome de quem pagou."; return $("#pagNome").focus(); }
    if (!comp) { err.textContent = "Anexe o comprovante do Pix."; return; }
    if (e2e && !E2E.test(e2e)) { err.textContent = "O ID da transação começa com E e tem 32 letras e números. Confira ou deixe em branco."; return $("#pagE2e").focus(); }
    if (ocupado) return;
    ocupado = true; pintar(false);
    try {
      const r = await api("pix_avisei", { id, pagador_nome: nomePagador, comprovante: comp, pix_e2e: e2e || undefined });
      st.pedido = r.pedido;
      toast("Aviso enviado. A confirmação é feita em até 24 horas.");
    } catch (e) {
      if (e.status === 400 && !/nome|comprovante|ID da transação/.test(e.message)) return recusado(e); // o pedido mudou; erro do formulário fica no formulário
      ocupado = false;
      if (!aqui()) return toast(sem(e));
      pintar(false);
      return ($("#pagErr").textContent = sem(e));
    }
    ocupado = false;
    if (aqui()) pintar(true);
  }

  // Comprovante reduzido no aparelho, como as fotos: JPEG de até ~300 KB. Print de celular é alto e cheio de texto:
  // tenta lados maiores primeiro para o texto continuar legível.
  async function lerComprovante(input) {
    const arq = input.files[0];
    input.value = "";
    if (!arq) return;
    let img;
    try { img = await createImageBitmap(arq); } catch (e) { return toast("Não consegui abrir esta imagem."); }
    let url = "";
    for (const lado of [1600, 1200, 900]) {
      const s = Math.min(1, lado / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.8, 0.6]) { url = c.toDataURL("image/jpeg", q); if (url.length <= 409000) break; }
      if (url.length <= 409000) break;
    }
    if (img.close) img.close();
    if (url.length > 409000) return toast("Este comprovante ficou grande demais. Tente um print só da parte do Pix.");
    comp = url;
    if (!aqui()) return;
    pintar(false);
    $("#pagComp").focus();
  }

  window.FitWayPagamento = { render };
})();
