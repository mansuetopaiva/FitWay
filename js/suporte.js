/* FitWay — suporte por chamados (#/suporte, #/suporte/novo, #/suporte/<id>). Baixado só quando a pessoa abre.
   O servidor confere a conta em toda ação (api/_suporte.js). Todo texto vem do usuário ou do admin: sempre esc(), nunca HTML. */
(function () {
  "use strict";
  const { api, esc, toast, shell, $, app, icon, erro } = window.FitWay;
  const TIT = "Ajuda e suporte";
  const ASSUNTOS = {
    pagamento: { nome: "Pagamento", ajuda: "Paguei e não liberou, cobrança errada, desistência ou devolução." },
    treino: { nome: "Meu treino", ajuda: "Dúvidas sobre exercícios, ajustes ou trocas." },
    conta: { nome: "Conta e dados", ajuda: "Login, senha, trocar email, excluir a conta ou pedidos sobre seus dados (LGPD)." },
    app: { nome: "Problema no app", ajuda: "Algo travou ou não funciona. Se puder, anexe um print." },
  };
  const SAUDE = "Se sentir dor no peito, falta de ar, tontura ou dor forte, pare o treino e procure atendimento médico. O suporte não substitui atendimento de saúde.";
  const STATUS = { aberto: "Aguardando o suporte", respondido: "Respondido", fechado: "Encerrado" };
  const TIPOS = { inicial: "Treino personalizado", mensalidade: "Renovação", novo_treino: "Novo treino" };
  const ST_PEDIDO = { aguardando_pagamento: "aguardando pagamento", aguardando_confirmacao: "em análise", pago: "pago", gerando: "gerando",
    pronto: "pronto", erro: "com erro", cancelado: "cancelado" };
  const MAX = 2000, MAX_ANEXO = 410000;
  const reais = (c) => "R$ " + (c / 100).toFixed(2).replace(".", ",");
  const quando = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const sem = (e) => (e.status ? e.message : "Sem conexão com o servidor. Tente de novo.");
  const voltar = (href, txt) => `<a class="adm-voltar" href="${href}">${icon("back")}${txt}</a>`;
  const rota = () => location.hash.split("/");
  const aqui = (arg) => rota()[1] === "suporte" && (rota()[2] || "") === (arg || "");

  const erroTela = (topo, msg, de_novo) => {
    shell(TIT, topo + `<div class="adm-estado" role="alert"><p>${esc(msg)}</p><button class="btn-sec" id="supTentar">Tentar de novo</button></div>`, "perfil");
    $("#supTentar").onclick = de_novo;
  };
  let pedidos = null, novo = null, anexo = "", enviando = false, preparando = false;

  let conta = "";
  // A conversa aberta se atualiza sozinha (FitWay.repetir); sair dela ou abrir outra para a consulta anterior.
  let pararConversa = () => {}, geracao = 0, telaN = 0;
  const msgHtml = (m) => `<li class="sup-msg ${m.autor === "admin" ? "sup-admin" : "sup-eu"}">
        <p class="sup-quem"><b>${m.autor === "admin" ? "Suporte FitWay" : "Você"}</b> <span class="muted">${esc(quando(m.criado))}</span></p>
        <div class="sup-texto">${esc(m.texto)}</div>
        ${m.anexo ? `<div class="sup-img"><button type="button" class="btn-sec" data-ver="${esc(String(m.id))}">Ver imagem</button></div>` : ""}</li>`;
  async function render(arg) {
    pararConversa();
    anexo = ""; enviando = false; preparando = false; telaN++;
    if (conta !== window.FitWay.email) { conta = window.FitWay.email; pedidos = null; novo = null; } // outra conta no mesmo aparelho
    if (!arg) return lista();
    if (arg === "novo") return formNovo();
    return conversa(arg);
  }

  // ---------- lista ----------
  async function lista() {
    shell(TIT, `<p class="muted" style="margin-top:16px">Carregando…</p>`, "perfil");
    let r;
    try { r = await api("suporte"); } catch (e) { return aqui("") && erroTela(voltar("#/perfil", "Perfil"), sem(e), lista); }
    if (!aqui("")) return;
    pedidos = r.pedidos;
    window.FitWay.avisoSuporte(r.naoLido);
    const itens = r.chamados.map((c) => `<li><a class="sup-item" href="#/suporte/${encodeURIComponent(c.id)}">
        <span class="sup-item-t">${esc(ASSUNTOS[c.assunto].nome)}${c.nao_lido ? `<i class="ponto" aria-hidden="true"></i><span class="sr">(resposta nova)</span>` : ""}</span>
        <span class="muted">${esc(STATUS[c.status])} · ${esc(quando(c.ultima || c.atualizado))}</span></a></li>`).join("");
    shell(TIT, `${voltar("#/perfil", "Perfil")}
      <section class="card"><h2 id="supTit" tabindex="-1">Seus chamados</h2>
        ${itens ? `<ul class="sup-lista">${itens}</ul>` : `<p class="muted" style="margin:8px 0 4px">Você ainda não abriu nenhum chamado.</p>`}
        <a class="btn sup-abrir" href="#/suporte/novo">Abrir chamado</a>
      </section>`, "perfil");
    $("#supTit").focus();
  }

  // ---------- anexo: reduzido no aparelho (lado maior 1280 px, JPEG), como as fotos ----------
  async function reduzir(f) {
    const img = await createImageBitmap(f);
    for (const [lado, q] of [[1280, 0.8], [1024, 0.7], [800, 0.6]]) {
      const k = Math.min(1, lado / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", q);
      if (url.length <= MAX_ANEXO) return url;
    }
    throw new Error("grande");
  }
  const anexoHtml = () => (anexo ? `<img class="sup-previa" src="${esc(anexo)}" alt="Imagem anexada"><button type="button" class="btn-sec" id="supTirar">Remover imagem</button>`
    : `<button type="button" class="btn-sec" id="supAnexar">Anexar imagem (opcional)</button>`);
  const campoAnexo = () => `<input type="file" id="supArq" accept="image/*" hidden><div id="supAnexo" class="sup-anexo">${anexoHtml()}</div>`;
  function ligarAnexo() {
    const pintar = () => { $("#supAnexo").innerHTML = anexoHtml(); ligarBotoes(); };
    const ligarBotoes = () => {
      const a = $("#supAnexar"), t = $("#supTirar");
      if (a) a.onclick = () => $("#supArq").click();
      if (t) t.onclick = () => { anexo = ""; pintar(); $("#supAnexar").focus(); };
    };
    ligarBotoes();
    $("#supArq").onchange = async (ev) => {
      const f = ev.target.files[0];
      ev.target.value = "";
      if (!f) return;
      const tela = telaN; // a leitura é assíncrona: se a pessoa já foi para outra tela, a imagem não entra
      preparando = true; $("#supAnexo").innerHTML = `<p class="muted sup-preparando" role="status">Preparando imagem…</p>`;
      let url = "", erro = null;
      try { url = await reduzir(f); } catch (e) { erro = e; }
      if (tela !== telaN) return; // render() já zerou anexo e preparando
      preparando = false;
      if (erro) toast(erro.message === "grande" ? "Imagem grande demais. Tente um print menor." : "Não consegui abrir esta imagem.");
      else anexo = url;
      if (!$("#supAnexo")) return;
      pintar(); (anexo ? $("#supTirar") : $("#supAnexar")).focus();
    };
  }
  const campoTexto = (rot) => `<div class="field"><label for="supTexto">${rot}</label>
      <textarea id="supTexto" rows="5" maxlength="${MAX}" aria-describedby="supConta"></textarea>
      <p class="muted sup-conta" id="supConta">0/${MAX}</p></div>`;
  function ligarTexto() {
    const t = $("#supTexto");
    t.oninput = () => { $("#supConta").textContent = `${t.value.length}/${MAX}`; };
  }

  // ---------- abrir chamado ----------
  async function formNovo() {
    let lista_ = pedidos;
    if (!lista_) {
      shell(TIT, `<p class="muted" style="margin-top:16px">Carregando…</p>`, "perfil");
      try { pedidos = lista_ = (await api("suporte")).pedidos; } catch (e) { lista_ = []; } // sem a lista: seletor vazio agora, tenta de novo na próxima vez
      if (!aqui("novo")) return;
    }
    const pre = novo || {}; novo = null; // "Abrir novo chamado sobre isso" chega com assunto e pedido
    shell(TIT, `${voltar("#/suporte", "Chamados")}
      <form class="card sup-form" id="supForm" novalidate>
        <h2 id="supTit" tabindex="-1">Abrir chamado</h2>
        <fieldset><legend>Assunto</legend>
          ${Object.entries(ASSUNTOS).map(([k, a]) => `<label class="sup-assunto"><input type="radio" name="assunto" value="${k}" ${pre.assunto === k ? "checked" : ""}>
            <span><b>${esc(a.nome)}</b><span class="muted">${esc(a.ajuda)}</span></span></label>`).join("")}
        </fieldset>
        <div id="supExtra" aria-live="polite"></div>
        ${campoTexto("Mensagem")}
        ${campoAnexo()}
        <p class="err" role="alert" id="supErr"></p>
        <button class="btn" type="submit">Enviar</button>
      </form>`, "perfil");
    const extra = () => {
      const m = app.querySelector("[name=assunto]:checked"), v = m && m.value, el = $("#supExtra");
      const atual = $("#supPedido") ? $("#supPedido").value : pre.pedido_id || "";
      el.innerHTML = v === "pagamento" ? `<div class="field"><label for="supPedido">Pedido (opcional)</label><select id="supPedido">
          <option value="">Nenhum pedido específico</option>
          ${lista_.map((p) => `<option value="${esc(p.id)}" ${p.id === atual ? "selected" : ""}>${esc(p.codigo || p.id.slice(0, 8))} · ${esc(TIPOS[p.tipo] || p.tipo)} · ${reais(p.valor)} · ${esc(ST_PEDIDO[p.status] || p.status)}</option>`).join("")}
        </select></div>`
        : v === "treino" ? `<p class="sup-saude" role="note">${esc(SAUDE)}</p>` : "";
    };
    app.querySelectorAll("[name=assunto]").forEach((r) => r.onchange = extra);
    extra(); ligarTexto(); ligarAnexo();
    $("#supTit").focus();
    $("#supForm").onsubmit = async (ev) => {
      ev.preventDefault();
      if (enviando) return;
      const m = app.querySelector("[name=assunto]:checked"), texto = $("#supTexto").value.trim(), err = $("#supErr");
      if (preparando) return erro(err, "Espere a imagem ficar pronta.");
      if (!m) return erro(err, "Escolha o assunto.", app.querySelector("[name=assunto]"));
      if (!texto) return erro(err, "Escreva a mensagem.", $("#supTexto"));
      const pedido_id = m.value === "pagamento" && $("#supPedido").value ? $("#supPedido").value : undefined;
      enviando = true; $("#supForm .btn").disabled = true; erro(err, "");
      try {
        const r = await api("chamado_abrir", { assunto: m.value, texto, pedido_id, anexo: anexo || undefined });
        anexo = ""; toast("Chamado aberto. Vamos responder por aqui.");
        location.hash = "#/suporte/" + encodeURIComponent(r.id);
      } catch (e) { enviando = false; if ($("#supForm")) { $("#supForm .btn").disabled = false; erro(err, sem(e)); } }
    };
  }

  // ---------- conversa ----------
  async function conversa(id, focoFim) {
    pararConversa();
    const g = ++geracao;
    shell(TIT, `<p class="muted" style="margin-top:16px">Carregando…</p>`, "perfil");
    let r;
    try { r = await api("chamado", { id }); }
    catch (e) { return aqui(id) && erroTela(voltar("#/suporte", "Chamados"), sem(e), () => conversa(id)); }
    if (!aqui(id) || g !== geracao) return;
    window.FitWay.avisoSuporte(r.naoLido); // abrir marcou como lido
    const c = r.chamado, fechado = c.status === "fechado";
    const msgs = r.mensagens.map(msgHtml).join("");
    shell(TIT, `${voltar("#/suporte", "Chamados")}
      <section class="card"><h2 id="supTit" tabindex="-1">${esc(ASSUNTOS[c.assunto].nome)}</h2>
        <p class="muted" id="supStatus">${esc(STATUS[c.status])}</p>
        <ol class="sup-conversa" aria-label="Mensagens" aria-live="polite" aria-relevant="additions">${msgs}</ol>
        ${fechado ? `<p class="ia-status">Este chamado foi encerrado.</p><button type="button" class="btn" id="supDeNovo">Abrir novo chamado sobre isso</button>`
          : `<form id="supResp" novalidate>${campoTexto("Responder")}${campoAnexo()}<p class="err" role="alert" id="supErr"></p>
            <button class="btn" type="submit">Enviar</button></form>
            <div class="tools"><button type="button" id="supEncerrar">Encerrar chamado</button></div>`}
      </section>`, "perfil");
    const ult = app.querySelector(".sup-msg:last-child");
    if (focoFim && ult) { ult.tabIndex = -1; ult.focus(); } else $("#supTit").focus();
    // Atualização automática: a cada 8 s, só as mensagens novas (depois_de) e o status; não mexe no que está sendo digitado.
    let ultimo = r.mensagens.length ? Number(r.mensagens[r.mensagens.length - 1].id) : 0, status = c.status;
    pararConversa = window.FitWay.repetir(async () => {
      const n = await api("chamado", { id, depois_de: ultimo });
      if (!aqui(id) || g !== geracao) return;
      window.FitWay.avisoSuporte(n.naoLido); // chegou com a conversa aberta: já está lida
      if (n.chamado.status !== status) {
        if (n.chamado.status === "fechado" || status === "fechado") return conversa(id); // o formulário muda inteiro
        status = n.chamado.status; $("#supStatus").textContent = STATUS[status];
      }
      const novas = n.mensagens.filter((m) => Number(m.id) > ultimo);
      if (!novas.length) return;
      // Só rola se a pessoa já estava no fim; lendo mais acima, a rolagem fica onde está.
      const noFim = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80;
      const ol = $(".sup-conversa");
      ol.insertAdjacentHTML("beforeend", novas.map(msgHtml).join(""));
      ultimo = Number(novas[novas.length - 1].id);
      if (noFim && ol.lastElementChild.scrollIntoView) ol.lastElementChild.scrollIntoView({ block: "end" });
    }, { base: 8000, ativo: () => aqui(id) && g === geracao });
    $(".sup-conversa").onclick = async (ev) => {
      const b = ev.target.closest("[data-ver]");
      if (!b) return;
      b.disabled = true;
      try {
        const { anexo: src } = await api("chamado_anexo", { id, msg: Number(b.dataset.ver) });
        if (!src.startsWith("data:image/jpeg;base64,")) throw new Error();
        const box = b.parentNode;
        box.innerHTML = `<img class="sup-previa" src="${esc(src)}" alt="Imagem anexada à mensagem" tabindex="-1">`;
        box.firstChild.focus();
      } catch (e) { b.disabled = false; toast(e.status ? e.message : "Não consegui abrir a imagem."); }
    };
    if (fechado) {
      $("#supDeNovo").onclick = () => { novo = { assunto: c.assunto, pedido_id: c.pedido_id || "" }; location.hash = "#/suporte/novo"; };
      return;
    }
    ligarTexto(); ligarAnexo();
    $("#supEncerrar").onclick = async (ev) => {
      if (!confirm("Encerrar este chamado? Se precisar de novo, você pode abrir outro.")) return;
      ev.currentTarget.disabled = true;
      try { await api("chamado_encerrar", { id }); toast("Chamado encerrado."); } catch (e) { toast(sem(e)); }
      if (aqui(id)) conversa(id);
    };
    $("#supResp").onsubmit = async (ev) => {
      ev.preventDefault();
      if (enviando) return;
      const texto = $("#supTexto").value.trim(), err = $("#supErr");
      if (preparando) return erro(err, "Espere a imagem ficar pronta.");
      if (!texto) return erro(err, "Escreva a mensagem.", $("#supTexto"));
      enviando = true; $("#supResp .btn").disabled = true; erro(err, "");
      try { await api("chamado_responder", { id, texto, anexo: anexo || undefined }); anexo = ""; enviando = false; toast("Mensagem enviada."); if (aqui(id)) conversa(id, true); }
      catch (e) { enviando = false; if ($("#supResp")) { $("#supResp .btn").disabled = false; erro(err, sem(e)); } }
    };
  }

  window.FitWaySuporte = { render };
})();
