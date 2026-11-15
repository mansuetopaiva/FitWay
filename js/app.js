/* Firme — conta, check-ins e cargas ficam no servidor (api/app.js, Vercel + Postgres). */
(function () {
  "use strict";

  // ---------- utilidades ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const app = $("#app");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  const store = {
    get(k, def) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* sem armazenamento */ } },
  };

  const ICON = {
    home: "M12 3 3 11h2.5v9h5v-6h3v6h5v-9H21z",
    gym: "M20.6 14.9 22 13.4l-1.4-1.4-3.6 3.6L8.4 7l3.6-3.6L10.6 2 9.1 3.4 7.7 2 5.6 4.1 4.1 2.7 2.7 4.1l1.4 1.5L2 7.7l1.4 1.4L2 10.6 3.4 12 7 8.4l8.6 8.6-3.6 3.6 1.4 1.4 1.5-1.4 1.4 1.4 2.1-2.1 1.5 1.4 1.4-1.4-1.4-1.5 2.1-2.1z",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5z",
    back: "M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z",
    next: "M8.6 18.6 10 20l8-8-8-8-1.4 1.4L15.2 12z",
    chev: "M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z",
    play: "M8 5v14l11-7z",
    check: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z",
    reps: "M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z",
    timer: "M15 1H9v2h6zm-4 13h2V8h-2zm8-6.6 1.4-1.4L19 4.6 17.6 6A9 9 0 1 0 19 7.4zM12 20a7 7 0 1 1 0-14 7 7 0 0 1 0 14z",
    edit: "M3 17.2V21h3.8L17.8 9.9l-3.7-3.7zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7z",
    eye: "M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  };
  const icon = (n, cls) => `<svg class="i ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[n]}"/></svg>`;

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- conta e dados (no servidor) ----------
  async function api(acao, corpo) {
    const r = await fetch("/api/app", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao, ...corpo }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erro || "Erro no servidor. Tente de novo."), { status: r.status });
    return j;
  }
  let email = null, nomeUser = "", data = null;
  // Esta chave só existe enquanto há algo que o servidor ainda não confirmou
  // (salvamento sem conexão, ou dados da versão antiga que ficava só no navegador).
  const dataKey = () => "mt_data_" + email;
  function loadData(d) {
    d = d && typeof d === "object" ? d : {};
    data = {
      checkins: Array.isArray(d.checkins) ? d.checkins.filter((x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) : [],
      sessoes: Number.isFinite(d.sessoes) ? d.sessoes : 0,
      proximo: typeof d.proximo === "string" ? d.proximo : "B",
      cargas: d.cargas && typeof d.cargas === "object" ? d.cargas : {},
    };
  }
  async function entrou(u) {
    email = u.email; nomeUser = u.nome;
    store.set("mt_session", email); // avisa as outras abas (evento "storage")
    loadData(u.dados);
    const pend = store.get(dataKey(), null);
    if (!pend) return;
    try { loadData((await api("salvar", { dados: pend })).dados); store.del(dataKey()); }
    catch (e) { loadData(pend); } // sem conexão: segue com a cópia local, que sobe no próximo salvamento
  }
  const sessaoKey = () => "mt_sessao_" + email;
  function saveSessao() { if (sessao && sessao.inicio) store.set(sessaoKey(), sessao); else store.del(sessaoKey()); }
  function save() {
    const k = dataKey(), copia = data;
    store.set(k, copia);
    api("salvar", { dados: copia }).then(() => store.del(k), () => {
      store.set(k, copia);
      toast("Sem conexão: salvo só neste aparelho por enquanto.");
    });
  }

  // ---------- login ----------
  let loginMode = "entrar";
  function viewLogin() {
    const criar = loginMode === "criar";
    app.innerHTML = `
      <main class="login">
        <div class="logo">${icon("gym")}</div>
        <h1>Firme</h1>
        <p class="sub">${criar ? "Crie sua conta para registrar seus treinos." : "Entre para ver seus treinos e check-ins."}</p>
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected="${!criar}" class="${criar ? "" : "on"}" data-mode="entrar">Entrar</button>
          <button role="tab" aria-selected="${criar}" class="${criar ? "on" : ""}" data-mode="criar">Criar conta</button>
        </div>
        <form novalidate>
          ${criar ? `<div class="field"><label for="nome">Nome</label><input id="nome" autocomplete="given-name" maxlength="40" required></div>` : ""}
          <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" inputmode="email" maxlength="120" required></div>
          <div class="field"><label for="senha">Senha</label>
            <div class="pw"><input id="senha" type="password" autocomplete="${criar ? "new-password" : "current-password"}" minlength="6" maxlength="100" required>
            <button type="button" class="icon-btn" id="ver" aria-label="Mostrar senha" aria-pressed="false">${icon("eye")}</button></div>
          </div>
          <p class="err" role="alert"></p>
          <button class="btn" type="submit">${criar ? "Criar conta" : "Entrar"}</button>
        </form>
        <p class="muted" style="margin-top:16px;text-align:center">Seus dados ficam salvos na sua conta e aparecem em qualquer aparelho.</p>
      </main>`;
    app.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => {
      const em = $("#email").value, pw = $("#senha").value;
      loginMode = b.dataset.mode; viewLogin();
      $("#email").value = em; $("#senha").value = pw;
      $(`[data-mode="${loginMode}"]`).focus();
    });
    $("#ver").onclick = (e) => {
      const i = $("#senha"), show = i.type === "password";
      i.type = show ? "text" : "password";
      e.currentTarget.setAttribute("aria-pressed", show);
    };
    $("form").onsubmit = async (ev) => {
      ev.preventDefault();
      const err = $(".err");
      const em = $("#email").value.trim().toLowerCase();
      const pw = $("#senha").value;
      const nome = criar ? $("#nome").value.trim() : "";
      if (criar && !nome) return (err.textContent = "Digite seu nome.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return (err.textContent = "Digite um email válido, como nome@exemplo.com.");
      if (pw.length < 6) return (err.textContent = "A senha precisa ter pelo menos 6 caracteres.");
      const botao = $("form .btn");
      botao.disabled = true;
      err.textContent = "";
      try { await entrou(await api(criar ? "criar" : "entrar", { nome, email: em, senha: pw })); }
      catch (e) {
        botao.disabled = false;
        return (err.textContent = e.status ? e.message : "Sem conexão com o servidor. Tente de novo.");
      }
      restoreSessao();
      location.hash = "#/inicio";
      render();
    };
    $(criar ? "#nome" : "#email").focus();
  }

  function sair() {
    stopRest();
    sessao = null;
    api("sair").catch(() => {});
    store.del("mt_session");
    email = null; data = null;
    location.hash = "";
    render();
  }

  // ---------- estrutura ----------
  function shell(title, body, tab) {
    const item = (href, ic, label, id) =>
      `<a href="${href}" class="${tab === id ? "on" : ""}" ${tab === id ? 'aria-current="page"' : ""}><span>${icon(ic)}</span>${label}</a>`;
    app.innerHTML = `
      <header class="topbar"><h1>${title}</h1></header>
      <main class="screen">${body}</main>
      <nav class="nav" aria-label="Principal">
        ${item("#/inicio", "home", "Início", "inicio")}
        ${item("#/treinos", "gym", "Treinos", "treinos")}
        ${item("#/perfil", "user", "Perfil", "perfil")}
      </nav>`;
  }

  // ---------- início: check-in + gráfico ----------
  let chartMode = "semana", diaRender = "";
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function fezCheckin(d) { return data.checkins.includes(dayKey(d)); }
  function checkin() {
    const k = dayKey(today());
    if (data.checkins.includes(k)) return false;
    data.checkins.push(k);
    data.checkins.sort();
    save();
    return true;
  }
  function sequencia() {
    let d = today(), n = 0;
    if (!fezCheckin(d)) d = addDays(d, -1); // hoje ainda pode ser feito
    while (fezCheckin(d)) { n++; d = addDays(d, -1); }
    return n;
  }
  function serie() {
    const set = new Set(data.checkins), t = today(), out = [];
    if (chartMode === "semana") {
      const ini = addDays(t, -t.getDay()); // domingo desta semana
      for (let w = 7; w >= 0; w--) {
        const s = addDays(ini, -7 * w);
        let n = 0;
        for (let i = 0; i < 7; i++) if (set.has(dayKey(addDays(s, i)))) n++;
        out.push({ v: n, label: `${pad(s.getDate())}/${pad(s.getMonth() + 1)}`, now: w === 0 });
      }
      return { pts: out, max: 7, legenda: "Dias com check-in em cada semana (a data é o domingo que inicia a semana)." };
    }
    for (let m = 5; m >= 0; m--) {
      const s = new Date(t.getFullYear(), t.getMonth() - m, 1);
      const pref = `${s.getFullYear()}-${pad(s.getMonth() + 1)}-`;
      out.push({ v: data.checkins.filter((k) => k.startsWith(pref)).length, label: MESES[s.getMonth()], now: m === 0 });
    }
    return { pts: out, max: Math.max(10, ...out.map((p) => p.v)), legenda: "Dias com check-in em cada mês." };
  }

  function viewInicio() {
    const u = { nome: nomeUser };
    const t = today(), h = new Date().getHours();
    const saud = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
    const dataTxt = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    const feito = fezCheckin(t);
    diaRender = dayKey(t);
    const ini = addDays(t, -t.getDay());
    const week = "DSTQQSS".split("").map((l, i) => {
      const d = addDays(ini, i), ok = fezCheckin(d), hoje = +d === +t;
      return `<div class="${ok ? "ok" : ""} ${hoje ? "today" : ""}">${l}<i aria-label="${d.getDate()}${ok ? ", check-in feito" : ""}">${ok ? "✓" : d.getDate()}</i></div>`;
    }).join("");
    const mesPref = dayKey(t).slice(0, 8);
    const s = serie();
    shell("Início", `
      <h2 class="hello">${saud}, ${esc(u.nome)} 👋</h2>
      <p class="muted">${esc(dataTxt.charAt(0).toUpperCase() + dataTxt.slice(1))}</p>

      <section class="card checkin">
        <h2>Check-in diário</h2>
        <div class="week">${week}</div>
        <button class="btn ${feito ? "done" : ""}" id="ck" ${feito ? "disabled" : ""}>${feito ? "Check-in de hoje feito ✓" : "Fazer check-in de hoje"}</button>
      </section>

      <section class="stats" aria-label="Resumo">
        <div class="stat"><b>${sequencia()}</b><span>dias seguidos</span></div>
        <div class="stat"><b>${data.checkins.filter((k) => k.startsWith(mesPref)).length}</b><span>neste mês</span></div>
        <div class="stat"><b>${data.checkins.length}</b><span>no total</span></div>
      </section>

      <section class="card">
        <div class="chart-head">
          <h2>Dias de check-in</h2>
          <div class="seg">
            <button data-c="semana" class="${chartMode === "semana" ? "on" : ""}" aria-pressed="${chartMode === "semana"}">Semanas</button>
            <button data-c="mes" class="${chartMode === "mes" ? "on" : ""}" aria-pressed="${chartMode === "mes"}">Meses</button>
          </div>
        </div>
        <div class="chart" role="img" aria-label="${esc(s.legenda)} ${s.pts.map((p) => `${p.label}: ${p.v}`).join(", ")}">
          ${s.pts.map((p) => `<div class="bar ${p.now ? "now" : ""}"><b>${p.v}</b><i style="height:${Math.round((p.v / s.max) * 82)}%"></i></div>`).join("")}
        </div>
        <div class="xlabels" aria-hidden="true">${s.pts.map((p) => `<span>${p.label}</span>`).join("")}</div>
        <p class="muted" style="margin-top:10px">${s.legenda}</p>
      </section>`, "inicio");
    const ck = $("#ck");
    ck.onclick = () => { if (checkin()) toast("Check-in feito. Bom treino!"); viewInicio(); $("#ck").focus(); };
    app.querySelectorAll("[data-c]").forEach((b) => b.onclick = () => { chartMode = b.dataset.c; viewInicio(); $(`[data-c="${chartMode}"]`).focus(); });
  }

  // ---------- treinos ----------
  const treino = (id) => PLANO.treinos.find((t) => t.id === id);
  const gif = (nome) => `gifs/${encodeURIComponent(nome)}.gif`;
  const thumb = (nome) => `gifs/thumb/${encodeURIComponent(nome)}.png`;
  let sessao = null; // { id, inicio, feitas: {idx: n}, aberta: idx, editando: bool }
  let restTimer = null, rest = 0, restEnd = 0, tickTimer = null;
  const feitasSessoes = () => Math.min(data.sessoes, PLANO.totalSessoes);
  function restoreSessao() {
    const s = store.get(sessaoKey(), null);
    sessao = s && treino(s.id) && Number.isFinite(s.inicio) && s.feitas && typeof s.feitas === "object"
      ? { id: s.id, inicio: s.inicio, feitas: s.feitas, aberta: Number.isInteger(s.aberta) ? s.aberta : -1 } : null;
  }

  function ordem() {
    const i = Math.max(0, PLANO.treinos.findIndex((t) => t.id === data.proximo));
    return PLANO.treinos.slice(i).concat(PLANO.treinos.slice(0, i));
  }

  function viewTreinos() {
    const lista = ordem().map((t, i) => `
      <button class="wk ${i === 0 ? "next" : ""}" data-id="${esc(t.id)}">
        ${i === 0 ? '<span class="badge">Próximo</span>' : ""}
        <img class="thumb" src="${thumb(t.exercicios[0][1])}" alt="" width="46" height="46" loading="lazy">
        <span class="t"><b>${esc(t.nome)}</b><span class="muted">${t.exercicios.length} exercícios</span></span>
        <span class="play">${icon("play")}</span>
      </button>`).join("");
    const pct = Math.min(100, (data.sessoes / PLANO.totalSessoes) * 100);
    shell("Treinos", `
      <p class="label">Treinos</p>
      <section class="card">
        <div class="plan-head"><b style="font-weight:400">${esc(PLANO.nome)}</b></div>
        ${lista}
        <div class="progress">
          <span>${feitasSessoes()}/${PLANO.totalSessoes} sessões</span>
          <div class="track"><i style="width:${pct}%"></i></div>
          <span>Validade: ${esc(PLANO.validade)}</span>
        </div>
      </section>`, "treinos");
    app.querySelectorAll(".wk").forEach((b) => b.onclick = () => (location.hash = "#/treino/" + b.dataset.id));
  }

  const carga = (t, i) => {
    const v = data.cargas[t.id + ":" + t.exercicios[i][1]];
    return Number.isFinite(v) ? v : t.exercicios[i][4];
  };
  const fmt = (s) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;

  function stopRest() { clearInterval(restTimer); restTimer = null; rest = 0; restEnd = 0; }
  function tickRest() {
    if (!restEnd) return;
    rest = Math.max(0, Math.ceil((restEnd - Date.now()) / 1000));
    if (rest <= 0) { stopRest(); toast("Intervalo acabou. Próxima série!"); if (navigator.vibrate) navigator.vibrate(200); }
    paintBottom();
  }
  function startRest(seg) {
    stopRest();
    if (!seg) return;
    restEnd = Date.now() + seg * 1000;
    rest = seg;
    restTimer = setInterval(tickRest, 500);
  }
  function iniciar(id) {
    if (sessao && sessao.id === id && sessao.inicio) return;
    sessao = { id, inicio: Date.now(), feitas: (sessao && sessao.id === id && sessao.feitas) || {}, aberta: sessao && sessao.id === id ? sessao.aberta : 0 };
    saveSessao();
  }
  function finalizar() {
    const t = treino(sessao.id);
    if (Date.now() - sessao.inicio < 1500) return; // evita toque duplo em "Iniciar treino"
    const completo = t.exercicios.every((e, k) => (sessao.feitas[k] || 0) >= e[2]);
    if (!completo && !confirm("Ainda há exercícios sem concluir. Finalizar o treino mesmo assim?")) return;
    const idx = PLANO.treinos.indexOf(t);
    data.sessoes++;
    data.proximo = PLANO.treinos[(idx + 1) % PLANO.treinos.length].id;
    const novo = checkin();
    save();
    stopRest();
    sessao = null;
    saveSessao();
    toast(novo ? "Treino finalizado e check-in de hoje feito!" : "Treino finalizado!");
    location.hash = "#/treinos";
  }
  // A barra só é reconstruída quando muda de formato; a cada segundo só o texto do tempo é trocado.
  function paintBottom() {
    const el = $(".bottom");
    if (!el || !sessao) return;
    const ativo = !!sessao.inicio, forma = `${ativo}|${rest > 0}`;
    if (el.dataset.forma !== forma) {
      const foco = document.activeElement && document.activeElement.id;
      el.dataset.forma = forma;
      el.innerHTML = `
        ${rest > 0 ? `<div class="rest"><b id="restT"></b><span>Intervalo de descanso</span><button id="pular">Pular</button></div>` : ""}
        <button class="btn" id="go">${ativo ? `Finalizar treino (<span id="goT"></span>)` : "Iniciar treino"}</button>`;
      if (rest > 0) $("#pular").onclick = () => { stopRest(); paintBottom(); $("#go").focus(); };
      $("#go").onclick = () => {
        if (sessao.inicio) return finalizar();
        iniciar(sessao.id); toast("Treino iniciado."); viewTreino(sessao.id); $("#go").focus();
      };
      if (foco === "go") $("#go").focus();
    }
    if (ativo) $("#goT").textContent = fmt(Math.floor((Date.now() - sessao.inicio) / 1000));
    if (rest > 0) $("#restT").textContent = fmt(rest);
  }

  function viewTreino(id) {
    const t = treino(id);
    if (!t) { location.hash = "#/treinos"; return; }
    if (sessao && sessao.inicio && sessao.id !== id) {
      const ativo = treino(sessao.id);
      if (!confirm(`O treino "${ativo.nome}" está em andamento. Trocar de treino descarta o progresso dele. Trocar?`)) {
        location.hash = "#/treino/" + sessao.id; return;
      }
      stopRest(); sessao = null; saveSessao();
    }
    if (!sessao || sessao.id !== id) { stopRest(); sessao = { id, inicio: null, feitas: {}, aberta: -1 }; }
    const idx = PLANO.treinos.indexOf(t), n = PLANO.treinos.length;
    const ant = PLANO.treinos[(idx + n - 1) % n].id, prox = PLANO.treinos[(idx + 1) % n].id;

    const exs = t.exercicios.map((e, i) => {
      const [nome, g, series, reps, , intervalo, instr] = e;
      const feitas = sessao.feitas[i] || 0, completo = feitas >= series, aberto = sessao.aberta === i;
      let body = "";
      if (aberto) {
        const pills = Array.from({ length: series }, (_, k) => {
          if (k < feitas) return k === feitas - 1
            ? `<button class="ok" data-desfaz="${i}" aria-label="Desfazer série ${k + 1}" title="Desfazer">✓</button>`
            : `<button class="ok" disabled aria-label="Série ${k + 1} concluída">✓</button>`;
          if (k === feitas) return `<button class="cur" data-serie="${i}">Concluir série ${k + 1}</button>`;
          return `<button disabled aria-label="Série ${k + 1}">${k + 1}</button>`;
        }).join("");
        body = `<div class="ex-body" id="ex-${i}">
          <img class="gif" src="${gif(g)}" alt="Animação do exercício ${esc(nome)}" width="240" height="240">
          <div class="sets">${pills}</div>
          <div class="tiles">
            <div class="tile">${icon("reps")}<span>Repetições</span><b>${reps}x</b></div>
            <div class="tile">${icon("gym")}<span>Carga</span><b>${carga(t, i)}kg</b></div>
            <div class="tile">${icon("timer")}<span>Intervalo</span><b>${intervalo}″</b></div>
          </div>
          <div class="instr"><b>Instruções:</b>${esc(instr)}</div>
          <button class="btn ${completo ? "done" : ""}" data-fim="${i}" ${completo ? "disabled" : ""}>${completo ? "Exercício concluído ✓" : "Concluir exercício"}</button>
          ${sessao.editando ? `<div class="load">
              <button data-kg="-1" aria-label="Diminuir 1 kg">−</button>
              <input id="kg" type="number" inputmode="decimal" min="0" max="500" step="0.5" value="${carga(t, i)}" aria-label="Carga em kg">
              <button data-kg="1" aria-label="Aumentar 1 kg">+</button>
              <button data-kg="ok" class="btn" style="width:auto;padding:0 16px;height:40px;border-radius:20px;font-size:13px">Salvar</button>
            </div>` : `<div class="tools"><button data-edit="${i}">${icon("edit")}Editar carga</button></div>`}
        </div>`;
      }
      return `<section class="ex ${aberto ? "open" : ""} ${completo ? "complete" : ""}">
        <button class="ex-head" data-open="${i}" aria-expanded="${aberto}" aria-controls="ex-${i}">
          <img class="thumb" src="${thumb(g)}" alt="" width="46" height="46" loading="lazy">
          <b>${esc(nome)}</b>${icon("check", "check")}${icon("chev", "chev")}
        </button>${body}</section>`;
    }).join("");

    app.innerHTML = `
      <header class="topbar center">
        <a class="icon-btn" href="#/treinos" aria-label="Voltar para a lista de treinos">${icon("back")}</a><h1>Treinos</h1>
      </header>
      <main class="screen treino">
        <div class="switch">
          <a class="icon-btn" href="#/treino/${ant}" aria-label="Treino anterior">${icon("back")}</a>
          <b>${esc(t.nome)}</b>
          <a class="icon-btn" href="#/treino/${prox}" aria-label="Próximo treino">${icon("next")}</a>
        </div>
        ${exs}
      </main>
      <div class="bottom"></div>`;
    paintBottom();

    const rerender = (focusSel) => { viewTreino(id); const f = focusSel && $(focusSel); if (f) f.focus(); };
    app.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => {
      const i = +b.dataset.open;
      sessao.aberta = sessao.aberta === i ? -1 : i;
      sessao.editando = false;
      saveSessao();
      rerender(`[data-open="${i}"]`);
    });
    const concluir = (i, todas) => {
      const series = t.exercicios[i][2];
      iniciar(id);
      sessao.feitas[i] = todas ? series : Math.min(series, (sessao.feitas[i] || 0) + 1);
      const acabou = sessao.feitas[i] >= series;
      const ultimo = acabou && t.exercicios.every((e, k) => (sessao.feitas[k] || 0) >= e[2]);
      if (acabou) { sessao.aberta = ultimo ? -1 : (i + 1 < t.exercicios.length ? i + 1 : -1); sessao.editando = false; }
      if (ultimo) { stopRest(); toast("Todos os exercícios concluídos. Finalize o treino!"); }
      else startRest(t.exercicios[i][5]);
      saveSessao();
      rerender(acabou ? (sessao.aberta >= 0 ? `[data-open="${sessao.aberta}"]` : "#go") : "[data-serie]");
    };
    app.querySelectorAll("[data-desfaz]").forEach((b) => b.onclick = () => {
      const i = +b.dataset.desfaz;
      sessao.feitas[i] = Math.max(0, (sessao.feitas[i] || 0) - 1);
      stopRest(); saveSessao();
      rerender("[data-serie]");
    });
    app.querySelectorAll("[data-serie]").forEach((b) => b.onclick = () => concluir(+b.dataset.serie, false));
    app.querySelectorAll("[data-fim]").forEach((b) => b.onclick = () => concluir(+b.dataset.fim, true));
    app.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => { sessao.editando = true; rerender("#kg"); });
    app.querySelectorAll("[data-kg]").forEach((b) => b.onclick = () => {
      const inp = $("#kg");
      let v = Math.min(500, Math.max(0, parseFloat(inp.value.replace(",", ".")) || 0));
      if (b.dataset.kg !== "ok") { inp.value = Math.max(0, v + +b.dataset.kg); return; }
      v = Math.round(v * 2) / 2;
      data.cargas[id + ":" + t.exercicios[sessao.aberta][1]] = v;
      save();
      sessao.editando = false;
      toast("Carga salva: " + v + "kg");
      rerender("[data-edit]");
    });
  }

  // ---------- perfil ----------
  function viewPerfil() {
    const u = { nome: nomeUser };
    shell("Perfil", `
      <section class="card profile">
        <div class="avatar" aria-hidden="true">${esc((u.nome || "?").charAt(0).toUpperCase())}</div>
        <h2>${esc(u.nome)}</h2>
        <p class="muted">${esc(email)}</p>
      </section>
      <section class="card">
        <div class="row"><span>Plano</span><span>${esc(PLANO.nome)}</span></div>
        <div class="row"><span>Sessões feitas</span><span>${feitasSessoes()}/${PLANO.totalSessoes}</span></div>
        <div class="row"><span>Check-ins</span><span>${data.checkins.length}</span></div>
      </section>
      <button class="btn" id="sair" style="margin-top:16px">Sair</button>`, "perfil");
    $("#sair").onclick = sair;
  }

  // ---------- rotas ----------
  function render() {
    clearInterval(tickTimer);
    if (!email) return viewLogin();
    const [, rota, arg] = location.hash.split("/");
    if (rota !== "treino") stopRest();
    if (rota === "treinos") viewTreinos();
    else if (rota === "treino") {
      viewTreino(arg);
      tickTimer = setInterval(() => { if (!document.hidden && sessao && sessao.inicio && rest === 0) paintBottom(); }, 1000);
    }
    else if (rota === "perfil") viewPerfil();
    else viewInicio();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", render);
  // volta do segundo plano: acerta o cronômetro e vira o dia na tela inicial
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !email) return;
    tickRest();
    const rota = location.hash.split("/")[1];
    if (rota !== "treino" && rota !== "treinos" && rota !== "perfil" && diaRender !== dayKey(today())) render();
  });
  // outra aba entrou ou saiu da conta
  window.addEventListener("storage", (ev) => { if (ev.key === "mt_session") location.reload(); });
  // o cookie de sessão é HttpOnly: só o servidor sabe dizer se há alguém logado
  (async () => {
    try { await entrou(await api("eu")); }
    catch (e) { if (e.status !== 401) toast("Sem conexão com o servidor."); }
    if (email) restoreSessao();
    render();
  })();
})();
