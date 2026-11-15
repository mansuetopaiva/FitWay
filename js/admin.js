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
  const estado = (msg, tentar) => tentar
    ? `<div class="adm-estado" role="alert"><p>${esc(msg)}</p><button class="btn-sec" data-tentar="${tentar}">Tentar de novo</button></div>`
    : `<p class="adm-estado muted" role="status">${esc(msg)}</p>`;

  // ---------- estrutura ----------
  function render(arg) {
    let alvo = "";
    try { alvo = arg ? decodeURIComponent(arg) : ""; } catch (e) { alvo = ""; }
    if (sujo && alvo !== detEmail && !confirm("O treino tem alterações não salvas. Sair e descartar?")) {
      history.replaceState(null, "", "#/admin/" + encodeURIComponent(detEmail));
      alvo = detEmail;
    } else if (alvo !== detEmail) { sujo = false; }
    shell("Admin", `
      <div class="adm ${alvo ? "com-detalhe" : ""}">
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
    const antes = detEmail;
    detEmail = ""; det = null; edit = null;
    pintarDetalhe();
    // voltou do detalhe: foco na linha do usuário que estava aberto
    const linhaAntes = antes && app.querySelector(`a[href="#/admin/${CSS.escape(encodeURIComponent(antes))}"]`);
    if (linhaAntes) linhaAntes.focus(); else if (antes) $("#admListaTit").focus();
  }

  // ---------- resumo ----------
  async function carregarResumo() {
    try { resumo = await api("admin", { op: "resumo" }); } catch (e) { resumo = { erro: e.message }; }
    pintarResumo();
  }
  function pintarResumo() {
    const el = $("#admResumo");
    if (!el) return;
    if (!resumo) { el.innerHTML = estado("Carregando resumo…"); return; }
    if (resumo.erro) { el.innerHTML = estado(resumo.erro, "resumo"); return; }
    const c = (n, t) => `<div class="stat"><b>${n}</b><span>${t}</span></div>`;
    el.innerHTML = `<div class="adm-cards">
      ${c(resumo.usuarios, "usuários")}${c(resumo.novos7d, "novos em 7 dias")}${c(resumo.comTreino, "com treino")}
      ${c(resumo.comAcesso, "com acesso liberado")}${c(resumo.checkinsHoje, "check-ins hoje")}${c(resumo.checkinsSemana, "check-ins na semana")}
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
        <h2 id="admTrTit" class="adm-tit">Treino${sujo ? ' <span class="selo aviso">Não salvo</span>' : ""}</h2>
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
    return ({ plano_salvar: "Treino editado", plano_pdf: "Treino enviado por PDF", plano_remover: "Treino removido" }[h.acao] || h.acao) + n;
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
    try {
      const r = await api("admin", { email: detEmail, ...corpo });
      toast(okMsg);
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
      if (!det.plano || confirm(`O PDF vai substituir o treino atual de ${det.nome}. Continuar?`)) $("#admPdf").click();
      return;
    }
    if (ds.removerPlano !== undefined) {
      if (confirm(`Remover o treino de ${det.nome}? A aba Treinos some para ele até receber outro.`)) escrever({ op: "plano_remover" }, "Treino removido.", b);
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
    sujo = true;
    if (ds.addTreino !== undefined) {
      const id = proximoId();
      edit.treinos.push({ id, nome: "Treino " + id, exercicios: [exNovo()] });
      aba = edit.treinos.length - 1;
      return redesenhar("[data-treino-nome]");
    }
    if (ds.tirarTreino !== undefined) {
      if (!confirm(`Excluir o treino ${t.id} (${t.nome}) deste plano? Só vale depois de salvar.`)) return;
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

  window.FitWayAdmin = { render };
})();
