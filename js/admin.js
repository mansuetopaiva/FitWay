/* FitWay — painel de administração.
   Só é baixado por quem o servidor marcou como admin, mas o arquivo é público: nada de segredo aqui.
   Toda proteção está no servidor (api/_admin.js confere ADMIN_EMAILS a cada chamada). */
(function () {
  "use strict";
  const { api, esc, toast, icon, shell, $, app } = window.FitWay;
  const TZ = "America/Sao_Paulo";

  // ---------- estado (sobrevive à troca entre lista e detalhe) ----------
  let resumo = null;
  const lista = { busca: "", pagina: 0, itens: [], temMais: false, estado: "carregando", erro: "" };
  let det = null, detEmail = "", detEstado = "", detErro = "";
  let edit = null, aba = 0, sujo = false;
  let buscaTimer = null, versaoLista = 0, versaoDet = 0;

  // ---------- formatação ----------
  const dataBR = (d) => d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  const diaBR = (iso) => (iso ? iso.split("-").reverse().join("/") : "—"); // "2026-11-15" -> "15/11/2026"
  const cadastro = (c) => (c ? dataBR(new Date(c)) : resumo && resumo.cadastroAntes ? "Antes de " + resumo.cadastroAntes : "Antes do painel");
  // acesso_ate é o instante em que o acesso acaba; o último dia liberado é o do instante anterior.
  const acessoAtivo = (a) => a && new Date(a) > new Date();
  const acessoTxt = (a) => (acessoAtivo(a) ? "Liberado até " + dataBR(new Date(new Date(a) - 1)).slice(0, 5) : "Sem acesso liberado");
  const reais = (c) => "R$ " + (c / 100).toFixed(2).replace(".", ",");
  const quando = (d) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }) : "—");
  const estado = (msg, tentar) => tentar
    ? `<div class="adm-estado" role="alert"><p>${esc(msg)}</p><button class="btn-sec" data-tentar="${tentar}">Tentar de novo</button></div>`
    : `<p class="adm-estado muted" role="status">${esc(msg)}</p>`;

  // ---------- estrutura ----------
  // Rotas: #/admin (usuários), #/admin/<email>, #/admin/pedidos e #/admin/pedido.<id> (email sempre tem @, então não colide).
  function render(arg) {
    let a = "";
    try { a = arg ? decodeURIComponent(arg) : ""; } catch (e) { a = ""; }
    if (a === "pedidos" || a.startsWith("pedido.")) {
      if (sujo && !confirm("O treino tem alterações não salvas. Sair e descartar?")) {
        history.replaceState(null, "", "#/admin/" + encodeURIComponent(detEmail));
        return renderUsuarios(encodeURIComponent(detEmail));
      }
      sujo = false; det = null; edit = null; detEmail = "";
      return renderPedidos(a === "pedidos" ? "" : a.slice(7));
    }
    pedId = "";
    renderUsuarios(arg);
  }
  const secoes = (qual) => `<nav class="adm-secoes" aria-label="Seções do painel">
    <a href="#/admin" ${qual === "usuarios" ? 'aria-current="page" class="on"' : ""}>Usuários</a>
    <a href="#/admin/pedidos" ${qual === "pedidos" ? 'aria-current="page" class="on"' : ""}>Pedidos</a>
  </nav>`;
  function renderUsuarios(arg) {
    const antes = detEmail; // usuário aberto até agora (para devolver o foco à linha dele)
    let alvo = "";
    try { alvo = arg ? decodeURIComponent(arg) : ""; } catch (e) { alvo = ""; }
    if (sujo && alvo !== detEmail && !confirm("O treino tem alterações não salvas. Sair e descartar?")) {
      history.replaceState(null, "", "#/admin/" + encodeURIComponent(detEmail));
      alvo = detEmail;
    } else if (alvo !== detEmail) { sujo = false; }
    if (!alvo) detEmail = ""; // antes de pintar a lista, para a linha antiga não ficar destacada
    shell("Admin", `
      <div class="adm ${alvo ? "com-detalhe" : ""}">
        ${secoes("usuarios")}
        <section class="adm-resumo" id="admResumo" aria-label="Resumo"></section>
        <section class="adm-lista" aria-labelledby="admListaTit">
          <h2 id="admListaTit" class="adm-tit" tabindex="-1">Usuários</h2>
          <form id="admBusca" role="search" novalidate>
            <label class="sr" for="admQ">Buscar por nome ou email</label>
            <input id="admQ" type="search" placeholder="Buscar por nome ou email" maxlength="80" autocomplete="off" value="${esc(lista.busca)}">
          </form>
          <div id="admLista"></div>
        </section>
        <section class="adm-det" id="admDetalhe" aria-live="polite"></section>
      </div>`, "admin");
    pintarResumo();
    pintarLista();
    $("#admQ").oninput = (e) => { clearTimeout(buscaTimer); buscaTimer = setTimeout(() => buscar(e.target.value), 350); };
    $("#admBusca").onsubmit = (e) => { e.preventDefault(); clearTimeout(buscaTimer); buscar($("#admQ").value); };
    app.querySelector(".adm").addEventListener("click", clique);
    app.querySelector(".adm").addEventListener("input", digitou);
    app.querySelector(".adm").addEventListener("change", digitou);
    if (!resumo) carregarResumo();
    if (lista.estado === "carregando" && !lista.itens.length) carregarLista(false);
    if (alvo) { if (alvo !== detEmail || !det) carregarDetalhe(alvo); else pintarDetalhe(); return; }
    det = null; edit = null;
    pintarDetalhe();
    // voltou do detalhe: foco na linha do usuário que estava aberto
    const linhaAntes = antes && app.querySelector(`a[href="#/admin/${CSS.escape(encodeURIComponent(antes))}"]`);
    if (linhaAntes) linhaAntes.focus(); else if (antes) $("#admListaTit").focus();
  }

  // ---------- resumo ----------
  async function carregarResumo() {
    try { resumo = await api("admin", { op: "resumo" }); } catch (e) { resumo = { erro: e.message }; }
    pintarResumo();
    const sec = app.querySelector(".adm-secoes");
    if (sec) sec.outerHTML = secoes(pedId !== "" || location.hash.includes("/pedido") ? "pedidos" : "usuarios");
  }
  function pintarResumo() {
    const el = $("#admResumo");
    if (!el) return;
    if (!resumo) { el.innerHTML = estado("Carregando resumo…"); return; }
    if (resumo.erro) { el.innerHTML = estado(resumo.erro, "resumo"); return; }
    const c = (n, t) => `<div class="stat"><b>${n}</b><span>${t}</span></div>`;
    const falta = resumo.termoFaltando || [];
    const aviso = falta.length
      ? `<p class="adm-erro" role="note"><b>Treino com IA bloqueado${resumo.iaLigada ? "" : " (e desligado)"}:</b> o termo precisa das variáveis ${esc(falta.join(", "))} na Vercel.</p>`
      : resumo.iaLigada ? "" : `<p class="muted adm-aviso-ia">Treino com IA desligado para os usuários (TREINO_IA_ATIVO). Você, como admin, pode pedir para testar.</p>`;
    const sp = resumo.cartaoSemPedido || [];
    const sobra = sp.length ? `<div class="adm-erro" role="note"><b>Pagamentos para devolver pelo InfinitePay (últimos 30 dias):</b>
      <ul>${sp.map((x) => `<li>${esc(quando(x.criado))} · ${esc(x.email || "")} · pedido ${esc(x.codigo || "—")}${x.valor ? " · " + reais(x.valor) : ""}${x.motivo === "valor_menor" ? " · valor menor que o do pedido" : x.motivo === "pedido_fechado" ? " · pedido já fechado" : ""} · transação ${esc(x.transaction_nsu || "—")}</li>`).join("")}</ul></div>` : "";
    el.innerHTML = sobra + aviso + `<div class="adm-cards">
      ${c(resumo.usuarios, "usuários")}${c(resumo.novos7d, "novos em 7 dias")}${c(resumo.comTreino, "com treino")}
      ${c(resumo.comAcesso, "com acesso liberado")}${c(resumo.checkinsHoje, "check-ins hoje")}${c(resumo.checkinsSemana, "check-ins na semana")}
      ${c(resumo.aguardando, "pedidos aguardando pagamento")}${c(reais(resumo.receitaMes), "receita do mês")}${c(resumo.vencendo7d, "acessos vencem em 7 dias")}
    </div>`;
  }

  // ---------- lista ----------
  function buscar(q) {
    q = q.trim();
    if (q === lista.busca && lista.estado !== "erro") return;
    lista.busca = q;
    carregarLista(false);
  }
  async function carregarLista(mais) {
    const v = ++versaoLista; // descarta respostas de buscas antigas que chegarem depois
    lista.pagina = mais ? lista.pagina + 1 : 0;
    lista.estado = "carregando";
    if (!mais) lista.itens = [];
    pintarLista();
    try {
      const r = await api("admin", { op: "usuarios", busca: lista.busca, pagina: lista.pagina });
      if (v !== versaoLista) return;
      lista.itens = mais ? lista.itens.concat(r.itens) : r.itens;
      lista.temMais = r.temMais;
      lista.estado = "ok";
    } catch (e) {
      if (v !== versaoLista) return;
      lista.estado = "erro"; lista.erro = e.message;
      if (mais) lista.pagina--;
    }
    pintarLista();
  }
  function pintarLista() {
    const el = $("#admLista");
    if (!el) return;
    const itens = lista.itens.map((x) => `
      <li><a class="adm-item ${x.email === detEmail ? "on" : ""}" href="#/admin/${encodeURIComponent(x.email)}" ${x.email === detEmail ? 'aria-current="true"' : ""}>
        <span class="t"><b>${esc(x.nome)}</b><span class="muted">${esc(x.email)}</span></span>
        <span class="adm-selos">
          <span class="muted">${x.checkins} check-ins</span>
          ${x.temTreino ? `<span class="selo">Treino</span>` : ""}
          ${acessoAtivo(x.acessoAte) ? `<span class="selo ok">${esc(acessoTxt(x.acessoAte).replace("Liberado até", "Acesso até"))}</span>` : ""}
        </span>
      </a></li>`).join("");
    let rodape = "";
    if (lista.estado === "carregando") rodape = estado(lista.itens.length ? "Carregando mais…" : "Carregando usuários…");
    else if (lista.estado === "erro") rodape = estado(lista.erro, "lista");
    else if (!lista.itens.length) rodape = estado(lista.busca ? "Nenhum usuário encontrado para esta busca." : "Nenhum usuário cadastrado.");
    else if (lista.temMais) rodape = `<button class="btn-sec adm-mais" data-mais>Carregar mais</button>`;
    el.innerHTML = (itens ? `<ul class="adm-itens">${itens}</ul>` : "") + rodape;
  }

  // ---------- detalhe ----------
  async function carregarDetalhe(email, manterAba) {
    const v = ++versaoDet;
    detEmail = email;
    if (!manterAba) { det = null; detEstado = "carregando"; pintarDetalhe(); }
    try {
      const r = await api("admin", { op: "usuario", email });
      if (v !== versaoDet) return;
      det = r; detEstado = "ok";
      edit = r.plano ? JSON.parse(JSON.stringify(r.plano)) : null;
      if (!manterAba) aba = 0;
      aba = edit ? Math.min(aba, edit.treinos.length - 1) : 0;
      sujo = false;
    } catch (e) {
      if (v !== versaoDet) return;
      detEstado = "erro"; detErro = e.message;
    }
    pintarDetalhe(!manterAba);
    pintarLista(); // destaca a linha aberta
  }
  function pintarDetalhe(focar) {
    const el = $("#admDetalhe");
    if (!el) return;
    const voltar = `<a class="adm-voltar" href="#/admin">${icon("back")}Voltar para a lista</a>`;
    if (!detEmail) { el.innerHTML = estado("Escolha um usuário na lista."); return; }
    if (detEstado === "carregando") { el.innerHTML = voltar + estado("Carregando usuário…"); return; }
    if (detEstado === "erro") { el.innerHTML = voltar + estado(detErro, "detalhe"); return; }
    const d = det;
    el.innerHTML = `${voltar}
      <div class="card">
        <h2 id="admDetTit" tabindex="-1">${esc(d.nome)}</h2>
        <p class="muted">${esc(d.email)}</p>
        <div class="row"><span>Cadastro</span><span>${esc(cadastro(d.criado))}</span></div>
        <div class="row"><span>Check-ins</span><span>${d.checkins}${d.ultimoCheckin ? ` · último em ${esc(diaBR(d.ultimoCheckin))}` : ""}</span></div>
        <div class="row"><span>Sessões feitas</span><span>${d.sessoes}</span></div>
        <div class="row"><span>Grupo do ranking</span><span>${d.grupo ? esc(d.grupo) : "Nenhum"}</span></div>
      </div>
      <div class="card" aria-labelledby="admAcTit">
        <h2 id="admAcTit" class="adm-tit">Acesso</h2>
        <p class="adm-acesso ${acessoAtivo(d.acessoAte) ? "ok" : ""}">${esc(acessoTxt(d.acessoAte))}</p>
        <div class="adm-botoes">
          <button class="btn-sec" data-dias="7">+7 dias</button>
          <button class="btn-sec" data-dias="30">+30 dias</button>
        </div>
        <form class="adm-data" id="admData" novalidate>
          <label for="admAte">Escolher data (vale até o fim do dia)</label>
          <div><input id="admAte" type="date" required><button class="btn-sec" type="submit">Liberar até esta data</button></div>
        </form>
        <button class="btn-perigo" data-cortar ${acessoAtivo(d.acessoAte) ? "" : "disabled"}>Cortar acesso</button>
      </div>
      <div class="card" aria-labelledby="admTrTit">
        <h2 id="admTrTit" class="adm-tit">Treino${d.plano && d.plano.origem === "ia" ? ' <span class="selo ok">Feito pela IA</span>' : ""}${sujo ? ' <span class="selo aviso">Não salvo</span>' : ""}</h2>
        ${d.plano && d.plano.origem === "ia" ? `<p class="muted" style="margin-bottom:10px">Editar mantém o treino como pago (some se o acesso vencer) e não zera a contagem das 8 semanas.</p>` : ""}
        ${editor()}
        <input type="file" id="admPdf" accept="application/pdf,.pdf" hidden>
      </div>
      <div class="card" aria-labelledby="admHiTit">
        <h2 id="admHiTit" class="adm-tit">Histórico</h2>
        ${d.historico.length ? `<ul class="adm-hist">${d.historico.map((h) => `<li><b>${esc(acaoTxt(h))}</b>
          <span class="muted">${esc(new Date(h.criado).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }))} · ${esc(h.admin_email)}</span></li>`).join("")}</ul>`
          : estado("Nenhuma ação do admin com este usuário ainda.")}
      </div>
      <datalist id="admNomes">${d.nomes.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
    if (focar) { const t = $("#admDetTit"); if (t) t.focus(); }
  }
  function acaoTxt(h) {
    const x = h.detalhes || {};
    if (h.acao === "acesso") return x.dias ? `Acesso +${x.dias} dias` : x.ate ? `Acesso até ${diaBR(x.ate)}` : "Acesso cortado";
    const n = x.treinos ? ` (${x.treinos} treinos, ${x.exercicios} exercícios)` : "";
    const ped = x.pedido ? " · pedido " + x.pedido.slice(0, 6) : "";
    return ({ plano_salvar: "Treino editado", plano_pdf: "Treino enviado por PDF", plano_remover: "Treino removido", pedido_ver: "Pedido visto (saúde ou fotos)",
      cartao_sem_pedido: `Pagamento para devolver${x.paid_amount ? ` (${reais(x.paid_amount)})` : ""}`,
      pedido_pago: `Pagamento confirmado${x.metodo === "cartao" ? " (cartão)" : x.metodo === "pix" ? " (Pix)" : ""}${x.dias ? ` (+${x.dias} dias)` : ""}`,
      pix_nao_encontrado: "Pix não encontrado (pedido voltou para aguardando pagamento)", pedido_gerar_de_novo: "Treino do pedido gerado de novo", pedido_cancelar: "Pedido cancelado" }[h.acao] || h.acao) + n + ped;
  }

  // ---------- editor de treino ----------
  const CAMPOS = [ // índice no exercício, rótulo, tipo
    [0, "Nome", "text"], [2, "Séries", "number"], [3, "Repetições", "text"], [4, "Carga (kg)", "number"], [5, "Descanso (s)", "number"], [6, "Observação", "text"],
  ];
  const exNovo = () => ["", "", 3, "10", 0, 60, ""];
  function editor() {
    const botoesFim = `<div class="adm-botoes">
      <button class="btn-sec" data-pdf>Enviar PDF por este usuário</button>
      ${det.plano ? `<button class="btn-perigo" data-remover-plano>Remover treino</button>` : ""}
    </div>`;
    if (!edit) return `<p class="muted">Este usuário não tem treino.</p>
      <button class="btn" data-criar style="margin-top:12px">Criar treino</button>${botoesFim}`;
    const t = edit.treinos[aba];
    const abas = edit.treinos.map((x, i) => `<button role="tab" id="admAba${i}" aria-selected="${i === aba}" aria-controls="admPainel" class="${i === aba ? "on" : ""}" data-aba="${i}">${esc(x.id)}</button>`).join("");
    const exs = t.exercicios.map((e, i) => `
      <fieldset class="adm-ex">
        <legend>Exercício ${i + 1}</legend>
        <div class="adm-campos">
          ${CAMPOS.map(([c, rot, tipo]) => `<label class="${c === 0 ? "largo" : c === 6 ? "largo" : ""}">${rot}
            <input type="${tipo}" data-e="${i}" data-c="${c}" value="${esc(e[c])}"
              ${c === 0 ? 'list="admNomes" maxlength="70" required' : ""} ${c === 3 ? 'maxlength="12"' : ""} ${c === 6 ? 'maxlength="160"' : ""}
              ${c === 2 ? 'min="1" max="20" step="1" inputmode="numeric"' : ""} ${c === 4 ? 'min="0" max="500" step="0.5" inputmode="decimal"' : ""}
              ${c === 5 ? 'min="0" max="600" step="5" inputmode="numeric"' : ""}></label>`).join("")}
        </div>
        <div class="adm-ex-acoes">
          <button class="icon-btn" data-subir="${i}" aria-label="Subir exercício ${i + 1}" ${i ? "" : "disabled"}>${icon("chev", "cima")}</button>
          <button class="icon-btn" data-descer="${i}" aria-label="Descer exercício ${i + 1}" ${i < t.exercicios.length - 1 ? "" : "disabled"}>${icon("chev")}</button>
          <button class="icon-btn perigo" data-tirar="${i}" aria-label="Remover exercício ${i + 1}" ${t.exercicios.length > 1 ? "" : "disabled"}>✕</button>
        </div>
      </fieldset>`).join("");
    return `
      <label class="adm-campo">Nome do plano<input data-plano-nome value="${esc(edit.nome)}" maxlength="80"></label>
      <div class="adm-abas">
        <div role="tablist" aria-label="Treinos do plano">${abas}</div>
        ${edit.treinos.length < 12 ? `<button class="btn-sec" data-add-treino>+ Treino</button>` : ""}
      </div>
      <div id="admPainel" role="tabpanel" aria-labelledby="admAba${aba}">
        <label class="adm-campo">Nome do treino ${esc(t.id)}<input data-treino-nome value="${esc(t.nome)}" maxlength="80"></label>
        ${exs}
        <div class="adm-botoes">
          ${t.exercicios.length < 30 ? `<button class="btn-sec" data-add-ex>+ Exercício</button>` : ""}
          ${edit.treinos.length > 1 ? `<button class="btn-perigo" data-tirar-treino>Excluir o treino ${esc(t.id)}</button>` : ""}
        </div>
      </div>
      <button class="btn" data-salvar style="margin-top:16px">Salvar treino</button>
      ${botoesFim}`;
  }
  function digitou(ev) {
    const el = ev.target;
    if (!edit || !(el instanceof HTMLInputElement) || el.type === "file" || el.type === "search" || el.id === "admAte") return;
    const t = edit.treinos[aba];
    if (el.hasAttribute("data-plano-nome")) edit.nome = el.value;
    else if (el.hasAttribute("data-treino-nome")) t.nome = el.value;
    else if (el.dataset.e !== undefined) {
      const c = +el.dataset.c;
      // vazio vira NaN de propósito: o servidor recusa e diz qual campo está errado
      t.exercicios[+el.dataset.e][c] = el.type === "number" ? (el.value === "" ? NaN : Number(el.value)) : el.value;
    } else return;
    if (!sujo) { sujo = true; const tit = $("#admTrTit"); if (tit) tit.insertAdjacentHTML("beforeend", ' <span class="selo aviso">Não salvo</span>'); }
  }
  // Redesenha o detalhe mantendo o foco num elemento equivalente (o editor é recriado a cada mudança de estrutura).
  function redesenhar(seletor) {
    pintarDetalhe();
    const f = seletor && $(seletor);
    if (f) f.focus();
  }
  const proximoId = () => {
    const usados = new Set(edit.treinos.map((t) => t.id));
    for (const l of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!usados.has(l)) return l;
    let n = 1; while (usados.has("T" + n)) n++; return "T" + n;
  };

  // ---------- ações ----------
  async function escrever(corpo, okMsg, botao) {
    // o detalhe é redesenhado depois; o foco volta para o botão equivalente
    const attr = botao && [...botao.attributes].find((a) => a.name.startsWith("data-"));
    const foco = attr ? `[${attr.name}${attr.value ? `="${attr.value}"` : ""}]` : "#admTrTit";
    if (botao) botao.disabled = true;
    const email = detEmail;
    try {
      const r = await api("admin", { email, ...corpo });
      toast(okMsg);
      if (email !== detEmail) return r; // o admin já abriu outro usuário: não recarrega nem descarta o que está aberto
      sujo = false;
      await carregarDetalhe(detEmail, true);
      const f = $(foco); if (f && !f.disabled) f.focus(); else { const t = $("#admDetTit"); if (t) t.focus(); }
      carregarResumo();
      // atualiza só a linha deste usuário: a lista não volta para a primeira página
      const item = lista.itens.find((x) => x.email === detEmail);
      if (item && det) { item.acessoAte = det.acessoAte; item.temTreino = det.temTreino; pintarLista(); }
      return r;
    } catch (e) {
      toast(e.message);
      if (botao && botao.isConnected) botao.disabled = false;
    }
  }
  function clique(ev) {
    const b = ev.target.closest("button, a");
    if (!b || !app.contains(b)) return;
    const ds = b.dataset;
    if (ds.tentar) {
      if (ds.tentar === "resumo") { resumo = null; pintarResumo(); carregarResumo(); }
      else if (ds.tentar === "lista") carregarLista(lista.pagina > 0 && lista.itens.length > 0);
      else carregarDetalhe(detEmail);
      return;
    }
    if (ds.mais !== undefined) return carregarLista(true);
    if (ds.dias) return escrever({ op: "acesso", dias: +ds.dias }, `Acesso liberado por mais ${ds.dias} dias.`, b);
    if (ds.cortar !== undefined) {
      if (confirm(`Cortar o acesso de ${det.nome} agora?`)) escrever({ op: "acesso", cortar: true }, "Acesso cortado.", b);
      return;
    }
    if (ds.pdf !== undefined) {
      const ia = det.plano && det.plano.origem === "ia" ? " Este é um treino de IA pago: ele será apagado e a mensalidade deixa de valer para ele." : "";
      if (!det.plano || confirm(`O PDF vai substituir o treino atual de ${det.nome}.${ia} Continuar?`)) $("#admPdf").click();
      return;
    }
    if (ds.removerPlano !== undefined) {
      const ia = det.plano && det.plano.origem === "ia" ? " Este é um treino de IA pago e será apagado." : "";
      if (confirm(`Remover o treino de ${det.nome}?${ia} A aba Treinos some para ele até receber outro.`)) escrever({ op: "plano_remover" }, "Treino removido.", b);
      return;
    }
    if (ds.criar !== undefined) {
      edit = { nome: "Treino", treinos: [{ id: "A", nome: "Treino A", exercicios: [exNovo()] }] };
      aba = 0; sujo = true;
      return redesenhar('[data-e="0"][data-c="0"]');
    }
    if (!edit) return;
    const t = edit.treinos[aba];
    if (ds.aba !== undefined) { aba = +ds.aba; return redesenhar(`#admAba${aba}`); }
    if (ds.salvar !== undefined) {
      return escrever({ op: "plano_salvar", plano: edit }, "Treino salvo.", b);
    }
    if (!["addTreino", "tirarTreino", "addEx", "subir", "descer", "tirar"].some((k) => k in ds)) return;
    if (ds.tirarTreino !== undefined && !confirm(`Excluir o treino ${t.id} (${t.nome}) deste plano? Só vale depois de salvar.`)) return;
    sujo = true;
    if (ds.addTreino !== undefined) {
      const id = proximoId();
      edit.treinos.push({ id, nome: "Treino " + id, exercicios: [exNovo()] });
      aba = edit.treinos.length - 1;
      return redesenhar("[data-treino-nome]");
    }
    if (ds.tirarTreino !== undefined) {
      edit.treinos.splice(aba, 1);
      aba = Math.max(0, aba - 1);
      return redesenhar(`#admAba${aba}`);
    }
    if (ds.addEx !== undefined) {
      t.exercicios.push(exNovo());
      return redesenhar(`[data-e="${t.exercicios.length - 1}"][data-c="0"]`);
    }
    const mover = (i, j) => { const x = t.exercicios; [x[i], x[j]] = [x[j], x[i]]; };
    if (ds.subir !== undefined) { const i = +ds.subir; mover(i, i - 1); return redesenhar(`[data-subir="${i - 1}"]:not([disabled]), [data-descer="${i - 1}"]`); }
    if (ds.descer !== undefined) { const i = +ds.descer; mover(i, i + 1); return redesenhar(`[data-descer="${i + 1}"]:not([disabled]), [data-subir="${i + 1}"]`); }
    if (ds.tirar !== undefined) {
      const i = +ds.tirar;
      t.exercicios.splice(i, 1);
      return redesenhar(`[data-e="${Math.min(i, t.exercicios.length - 1)}"][data-c="0"]`);
    }
  }
  // formulário de data e arquivo PDF ficam fora do clique
  app.addEventListener("submit", (ev) => {
    if (ev.target.id !== "admData") return;
    ev.preventDefault();
    const v = $("#admAte").value;
    if (!v) return toast("Escolha uma data.");
    escrever({ op: "acesso", ate: v }, `Acesso liberado até ${diaBR(v)}.`, ev.target.querySelector("button"));
  });
  app.addEventListener("change", (ev) => {
    if (ev.target.id !== "admPdf") return;
    const f = ev.target.files[0];
    ev.target.value = "";
    if (!f || !f.size) return;
    if (f.size > 3e6) return toast("O PDF precisa ter no máximo 3 MB.");
    const fr = new FileReader();
    fr.onload = () => escrever({ op: "plano_pdf", pdf: String(fr.result).split(",")[1] || "" }, "Treino do PDF carregado.", null);
    fr.onerror = () => toast("Não consegui ler o arquivo.");
    fr.readAsDataURL(f);
  });
  window.addEventListener("beforeunload", (ev) => { if (sujo) ev.preventDefault(); });

  // ---------- pedidos ----------
  const STATUS = { aguardando_pagamento: ["Aguardando pagamento", "aviso"], aguardando_confirmacao: ["Pix a conferir (antigo)", "aviso"], pago: ["Pago", "ok"], gerando: ["Gerando", "ok"],
    pronto: ["Pronto", "ok"], erro: ["Erro", "erro"], cancelado: ["Cancelado", ""] };
  const TIPOS = { inicial: "Treino inicial", mensalidade: "Mensalidade", novo_treino: "Novo treino" };
  const selo = (st) => `<span class="selo ${STATUS[st][1]}">${STATUS[st][0]}</span>`;
  const pedLista = { status: "aguardando_pagamento", tipo: "", pagina: 0, itens: [], temMais: false, estado: "carregando", erro: "" };
  let ped = null, pedId = "", pedEstado = "", pedErro = "", versaoPed = 0, versaoPedLista = 0, fotoGrande = "", termoVisto = null;
  const METODOS = { pix: "Pix", cartao: "Cartão" }, FORMAS = { pix: "Pix", credit_card: "Cartão de crédito" };

  function renderPedidos(id) {
    const antes = pedId;
    const opts = (obj, atual, todos) => `<option value="">${todos}</option>` + Object.entries(obj).map(([k, v]) =>
      `<option value="${k}" ${k === atual ? "selected" : ""}>${Array.isArray(v) ? v[0] : v}</option>`).join("");
    shell("Admin", `
      <div class="adm ${id ? "com-detalhe" : ""}">
        ${secoes("pedidos")}
        <section class="adm-resumo" id="admResumo" aria-label="Resumo"></section>
        <section class="adm-lista" aria-labelledby="admListaTit">
          <h2 id="admListaTit" class="adm-tit" tabindex="-1">Pedidos</h2>
          <div class="adm-filtros">
            <label>Status<select id="pedStatus">${opts(STATUS, pedLista.status, "Todos")}</select></label>
            <label>Tipo<select id="pedTipo">${opts(TIPOS, pedLista.tipo, "Todos")}</select></label>
          </div>
          <div id="admLista"></div>
        </section>
        <section class="adm-det" id="admDetalhe" aria-live="polite"></section>
      </div>`, "admin");
    pintarResumo();
    pintarPedLista();
    const filtro = () => { pedLista.status = $("#pedStatus").value; pedLista.tipo = $("#pedTipo").value; carregarPedLista(false); };
    $("#pedStatus").onchange = filtro; $("#pedTipo").onchange = filtro;
    app.querySelector(".adm").addEventListener("click", cliquePedido);
    if (!resumo) carregarResumo();
    if (pedLista.estado === "carregando" && !pedLista.itens.length) carregarPedLista(false);
    if (id) { if (id !== pedId || !ped) carregarPedido(id); else pintarPedido(); return; }
    pedId = ""; ped = null;
    pintarPedido();
    const linha = antes && app.querySelector(`a[href="#/admin/pedido.${CSS.escape(antes)}"]`);
    if (linha) linha.focus(); else if (antes) $("#admListaTit").focus();
  }
  async function carregarPedLista(mais) {
    const v = ++versaoPedLista;
    pedLista.pagina = mais ? pedLista.pagina + 1 : 0;
    pedLista.estado = "carregando";
    if (!mais) pedLista.itens = [];
    pintarPedLista();
    try {
      const r = await api("admin", { op: "pedidos", status: pedLista.status, tipo: pedLista.tipo, pagina: pedLista.pagina });
      if (v !== versaoPedLista) return;
      pedLista.itens = mais ? pedLista.itens.concat(r.itens) : r.itens;
      pedLista.temMais = r.temMais; pedLista.estado = "ok";
    } catch (e) {
      if (v !== versaoPedLista) return;
      pedLista.estado = "erro"; pedLista.erro = e.message;
      if (mais) pedLista.pagina--;
    }
    pintarPedLista();
  }
  function pintarPedLista() {
    const el = $("#admLista");
    if (!el) return;
    const itens = pedLista.itens.map((x) => `
      <li><a class="adm-item ${x.id === pedId ? "on" : ""}" href="#/admin/pedido.${x.id}" ${x.id === pedId ? 'aria-current="true"' : ""}>
        <span class="t"><b>${esc(x.nome)}</b><span class="muted">${esc(TIPOS[x.tipo])} · ${reais(x.valor)} · ${esc(quando(x.criado))}</span></span>
        <span class="adm-selos">${selo(x.status)}</span>
      </a></li>`).join("");
    let rodape = "";
    if (pedLista.estado === "carregando") rodape = estado(pedLista.itens.length ? "Carregando mais…" : "Carregando pedidos…");
    else if (pedLista.estado === "erro") rodape = estado(pedLista.erro, "pedLista");
    else if (!pedLista.itens.length) rodape = estado("Nenhum pedido com estes filtros.");
    else if (pedLista.temMais) rodape = `<button class="btn-sec adm-mais" data-ped-mais>Carregar mais</button>`;
    el.innerHTML = (itens ? `<ul class="adm-itens">${itens}</ul>` : "") + rodape;
  }
  // gerar: logo depois de marcar como pago, o servidor já monta o treino nesta chamada (até 1 minuto).
  async function carregarPedido(id, gerar) {
    const v = ++versaoPed;
    pedId = id; fotoGrande = ""; termoVisto = null;
    pedEstado = gerar ? "gerando" : "carregando"; ped = gerar ? ped : null;
    pintarPedido();
    try {
      const r = await api("admin", { op: "pedido", id, gerar: gerar === true });
      if (v !== versaoPed) return;
      ped = r; pedEstado = "ok";
      const item = pedLista.itens.find((x) => x.id === id);
      if (item && item.status !== r.status) { item.status = r.status; }
    } catch (e) {
      if (v !== versaoPed) return;
      pedEstado = "erro"; pedErro = e.message;
    }
    pintarPedido(!gerar);
    pintarPedLista();
  }
  function pintarPedido(focar) {
    const el = $("#admDetalhe");
    if (!el) return;
    const voltar = `<a class="adm-voltar" href="#/admin/pedidos">${icon("back")}Voltar para os pedidos</a>`;
    if (!pedId) { el.innerHTML = estado("Escolha um pedido na lista."); return; }
    if (pedEstado === "carregando") { el.innerHTML = voltar + estado("Carregando pedido…"); return; }
    if (pedEstado === "gerando") { el.innerHTML = voltar + estado("Gerando o treino com a IA… pode levar até 1 minuto."); return; }
    if (pedEstado === "erro") { el.innerHTML = voltar + estado(pedErro, "pedido"); return; }
    const p = ped, r = p.respostas, linha = (k, v) => `<div class="row"><span>${k}</span><span>${esc(v)}</span></div>`;
    const ac = p.aceite;
    const botoes = [

      ["erro", "pronto"].includes(p.status) && p.tipo !== "mensalidade" ? `<button class="btn-sec" data-ped-gerar>Gerar de novo</button>` : "",
      ["aguardando_pagamento", "aguardando_confirmacao", "pago", "erro"].includes(p.status) ? `<button class="btn-perigo" data-ped-cancelar>Cancelar pedido</button>` : "",
    ].join("");
    el.innerHTML = `${voltar}
      <div class="card">
        <h2 id="admDetTit" tabindex="-1">${esc(TIPOS[p.tipo])} · ${reais(p.valor)}</h2>
        <p class="muted"><a href="#/admin/${encodeURIComponent(p.email)}">${esc(p.nome)} · ${esc(p.email)}</a></p>
        <div class="row"><span>Status</span><span>${selo(p.status)}</span></div>
        ${linha("Código", p.codigo || "—")}${linha("Meio", METODOS[p.metodo] || "Não escolhido")}
        ${linha("Pedido em", quando(p.criado))}${p.pagoEm ? linha("Pago em", quando(p.pagoEm)) : ""}${p.geradoEm ? linha("Treino gerado em", quando(p.geradoEm)) : ""}
        ${p.modelo ? linha("Modelo da IA", p.modelo) : ""}${p.tentativas ? linha("Tentativas de geração", p.tentativas) : ""}
        ${linha("Acesso do usuário", acessoTxt(p.acessoAte))}
        ${p.erro ? `<p class="adm-erro" role="note"><b>Último erro:</b> ${esc(p.erro)}</p>` : ""}
        ${ac ? `<div class="row"><span>Termo aceito: versão ${esc(ac.versao)} em ${esc(quando(ac.aceito_em))}</span><button class="btn-sec" data-ped-termo="${esc(ac.versao)}">Ver texto</button></div>
          <p class="muted">IP ${esc(ac.ip || "—")} · ${esc(ac.user_agent || "—")}</p>
          ${ac.hash ? `<p class="muted">Hash do texto aceito: ${esc(ac.hash.slice(0, 16))}…</p>` : ""}
          ${termoVisto ? `<p class="${termoVisto.hash === ac.hash ? "muted" : "adm-erro"}">${termoVisto.hash === ac.hash
            ? "O texto abaixo é exatamente o que a pessoa aceitou (mesmo hash)."
            : "Atenção: o texto atual é diferente do aceito (hash diferente). As variáveis do termo mudaram depois do aceite."}</p>
          <div class="ped-termo" tabindex="0" role="region" aria-label="Texto do termo, versão ${esc(termoVisto.versao)}">${esc(termoVisto.texto)}</div>` : ""}` : ""}
        ${botoes ? `<div class="adm-botoes">${botoes}</div>` : ""}
      </div>
      ${pagamentoHtml(p)}
      ${r ? respostasHtml(p, r) : ""}
      ${p.fotos ? fotosHtml(p.fotos) : r ? `<div class="card"><h2 class="adm-tit">Fotos</h2><p class="muted">Nenhuma foto (não enviadas ou já apagadas 90 dias depois do treino pronto).</p></div>` : ""}
      ${p.plano ? planoHtml(p.plano) : ""}`;
    if (focar) { const t = $("#admDetTit"); if (t) t.focus(); }
  }
  // Pagamento pelo checkout do InfinitePay (Pix ou cartão): confirmado só pelo payment_check.
  function pagamentoHtml(p) {
    const linha = (k, v) => `<div class="row"><span>${k}</span><span>${esc(v)}</span></div>`;
    const pa = p.pixAntigo, comp = pa && typeof pa.comprovante === "string" && pa.comprovante.startsWith("data:image/jpeg;base64,") ? pa.comprovante : "";
    // Pix manual antigo (não existe mais): só leitura, para decidir entre cancelar e devolver.
    const antigo = pa ? `<div class="card"><h2 class="adm-tit">Pix manual (antigo, não conferido)</h2>
      <p class="muted">Este pedido é do Pix pelo link do Nubank, que saiu. Confira no app do banco; não há como confirmar por aqui, só cancelar.</p>
      ${linha("Valor", reais(p.valor))}${linha("Quem pagou", pa.pagador || "—")}${pa.aviso ? linha("Aviso em", quando(pa.aviso)) : ""}${linha("ID da transação informado", pa.e2e || "—")}
      ${comp ? `<img class="adm-foto-grande" src="${esc(comp)}" alt="Comprovante enviado">` : ""}</div>` : "";
    if (!(p.metodo || p.transactionNsu || p.checkoutRef) || !(p.links && (p.links.pix || p.links.cartao)) && !p.transactionNsu) return antigo;
    const ref = p.checkoutRef || {};
    const links = p.links ? ["pix", "cartao"].filter((m) => p.links[m]).map((m) => METODOS[m]).join(" e ") : "";
    // O checkout aceita Pix e cartão em qualquer link: o meio pago pode não ser o escolhido (aceito, só marcado).
    const escolhido = p.meioEscolhido || p.metodo;
    const diferente = p.captureMethod && escolhido && ({ pix: "pix", credit_card: "cartao" }[p.captureMethod] !== escolhido);
    return `<div class="card"><h2 class="adm-tit">Pagamento (InfinitePay)</h2>
      ${diferente ? `<p class="adm-erro" role="note"><b>Pago com meio diferente do escolhido:</b> o link pago era de ${esc(METODOS[escolhido] || escolhido)}, e o pagamento foi com ${esc(FORMAS[p.captureMethod] || p.captureMethod)}.</p>` : ""}
      ${links ? linha("Links criados", links) : ""}
      ${p.transactionNsu ? linha("Transação", p.transactionNsu) : ""}${p.captureMethod ? linha("Pago com", FORMAS[p.captureMethod] || p.captureMethod) : ""}
      ${!p.transactionNsu && ref.transaction_nsu ? linha("Último retorno (não confirmado)", ref.transaction_nsu) : ""}
      ${p.confirmadoPor ? linha("Confirmado por", p.confirmadoPor === "infinitepay" ? "InfinitePay (automático)" : p.confirmadoPor) : ""}
      ${p.status === "aguardando_pagamento" && p.checkoutRef ? `<div class="adm-botoes"><button class="btn-sec" data-ped-verificar>Verificar no InfinitePay</button></div>` : ""}</div>` + antigo;
  }
  function respostasHtml(p, r) {
    const linha = (k, v) => `<div class="row"><span>${k}</span><span>${esc(v === "" || v === undefined ? "—" : v)}</span></div>`;
    const sims = r.parq.some(Boolean);
    return `<div class="card"><h2 class="adm-tit">Respostas</h2>
      <h3 class="adm-sub">Você</h3>${linha("Objetivo", r.objetivo)}${linha("Nível", r.nivel)}${linha("Idade", r.idade + " anos")}${linha("Sexo", r.sexo)}${linha("Altura", r.altura + " cm")}${linha("Peso", String(r.peso).replace(".", ",") + " kg")}
      <h3 class="adm-sub">Rotina</h3>${linha("Dias por semana", r.dias)}${linha("Tempo por treino", r.minutos + " min")}
      <h3 class="adm-sub">Saúde (PAR-Q)${sims ? ' <span class="selo aviso">Tem Sim</span>' : ""}</h3>
      <ol class="adm-parq">${p.parq.map((q, i) => `<li class="${r.parq[i] ? "sim" : ""}"><span>${esc(q)}</span><b>${r.parq[i] ? "Sim" : "Não"}</b></li>`).join("")}</ol>
      ${sims ? linha("Liberação médica", r.liberacao ? "Sim (declarada)" : "Não") : ""}
      ${linha("Lesões ou dores", r.lesoes)}${linha("Cirurgias", r.cirurgias)}${linha("Problemas de saúde", r.doencas)}${linha("Remédios em uso", r.remedios)}${linha("Não pode ou não quer fazer", r.evitar)}
      <h3 class="adm-sub">Observações</h3><p class="adm-obs">${esc(r.observacoes || "—")}</p>
      <h3 class="adm-sub">Consentimentos</h3>${linha("Dados de saúde", r.consentimentos && r.consentimentos.dados ? quando(r.consentimentos.dados) : "—")}${linha("Fotos", r.consentimentos && r.consentimentos.fotos ? quando(r.consentimentos.fotos) : "—")}
    </div>`;
  }
  const ROT_FOTOS = { frente: "Frente", costas: "Costas", direito: "Perfil direito", esquerdo: "Perfil esquerdo" };
  function fotosHtml(fotos) {
    const validas = Object.keys(ROT_FOTOS).filter((k) => typeof fotos[k] === "string" && fotos[k].startsWith("data:image/jpeg;base64,"));
    if (fotoGrande && fotos[fotoGrande]) return `<div class="card"><h2 class="adm-tit">Foto: ${ROT_FOTOS[fotoGrande]}</h2>
      <img class="adm-foto-grande" src="${esc(fotos[fotoGrande])}" alt="Foto: ${ROT_FOTOS[fotoGrande]}">
      <button class="btn-sec" data-ped-fechar-foto="${fotoGrande}" style="margin-top:8px">Fechar foto</button></div>`;
    return `<div class="card"><h2 class="adm-tit">Fotos</h2><div class="adm-fotos">${validas.map((k) => `
      <button data-ped-foto="${k}" aria-label="Ampliar foto: ${ROT_FOTOS[k]}"><img src="${esc(fotos[k])}" alt=""><span>${ROT_FOTOS[k]}</span></button>`).join("")}</div></div>`;
  }
  function planoHtml(pl) {
    const g = pl.guia || {};
    return `<div class="card"><h2 class="adm-tit">Plano gerado: ${esc(pl.nome)}</h2>
      ${g.resumo ? `<p class="adm-obs">${esc(g.resumo)}</p>` : ""}
      ${(g.fases || []).map((f) => `<div class="row"><span>Semanas ${esc(f.semanas)}</span><span>${esc(f.foco)}</span></div>`).join("")}
      ${pl.treinos.map((t) => `<h3 class="adm-sub">${esc(t.id)} – ${esc(t.nome)}</h3>
        <ul class="adm-hist">${t.exercicios.map((e) => `<li><b>${esc(e[0])}</b><span class="muted">${e[2]} × ${esc(e[3])} · descanso ${e[5]} s${e[6] ? " · " + esc(e[6]) : ""}</span></li>`).join("")}</ul>`).join("")}
      ${g.cuidados ? `<h3 class="adm-sub">Cuidados</h3><p class="adm-obs">${esc(g.cuidados)}</p>` : ""}
      ${g.avaliacao_fotos ? `<h3 class="adm-sub">Avaliação das fotos</h3><p class="adm-obs">${esc(g.avaliacao_fotos)}</p>` : ""}
    </div>`;
  }
  async function acaoPedido(op, msg, botao, extra) {
    const id = pedId;
    botao.disabled = true;
    try {
      const r = await api("admin", { op, id, ...extra });
      toast(msg);
      carregarResumo();
      const item = pedLista.itens.find((x) => x.id === id);
      if (item) { item.status = r.status; pintarPedLista(); }
      if (id !== pedId) return;
      await carregarPedido(id, r.status === "pago");
      const t = $("#admDetTit"); if (t) t.focus();
    } catch (e) {
      toast(e.message);
      if (botao.isConnected) botao.disabled = false;
    }
  }
  function cliquePedido(ev) {
    const b = ev.target.closest("button");
    if (!b || !app.contains(b)) return;
    const ds = b.dataset;
    if (ds.tentar === "pedLista") return carregarPedLista(pedLista.pagina > 0 && pedLista.itens.length > 0);
    if (ds.tentar === "pedido") return carregarPedido(pedId);
    if (ds.tentar === "resumo") { resumo = null; pintarResumo(); return carregarResumo(); }
    if (ds.pedMais !== undefined) return carregarPedLista(true);
    if (ds.pedVerificar !== undefined) return acaoPedido("pedido_verificar", "Pagamento confirmado pelo InfinitePay.", b);
    if (ds.pedGerar !== undefined) {
      if (confirm(`Gerar o treino de ${ped.nome} de novo? ${ped.status === "pronto" ? "O treino atual dele será substituído." : ""}`)) acaoPedido("pedido_gerar_de_novo", "Pedido voltou para a fila de geração.", b);
      return;
    }
    if (ds.pedCancelar !== undefined) {
      if (confirm(`Cancelar este pedido de ${ped.nome}? Não há reembolso automático, e os dias de acesso já dados continuam valendo.`)) acaoPedido("pedido_cancelar", "Pedido cancelado.", b);
      return;
    }
    if (ds.pedFoto) { fotoGrande = ds.pedFoto; pintarPedido(); const f = $("[data-ped-fechar-foto]"); if (f) f.focus(); return; }
    if (ds.pedFecharFoto) { fotoGrande = ""; pintarPedido(); const f = $(`[data-ped-foto="${ds.pedFecharFoto}"]`); if (f) f.focus(); return; }
    if (ds.pedTermo) {
      b.disabled = true;
      api("termo", { versao: ds.pedTermo }).then((t) => { termoVisto = t; pintarPedido(); const r = app.querySelector(".adm-det .ped-termo"); if (r) r.focus(); },
        (e) => { toast(e.message); b.disabled = false; });
    }
  }

  window.FitWayAdmin = { render };
})();
