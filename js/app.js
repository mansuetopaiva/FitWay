/* FitWay — conta, check-ins e cargas ficam no servidor (api/app.js, Vercel + Postgres). */
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
    trophy: "M19 5h-2V3H7v2H5a2 2 0 0 0-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5 5 0 0 0 11 15.9V19H7v2h10v-2h-4v-3.1a5 5 0 0 0 3.61-2.96C19.08 12.63 21 10.55 21 8V7a2 2 0 0 0-2-2zM5 8V7h2v3.82A3 3 0 0 1 5 8zm14 0a3 3 0 0 1-2 2.82V7h2z",
    shield: "M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5zm-1.2 14.4-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4z",
    help: "M11 18h2v-2h-2zm1-16a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm0-14a4 4 0 0 0-4 4h2a2 2 0 1 1 4 0c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5a4 4 0 0 0-4-4z",
    eye: "M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  };
  const icon = (n, cls) => `<svg class="i ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[n]}"/></svg>`;

  // Erro de formulário: o texto vai para o <p class="err" role="alert"> (anunciado por leitor de tela) e, quando o erro é de um
  // campo, o campo ganha aria-invalid e aria-describedby apontando para a mensagem, e recebe o foco. Mensagem vazia limpa tudo.
  let nErr = 0;
  function erro(err, msg, campo) {
    if (!err) return msg && toast(msg);
    const raiz = err.closest("form") || err.parentElement;
    err.id ||= "err" + (++nErr);
    raiz.querySelectorAll("[aria-invalid]").forEach((i) => i.removeAttribute("aria-invalid"));
    raiz.querySelectorAll("[aria-describedby]").forEach((i) => { // desliga os campos da mensagem anterior; só o campo deste erro volta a apontar para ela
      const resto = i.getAttribute("aria-describedby").split(" ").filter((x) => x && x !== err.id).join(" ");
      if (resto) i.setAttribute("aria-describedby", resto); else i.removeAttribute("aria-describedby");
    });
    err.textContent = msg;
    if (campo && msg) {
      campo.setAttribute("aria-invalid", "true");
      campo.setAttribute("aria-describedby", [...new Set((campo.getAttribute("aria-describedby") || "").split(" ").filter(Boolean).concat(err.id))].join(" "));
      campo.focus();
    }
  }
  document.addEventListener("input", (ev) => { if (ev.target.removeAttribute) ev.target.removeAttribute("aria-invalid"); }); // a pessoa está corrigindo
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
    const r = await fetch("/api/app", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao, conta: email || undefined, ...corpo }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409 && j.trocaConta) { toast(j.erro); setTimeout(() => location.reload(), 1200); } // só a troca de conta recarrega: nenhuma outra recusa usa trocaConta
    if (!r.ok) throw Object.assign(new Error(j.erro || "Erro no servidor. Tente de novo."), { status: r.status, termoMudou: j.termoMudou === true, recomecar: j.recomecar === true });
    return j;
  }
  let email = null, nomeUser = "", fotoUser = "", adminUser = false, data = null, suporteAviso = false;
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
      plano: d.plano && Array.isArray(d.plano.treinos) && d.plano.treinos.length ? d.plano : null, // treino enviado em PDF
    };
  }
  const plano = () => data && data.plano; // só existe depois que a pessoa envia o PDF
  async function entrou(u) {
    email = u.email; nomeUser = u.nome; fotoUser = u.foto || ""; adminUser = u.admin === true; suporteAviso = u.suporteNaoLido === true; // só visual: o servidor confere a cada chamada
    store.set("mt_session", email); // avisa as outras abas (evento "storage")
    loadData(u.dados);
    const pend = store.get(dataKey(), null);
    if (!pend) return;
    try { loadData((await api("salvar", { dados: pend })).dados); store.del(dataKey()); }
    catch (e) { loadData({ ...pend, plano: u.dados && u.dados.plano }); } // sem conexão: segue com a cópia local; o plano é sempre o do servidor
  }
  const sessaoKey = () => "mt_sessao_" + email;
  function saveSessao() { if (sessao && sessao.inicio) store.set(sessaoKey(), sessao); else store.del(sessaoKey()); }
  function save() {
    // Sem o plano: ele só vem do servidor (um plano de IA vencido não pode voltar por uma cópia antiga).
    const k = dataKey(), copia = { ...data, plano: undefined };
    store.set(k, copia);
    api("salvar", { dados: copia }).then((r) => {
      store.del(k);
      // O servidor descarta o que não vale (check-in com data depois de hoje em Brasília): o app fica com o que ele guardou.
      const guardados = new Set(r && r.dados && Array.isArray(r.dados.checkins) ? r.dados.checkins : copia.checkins);
      const fora = data && data.checkins.filter((c) => copia.checkins.includes(c) && !guardados.has(c));
      if (fora && fora.length) {
        data.checkins = data.checkins.filter((c) => !fora.includes(c));
        toast("Esta data não foi registrada: o check-in não pode ser depois de hoje. Confira a data do aparelho.");
        if (location.hash.split("/")[1] === "inicio" || !location.hash.split("/")[1]) viewInicio();
      }
    }, () => {
      store.set(k, copia);
      toast("Sem conexão: salvo só neste aparelho por enquanto.");
    });
  }

  // ---------- login ----------
  let loginMode = "entrar";
  function viewLogin() {
    if (loginMode === "esqueci") return viewEsqueci();
    const criar = loginMode === "criar";
    app.innerHTML = `
      <main class="login">
        <h1><img class="logo" src="img/fitway-logo.webp" alt="FitWay — seu caminho fitness" width="1029" height="528"></h1>
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
          ${criar ? `<p class="muted login-aceite" id="loginAceite">Ao criar a conta, você concorda com a <a href="#/privacidade">Política de privacidade</a>.</p>` : ""}
          <button class="btn" type="submit" ${criar ? 'aria-describedby="loginAceite"' : ""}>${criar ? "Criar conta" : "Entrar"}</button>
        </form>
        ${criar ? "" : `<p class="login-links"><button type="button" class="link" id="esqueci">Esqueci a senha</button></p>`}
        <p class="muted" style="margin-top:16px;text-align:center">Seus dados ficam salvos na sua conta e aparecem em qualquer aparelho.</p>
        <p class="muted login-links"><a href="#/privacidade">Política de privacidade</a></p>
      </main>`;
    if (!criar) $("#esqueci").onclick = () => { loginMode = "esqueci"; esqueciEmail = $("#email").value.trim(); viewLogin(); };
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
      if (criar && !nome) return erro(err, "Digite seu nome.", $("#nome"));
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return erro(err, "Digite um email válido, como nome@exemplo.com.", $("#email"));
      if (pw.length < 6) return erro(err, "A senha precisa ter pelo menos 6 caracteres.", $("#senha"));
      const botao = $("form .btn");
      botao.disabled = true;
      erro(err, "");
      try {
        const u = await api(criar ? "criar" : "entrar", { nome, email: em, senha: pw });
        if (u.precisa2fa) return viewDoisFatores(u); // admin: a senha certa não abre sessão; falta o código
        await entrou(u);
      } catch (e) {
        botao.disabled = false;
        return erro(err, e.status ? e.message : "Sem conexão com o servidor. Tente de novo.");
      }
      depoisDoLogin();
    };
    $(criar ? "#nome" : "#email").focus();
  }
  function depoisDoLogin() {
    restoreSessao();
    // Quem chegou pela volta do checkout (ou por um pedido) sem sessão continua na tela de destino; os outros vão ao início
    // (a conta nova começa enviando o PDF). Mudar o hash redesenha uma vez só (hashchange); sem mudança, redesenha aqui.
    const destino = /^#\/(pagamento|pedido)\//.test(location.hash) ? location.hash : data.plano ? "#/inicio" : "#/perfil";
    if (location.hash !== destino) location.hash = destino; else render();
  }

  // ---------- segundo fator do admin (docs/admin-2fa.md) ----------
  let dfRestantes = null, dfNovos = null, dfGerando = false; // códigos de recuperação restantes; códigos recém-gerados (só na tela, uma vez)
  const logoLogin = `<h1><img class="logo" src="img/fitway-logo.webp" alt="FitWay — seu caminho fitness" width="1029" height="528"></h1>`;
  const htmlCodigos = (cs) => `<ul class="df-codigos" id="dfCodigos">${cs.map((c) => `<li><code>${esc(c.slice(0, 5) + " " + c.slice(5))}</code></li>`).join("")}</ul>`;
  function viewDoisFatores(r) {
    const ativar = r.etapa === "ativar";
    app.innerHTML = `
      <main class="login">
        ${logoLogin}
        <h2 class="esq-tit" id="dfTit" tabindex="-1">${ativar ? "Ative a verificação em duas etapas" : "Verificação em duas etapas"}</h2>
        ${ativar ? `<ol class="df-passos">
            <li>No celular, abra um app autenticador (Google Authenticator, Microsoft Authenticator, Aegis…).</li>
            <li>Adicione uma conta com a chave abaixo ou toque no link.</li>
            <li>Digite aqui o código de 6 dígitos que o app mostrar.</li></ol>
          <p class="muted" id="dfChaveRot">Chave da conta, para digitar no app:</p>
          <p class="df-chave" id="dfChave" aria-labelledby="dfChaveRot">${esc(r.chave)}</p>
          <p><a class="df-link" href="${esc(r.otpauth)}">Abrir no app autenticador</a></p>`
          : `<p class="sub">Digite o código do seu app autenticador. Sem o celular, use um código de recuperação.</p>`}
        <form novalidate id="dfForm">
          <div class="field"><label for="dfCodigo">${ativar ? "Código de 6 dígitos" : "Código do app ou de recuperação"}</label>
            <input id="dfCodigo" autocomplete="one-time-code" inputmode="${ativar ? "numeric" : "text"}" maxlength="24" autocapitalize="characters" spellcheck="false" aria-describedby="dfDica" required></div>
          <p class="muted" id="dfDica">${ativar ? "O código muda a cada 30 segundos. Se der incorreto, confira se a hora do celular está no automático." : "O código do app tem 6 dígitos e muda a cada 30 segundos. O de recuperação tem 10 letras e números e vale uma vez."}</p>
          <p class="err" role="alert"></p>
          <button class="btn" type="submit">${ativar ? "Ativar e entrar" : "Entrar"}</button>
        </form>
        <p class="login-links"><button type="button" class="link" id="dfVoltar">Voltar para Entrar</button></p>
      </main>`;
    $("#dfVoltar").onclick = () => { loginMode = "entrar"; viewLogin(); };
    $("#dfTit").focus();
    $("#dfForm").onsubmit = async (ev) => {
      ev.preventDefault();
      const err = $("#dfForm .err"), cod = $("#dfCodigo").value.trim(), botao = $("#dfForm .btn");
      if (!cod) return erro(err, "Digite o código.", $("#dfCodigo"));
      botao.disabled = true; erro(err, "");
      let u;
      try { u = await api("entrar_2fa", { desafio: r.desafio, codigo: cod }); await entrou(u); }
      catch (e) {
        if (e.recomecar) { loginMode = "entrar"; viewLogin(); return erro($(".err"), e.message); } // desafio vencido ou gasto: recomeça pela senha
        botao.disabled = false;
        return erro(err, e.status ? e.message : "Sem conexão com o servidor. Tente de novo.", $("#dfCodigo"));
      }
      if (u.restantes !== undefined) dfRestantes = u.restantes;
      if (u.recuperacao) { dfRestantes = u.recuperacao.length; return viewCodigosRecuperacao(u.recuperacao); }
      depoisDoLogin();
      if (u.restantes !== undefined) toast(`Código de recuperação usado. Restam ${u.restantes}.${u.restantes <= 2 ? " Gere novos no Perfil." : ""}`);
    };
  }
  // Ativação concluída: os códigos aparecem só aqui, uma vez.
  function viewCodigosRecuperacao(codigos) {
    app.innerHTML = `
      <main class="login">
        ${logoLogin}
        <h2 class="esq-tit" id="dfCodTit" tabindex="-1">Guarde seus códigos de recuperação</h2>
        <p class="sub">Se você perder o celular, cada código entra uma vez no lugar do app. Eles não aparecem de novo: anote ou salve em um gerenciador de senhas.</p>
        ${htmlCodigos(codigos)}
        <button class="btn" id="dfOk" type="button">Guardei os códigos, continuar</button>
      </main>`;
    $("#dfCodTit").focus();
    $("#dfOk").onclick = depoisDoLogin;
  }

  // ---------- esqueci a senha (docs/senha.md) ----------
  let esqueciEmail = "", tokenSenha = "";
  const campoSenha = (id, rot, auto, dica = "") => `<div class="field"><label for="${id}">${rot}</label>
    <input id="${id}" type="password" autocomplete="${auto}" minlength="6" maxlength="100" required ${dica ? `aria-describedby="${dica}"` : ""}></div>`;
  // Uma caixa mostra/oculta todas as senhas do formulário (no celular, digitar a nova duas vezes às cegas é onde mais se erra).
  const mostrarSenhas = (id) => `<label class="ped-caixa mostrar-senhas"><input type="checkbox" id="${id}"> Mostrar senhas</label>`;
  const ligarMostrar = (id, form) => { $("#" + id).onchange = (ev) => form.querySelectorAll("input[autocomplete$=password]").forEach((i) => { i.type = ev.target.checked ? "text" : "password"; }); };
  // Campo de usuário escondido: o gerenciador de senhas sabe de que conta é a senha nova.
  const campoUsuario = (v) => `<input class="sr" type="email" autocomplete="username" value="${esc(v)}" readonly tabindex="-1" aria-hidden="true">`;
  async function viewEsqueci() {
    app.innerHTML = `
      <main class="login">
        <h1><img class="logo" src="img/fitway-logo.webp" alt="FitWay — seu caminho fitness" width="1029" height="528"></h1>
        <h2 class="esq-tit" id="esqTit" tabindex="-1">Esqueci a senha</h2>
        <div id="esqCorpo"><p class="muted" role="status">Carregando…</p></div>
        <p class="login-links"><button type="button" class="link" id="voltarLogin">Voltar para Entrar</button></p>
      </main>`;
    $("#voltarLogin").onclick = () => {
      const e = $("#email"); if (e) esqueciEmail = e.value.trim();
      loginMode = "entrar"; viewLogin(); if (esqueciEmail) { $("#email").value = esqueciEmail; $("#senha").focus(); }
    };
    $("#esqTit").focus();
    const corpoEl = $("#esqCorpo");
    let d;
    try { d = await api("senha_disponivel"); } catch (e) { d = { disponivel: true }; } // sem conexão: o envio mostra o erro
    if (loginMode !== "esqueci" || email || !corpoEl.isConnected) return;
    if (!d.disponivel) { corpoEl.innerHTML = `<p class="ia-status" role="alert">${esc(d.mensagem)}</p>`; return; }
    corpoEl.innerHTML = `<form novalidate id="esqForm">
        <p class="muted" style="margin-bottom:12px">Digite o email da sua conta. Vamos mandar um link para você criar uma senha nova.</p>
        <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" inputmode="email" maxlength="120" required value="${esc(esqueciEmail)}"></div>
        <p class="err" role="alert"></p>
        <button class="btn" type="submit">Enviar link</button>
      </form>`;
    if (document.activeElement === $("#esqTit")) $("#email").focus();
    $("#esqForm").onsubmit = async (ev) => {
      ev.preventDefault();
      const err = $("#esqForm .err"), em = $("#email").value.trim().toLowerCase(), botao = $("#esqForm .btn");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return erro(err, "Digite um email válido, como nome@exemplo.com.", $("#email"));
      botao.disabled = true; botao.textContent = "Enviando…"; erro(err, "");
      let r;
      try { r = await api("senha_pedir", { email: em }); }
      catch (e) { botao.disabled = false; botao.textContent = "Enviar link"; erro(err, e.status ? e.message : "Sem conexão com o servidor. Tente de novo."); return; }
      if (!corpoEl.isConnected) return; // a pessoa saiu e voltou: a resposta antiga não sobrescreve a tela nova
      corpoEl.innerHTML = `<p class="ia-status ${r.indisponivel ? "" : "ok"}" tabindex="-1" id="esqOk">${esc(r.mensagem)}</p>`;
      $("#esqOk").focus();
    };
  }
  // #/nova-senha/<token>: o token já saiu do endereço (veja o início do app) e fica só na memória.
  // O token sai do endereço (e do histórico) e fica só na memória. Roda na carga e a cada troca de rota (link colado numa aba aberta).
  function tirarToken() {
    const m = /^#\/nova-senha\/([A-Za-z0-9_-]{1,100})$/.exec(location.hash);
    if (!m) return;
    tokenSenha = m[1];
    history.replaceState(null, "", location.pathname + location.search + "#/nova-senha");
  }
  // Igual ao MSG_LINK de api/_senha.js (test/senha.test.js confere).
  const MSG_LINK_APP = "Este link não vale mais. Peça um novo em Esqueci a senha.";
  let contaToken = { token: "", email: "" }; // de que conta é o link (consultado uma vez por token)
  async function viewNovaSenha(motivo) {
    const fora = !email;
    const casca = (corpo) => {
      app.innerHTML = `<main class="login">
        <h1><img class="logo" src="img/fitway-logo.webp" alt="FitWay — seu caminho fitness" width="1029" height="528"></h1>
        <h2 class="esq-tit" id="esqTit" tabindex="-1">Criar uma senha nova</h2>${corpo}
        <p class="login-links">${fora ? `<a class="link-alto" href="#/">Voltar para Entrar</a>` : `<a class="link-alto" href="#/perfil">Voltar ao app</a>`}</p></main>`;
      $("#esqTit").focus();
    };
    const semToken = (vencido) => casca((vencido ? `<p class="ia-status" role="alert">${esc(MSG_LINK_APP)}</p>`
      : `<p class="ia-status">Abra de novo o link que enviamos por email. Se ele já foi usado ou passou de 30 minutos, peça um novo.</p>`)
      + (fora ? `<button type="button" class="btn" id="pedirNovo" style="margin-top:12px">Pedir um link novo</button>`
        : `<p class="login-links"><a class="link-alto" href="#/perfil">Trocar a senha no Perfil</a></p>`));
    const ligarPedir = () => { if (fora) $("#pedirNovo").onclick = () => { loginMode = "esqueci"; history.replaceState(null, "", location.pathname + "#/"); render(); }; };
    if (!tokenSenha) { semToken(motivo === "vencido"); return ligarPedir(); }
    if (contaToken.token !== tokenSenha) {
      casca(`<p class="muted" role="status">Conferindo o link…</p>`);
      const t = tokenSenha;
      try { contaToken = { token: t, email: (await api("senha_conta", { token: t })).email }; }
      catch (e) {
        if (location.hash.split("/")[1] !== "nova-senha") return;
        if (e.status === 400) { tokenSenha = ""; semToken(true); return ligarPedir(); }
        return casca(`<p class="err" role="alert">${esc(e.status ? e.message : "Sem conexão com o servidor. Tente de novo.")}</p>`);
      }
      if (location.hash.split("/")[1] !== "nova-senha" || t !== tokenSenha) return;
    }
    const conta = contaToken.email;
    // Logado em outra conta: o link não é desta pessoa (ou ela precisa sair antes). Nunca troca de conta sem ela ver.
    if (email && email !== conta) {
      casca(`<p class="ia-status" role="alert">Este link é da conta ${esc(conta)}, mas você está conectado como ${esc(email)}. Saia da conta para usar este link.</p>
        <button type="button" class="btn" id="sairParaLink" style="margin-top:12px">Sair e continuar</button>`);
      $("#sairParaLink").onclick = () => { const t = tokenSenha; sair(); tokenSenha = t; history.replaceState(null, "", location.pathname + "#/nova-senha"); render(); };
      return;
    }
    casca(`<p class="muted" style="margin-bottom:12px">Conta: <b>${esc(conta)}</b></p>
      <form novalidate id="novaForm">
        ${campoUsuario(conta)}
        ${campoSenha("nova1", "Nova senha", "new-password", "novaDica")}${campoSenha("nova2", "Repetir a nova senha", "new-password", "novaDica")}
        <p class="muted" id="novaDica" style="margin:-6px 0 10px">Pelo menos 6 caracteres.</p>
        ${mostrarSenhas("novaVer")}
        <p class="err" role="alert"></p>
        <button class="btn" type="submit">Salvar senha nova</button></form>`);
    ligarMostrar("novaVer", $("#novaForm"));
    $("#novaForm").onsubmit = async (ev) => {
      ev.preventDefault();
      const err = $("#novaForm .err"), a = $("#nova1").value, b = $("#nova2").value, botao = $("#novaForm .btn");
      if (a.length < 6) return erro(err, "A senha precisa ter pelo menos 6 caracteres.", $("#nova1"));
      if (a !== b) return erro(err, "As duas senhas não são iguais.", $("#nova2"));
      botao.disabled = true; botao.textContent = "Salvando…"; erro(err, "");
      let u;
      try { u = await api("senha_nova", { token: tokenSenha, senha: a }); }
      catch (e) {
        botao.disabled = false; botao.textContent = "Salvar senha nova";
        if (e.status === 400 && e.message === MSG_LINK_APP) { tokenSenha = ""; return viewNovaSenha("vencido"); }
        erro(err, e.status ? e.message : "Sem conexão com o servidor. Tente de novo."); return;
      }
      tokenSenha = "";
      if (u.semSessao) { toast(u.mensagem); history.replaceState(null, "", location.pathname + "#/"); loginMode = "entrar"; return render(); }
      await entrou(u);
      restoreSessao();
      toast(`Senha trocada. Você entrou como ${u.email}.`);
      history.replaceState(null, "", location.pathname + (data.plano ? "#/inicio" : "#/perfil")); // Voltar não leva à tela da senha
      render();
    };
  }

  function sair() {
    stopRest();
    sessao = null;
    api("sair").catch(() => {});
    store.del("mt_session");
    // O rascunho do formulário tem dados de saúde: não fica no aparelho depois de sair.
    try { Object.keys(localStorage).filter((k) => k.startsWith("fw_pedido_")).forEach((k) => store.del(k)); } catch (e) { /* sem armazenamento */ }
    email = null; data = null; rank = null; fotoUser = ""; adminUser = false; suporteAviso = false;
    location.hash = "";
    render();
  }

  // ---------- consulta periódica (suporte) ----------
  // Só com a aba visível; ao voltar para a aba, consulta na hora. Falhou: espera o dobro (até "max"), sem mostrar erro;
  // deu certo: volta para "base". Para sozinha quando ativo() fica falso (a pessoa saiu da tela) ou quando parar() é chamada.
  const consultas = new Set(); // as ativas; render() para todas ao trocar de tela (nenhum intervalo esquecido)
  function repetir(fn, { base, max = 60000, ativo }) {
    let atraso = base, timer = null, parado = false, rodando = false;
    const agendar = (ms) => { clearTimeout(timer); if (!parado) timer = setTimeout(rodar, ms); };
    async function rodar() {
      if (parado || rodando) return;
      if (!ativo()) return parar();
      if (document.hidden) return; // retoma pelo visibilitychange
      rodando = true;
      try { await fn(); atraso = base; } catch (e) { atraso = Math.min(atraso * 2, max); }
      rodando = false;
      agendar(atraso);
    }
    const voltou = () => { if (!document.hidden && !parado) { clearTimeout(timer); rodar(); } };
    function parar() { parado = true; clearTimeout(timer); document.removeEventListener("visibilitychange", voltou); consultas.delete(parar); }
    document.addEventListener("visibilitychange", voltou);
    consultas.add(parar);
    agendar(base);
    return parar;
  }

  // ---------- aviso de resposta no suporte (aba Perfil e card do Perfil) ----------
  const ponto = () => (suporteAviso ? `<i class="ponto" aria-hidden="true"></i>` : "");
  const pontoSr = () => (suporteAviso ? `<span class="sr"> (resposta nova no suporte)</span>` : "");
  function avisoSuporte(v) {
    suporteAviso = v === true;
    const a = document.querySelector("[data-aba-perfil]");
    if (a) { a.querySelectorAll(".ponto, .sr").forEach((x) => x.remove()); a.firstElementChild.insertAdjacentHTML("beforeend", ponto()); a.insertAdjacentHTML("beforeend", pontoSr()); }
    const c = document.querySelector("#supCard .sup-card-ponto");
    if (c) c.innerHTML = ponto() + pontoSr();
  }

  // ---------- estrutura ----------
  function shell(title, body, tab) {
    // O ponto na aba Perfil avisa resposta nova no suporte.
    const item = (href, ic, label, id) =>
      `<a href="${href}" class="${tab === id ? "on" : ""}" ${tab === id ? 'aria-current="page"' : ""} ${id === "perfil" ? "data-aba-perfil" : ""}><span>${icon(ic)}${id === "perfil" ? ponto() : ""}</span>${label}${id === "perfil" ? pontoSr() : ""}</a>`;
    app.classList.toggle("largo", tab === "admin"); // só o painel usa a tela larga no computador
    const eraTitulo = !!(document.activeElement && document.activeElement.matches && document.activeElement.matches(".topbar h1")); // "Carregando…" e depois a tela: o foco acompanha
    const trocouTela = shell.ultimo !== title || !app.querySelector(".topbar"); shell.ultimo = title;
    app.innerHTML = `
      <header class="topbar"><h1>${title}</h1></header>
      <main class="screen">${body}</main>
      <nav class="nav" aria-label="Principal">
        ${item("#/inicio", "home", "Início", "inicio")}
        ${plano() ? item("#/treinos", "gym", "Treinos", "treinos") : ""}
        ${item("#/ranking", "trophy", "Ranking", "ranking")}
        ${item("#/perfil", "user", "Perfil", "perfil")}
        ${adminUser ? item("#/admin", "shield", "Admin", "admin") : ""}
      </nav>`;
    // Tela nova: o foco vai para o título (o leitor de tela lê onde a pessoa está e o Tab segue dali). A tela pode mandar o foco para
    // um campo logo depois; repintar a mesma tela (mesmo título) não mexe no foco.
    if (trocouTela || eraTitulo) { const h = app.querySelector(".topbar h1"); h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }

  // ---------- telas baixadas só quando abertas: js/admin.js (só admin), js/pedido.js (formulário) e js/pagamento.js ----------
  const scripts = {};
  const carregar = (src) => scripts[src] ||= new Promise((ok, falhou) => {
    const el = document.createElement("script");
    el.src = src; el.onload = ok; el.onerror = () => { delete scripts[src]; falhou(); };
    document.head.appendChild(el);
  });
  function viewAdmin(arg) {
    shell("Admin", `<p class="muted" style="margin-top:16px">Carregando…</p>`, "admin");
    carregar("js/admin.js").then(
      () => { if (location.hash.split("/")[1] === "admin") window.FitWayAdmin.render(arg); },
      () => toast("Não consegui abrir o painel. Tente de novo."));
  }
  function viewPedido(tipo) {
    shell("Treino personalizado", `<p class="muted" style="margin-top:16px">Carregando…</p>`, "perfil");
    carregar("js/pedido.js").then(
      () => { if (location.hash.split("/")[1] === "pedido") window.FitWayPedido.render(tipo); },
      () => toast("Não consegui abrir o formulário. Tente de novo."));
  }
  function viewSuporte(arg) {
    shell("Ajuda e suporte", `<p class="muted" style="margin-top:16px">Carregando…</p>`, "perfil");
    carregar("js/suporte.js").then(
      () => {
        if (location.hash.split("/")[1] !== "suporte") return;
        let a = ""; try { a = arg ? decodeURIComponent(arg) : ""; } catch (e) { a = ""; }
        window.FitWaySuporte.render(a);
      },
      () => toast("Não consegui abrir o suporte. Tente de novo."));
  }
  function viewPagamento(id) {
    shell("Pagamento", `<p class="muted" style="margin-top:16px">Carregando…</p>`, "perfil");
    carregar("js/pagamento.js").then(
      () => { if (location.hash.split("/")[1] === "pagamento") window.FitWayPagamento.render(id); },
      () => toast("Não consegui abrir o pagamento. Tente de novo."));
  }
  // O painel, o formulário e o pagamento usam estas peças do app; ficam expostas só depois do login.
  const expor = () => { window.FitWay = { api, esc, toast, erro, icon, shell, $, pad, app, avisoSuporte, linkPrivacidade, repetir, get email() { return email; }, get nome() { return nomeUser; } }; };

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
  const treino = (id) => plano() && plano().treinos.find((t) => t.id === id);
  // "db:Nome" = fotos do free-exercise-db (domínio público) copiadas para img/ex/<Nome>/ por scripts/fotos-exercicios.mjs:
  // 0.webp e 1.webp (480 px) e t.webp (miniatura 96 px). "" = exercício sem imagem.
  const DB = "img/ex/";
  const SEM_FOTO = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 48 48"><path fill="#bdbdbd" d="${ICON.gym}"/></svg>`);
  const ehFoto = (nome) => nome.startsWith("db:");
  const gif = (nome, quadro) => ehFoto(nome) ? `${DB}${encodeURIComponent(nome.slice(3))}/${quadro ? 1 : 0}.webp` : SEM_FOTO;
  const thumb = (nome) => ehFoto(nome) ? `${DB}${encodeURIComponent(nome.slice(3))}/t.webp` : SEM_FOTO;
  let quadroTimer = null;
  let sessao = null; // { id, inicio, feitas: {idx: n}, aberta: idx, editando: bool }
  let restTimer = null, rest = 0, restEnd = 0, tickTimer = null;
  function restoreSessao() {
    const s = store.get(sessaoKey(), null);
    sessao = s && treino(s.id) && Number.isFinite(s.inicio) && s.feitas && typeof s.feitas === "object"
      ? { id: s.id, inicio: s.inicio, feitas: s.feitas, aberta: Number.isInteger(s.aberta) ? s.aberta : -1 } : null;
  }

  // Plano trocado por fora (IA pronta, renovação, vencimento): a sessão só continua se o treino dela existe no plano de agora e o plano é o mesmo.
  function trocouPlano(novo) {
    const antigo = data.plano;
    data.plano = novo;
    if (sessao && !(novo && antigo && novo.pedido === antigo.pedido && treino(sessao.id))) { stopRest(); sessao = null; saveSessao(); }
  }

  function ordem() {
    const i = Math.max(0, plano().treinos.findIndex((t) => t.id === data.proximo));
    return plano().treinos.slice(i).concat(plano().treinos.slice(0, i));
  }

  function viewTreinos() {
    const lista = ordem().map((t, i) => `
      <button class="wk ${i === 0 ? "next" : ""}" data-id="${esc(t.id)}">
        ${i === 0 ? '<span class="badge">Próximo</span>' : ""}
        <img class="thumb" src="${thumb(t.exercicios[0][1])}" alt="" width="46" height="46" loading="lazy">
        <span class="t"><b>${esc(t.nome)}</b><span class="muted">${t.exercicios.length} exercícios</span></span>
        <span class="play">${icon("play")}</span>
      </button>`).join("");
    shell("Treinos", `${guia()}
      <p class="label">Treinos</p>
      <section class="card">
        <div class="plan-head"><b style="font-weight:400">${esc(plano().nome)}</b></div>
        ${lista}
        <div class="progress"><span>${data.sessoes} sessões feitas</span></div>
      </section>`, "treinos");
    app.querySelectorAll(".wk").forEach((b) => b.onclick = () => (location.hash = "#/treino/" + b.dataset.id));
  }

  // Plano feito pela IA: explica as fases e destaca a da semana atual (contada desde plano.criado).
  function guia() {
    const g = plano().guia;
    if (!g) return "";
    const semana = Math.max(1, Math.floor((Date.now() - Date.parse(plano().criado)) / (7 * 864e5)) + 1);
    const faixa = (t) => { const n = (String(t).match(/\d+/g) || []).map(Number); return n.length ? [n[0], n[n.length - 1]] : [0, -1]; };
    const fases = (g.fases || []).map((f) => {
      const [a, b] = faixa(f.semanas), agora = semana >= a && semana <= b;
      return `<li class="${agora ? "agora" : ""}"><b>Semanas ${esc(f.semanas)}</b>${agora ? ' <span class="selo ok">Você está aqui</span>' : ""}<span class="muted">${esc(f.foco)}</span></li>`;
    }).join("");
    const parte = (t, v) => (v ? `<h3>${t}</h3><p>${esc(v)}</p>` : "");
    return `<section class="card guia">
      <h2>Como funciona seu plano</h2>
      <p class="muted">Semana ${Math.min(semana, 99)} de ${plano().semanas || 8}</p>
      <p>${esc(g.resumo)}</p>
      <ol class="fases">${fases}</ol>
      <details><summary>Progressão, cárdio e cuidados</summary>
        ${parte("Progressão", g.progressao)}${parte("Cárdio", g.cardio)}${parte("Cuidados", g.cuidados)}${parte("Avaliação das fotos", g.avaliacao_fotos)}
      </details>
    </section>`;
  }

  // Treino padrão: chave pelo GIF (como sempre foi). Treino do PDF: pelo nome, porque dois exercícios podem ter a mesma foto.
  const cargaKey = (t, i) => t.id + ":" + t.exercicios[i][0]; // pelo nome: dois exercícios podem ter a mesma foto
  const carga = (t, i) => {
    const v = data.cargas[cargaKey(t, i)];
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
    const idx = plano().treinos.indexOf(t);
    data.sessoes++;
    data.proximo = plano().treinos[(idx + 1) % plano().treinos.length].id;
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
    const idx = plano().treinos.indexOf(t), n = plano().treinos.length;
    const ant = plano().treinos[(idx + n - 1) % n].id, prox = plano().treinos[(idx + 1) % n].id;

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
          <img class="gif" src="${gif(g)}" ${ehFoto(g) ? `data-db="${esc(g)}"` : ""} alt="${g ? "Demonstração" : "Sem imagem"} do exercício ${esc(nome)}" width="240" height="240">
          <div class="sets">${pills}</div>
          <div class="tiles">
            <div class="tile">${icon("reps")}<span>Repetições</span><b>${/^\d/.test(reps) ? esc(reps) + "x" : esc(reps) || "—"}</b></div>
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

    const telaNova = shell.ultimo !== "treino:" + id; shell.ultimo = "treino:" + id; // só trocar de treino leva o foco; marcar série não
    app.innerHTML = `
      <header class="topbar center">
        <a class="icon-btn" href="#/treinos" aria-label="Voltar para a lista de treinos">${icon("back")}</a><h1>Treinos</h1>
      </header>
      <main class="screen treino">
        <div class="switch">
          <a class="icon-btn" href="#/treino/${esc(ant)}" aria-label="Treino anterior">${icon("back")}</a>
          <b>${esc(t.nome)}</b>
          <a class="icon-btn" href="#/treino/${esc(prox)}" aria-label="Próximo treino">${icon("next")}</a>
        </div>
        ${exs}
      </main>
      <div class="bottom"></div>`;
    paintBottom();
    if (telaNova) { const nome = app.querySelector(".switch b"); nome.tabIndex = -1; nome.focus({ preventScroll: true }); }
    // fotos do banco público: alterna os dois quadros para dar ideia do movimento
    clearInterval(quadroTimer);
    const foto = $("img[data-db]");
    if (foto) {
      let q = 0;
      quadroTimer = setInterval(() => {
        if (!foto.isConnected) return clearInterval(quadroTimer);
        q ^= 1; foto.src = gif(foto.dataset.db, q);
      }, 900);
    }

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
      data.cargas[cargaKey(t, sessao.aberta)] = v;
      save();
      sessao.editando = false;
      toast("Carga salva: " + v + "kg");
      rerender("[data-edit]");
    });
  }

  // ---------- perfil ----------
  let editandoPerfil = false, trocandoSenha = false, pararAviso = () => {};
  // repintura = true: Editar, Cancelar, Trocar senha... redesenham o Perfil com o pedido que já veio (nada de nova consulta).

  // Cartão do Perfil do admin: códigos de recuperação restantes e geração de novos (senha atual + código do app).
  function cartaoDoisFatores() {
    const poucos = dfRestantes !== null && dfRestantes <= 2;
    return `<section class="card" id="dfCard" aria-labelledby="dfCardTit">
      <h2 id="dfCardTit">Verificação em duas etapas</h2>
      <p class="muted" style="margin:6px 0 10px">Ativada. ${dfRestantes === null ? "Não consegui consultar os códigos de recuperação." : `Códigos de recuperação: <strong>Restam ${dfRestantes}</strong>.`}</p>
      ${poucos ? `<p class="ia-status erro" role="status">Restam poucos códigos de recuperação. Gere novos.</p>` : ""}
      ${dfNovos ? `<h3 id="dfCodTit" tabindex="-1" class="df-sub">Códigos novos (os antigos deixaram de valer)</h3><p class="muted">Guarde agora: eles não aparecem de novo.</p>${htmlCodigos(dfNovos)}` : ""}
      ${dfGerando ? `<form id="dfNovosForm" novalidate aria-labelledby="dfNovosTit">
          <h3 id="dfNovosTit" class="df-sub">Gerar novos códigos</h3>
          ${campoUsuario(email)}
          ${campoSenha("dfSenha", "Senha atual", "current-password")}
          <div class="field"><label for="dfCodNovo">Código do app autenticador</label>
            <input id="dfCodNovo" autocomplete="one-time-code" inputmode="numeric" maxlength="7" required aria-describedby="dfNovosDica"></div>
          <p class="muted" id="dfNovosDica" style="margin:-6px 0 10px">Se o código acabou de ser usado no login, espere o próximo (30 segundos).</p>
          <p class="err" role="alert"></p>
          <button class="btn" type="submit">Gerar novos códigos</button>
          <div class="tools"><button type="button" id="dfCancelar">Cancelar</button></div>
        </form>` : ""}
      <div class="tools"><button type="button" id="dfNovos" aria-expanded="${dfGerando}" aria-controls="dfNovosForm">${icon("shield")}Gerar novos códigos</button></div>
    </section>`;
  }
  function ligarDoisFatores() {
    $("#dfNovos").onclick = () => { dfGerando = !dfGerando; viewPerfil(true); (dfGerando ? $("#dfSenha") : $("#dfNovos")).focus(); };
    const f = $("#dfNovosForm");
    if (!f) return;
    $("#dfCancelar").onclick = () => { dfGerando = false; viewPerfil(true); $("#dfNovos").focus(); };
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const err = f.querySelector(".err"), senha = $("#dfSenha").value, cod = $("#dfCodNovo").value.trim(), botao = f.querySelector(".btn");
      if (!senha) return erro(err, "Digite a senha atual.", $("#dfSenha"));
      if (!cod) return erro(err, "Digite o código do app autenticador.", $("#dfCodNovo"));
      botao.disabled = true; erro(err, "");
      try { const r = await api("admin_2fa_codigos", { senha, codigo: cod }); dfNovos = r.recuperacao; dfRestantes = r.restantes; }
      catch (e) { botao.disabled = false; return erro(err, e.status ? e.message : "Sem conexão com o servidor. Tente de novo."); }
      dfGerando = false; viewPerfil(true); $("#dfCodTit").focus();
    };
  }
  function viewPerfil(repintura = false) {
    if (!repintura) { dfNovos = null; dfGerando = false; } // códigos novos só ficam na tela enquanto a pessoa não sai do Perfil
    if (adminUser && dfRestantes === null && !repintura) api("admin_2fa_estado").then((r) => { dfRestantes = r.restantes; if (location.hash.split("/")[1] === "perfil" && !editandoPerfil) viewPerfil(true); }, () => {});
    const u = { nome: nomeUser };
    shell("Perfil", `
      <section class="card profile">
        ${fotoUser ? `<img class="avatar" src="${esc(fotoUser)}" alt="Sua foto de perfil" width="96" height="96">`
          : `<div class="avatar" aria-hidden="true">${esc((u.nome || "?").charAt(0).toUpperCase())}</div>`}
        <input type="file" id="fotoArq" accept="image/*" hidden>
        ${editandoPerfil ? `<div class="tools foto-tools"><button type="button" id="trocarFoto">${icon("user")}${fotoUser ? "Trocar foto" : "Adicionar foto"}</button>
            ${fotoUser ? `<button type="button" id="tirarFoto">${icon("user")}Remover foto</button>` : ""}</div>
          <form novalidate style="text-align:left">
            <div class="field"><label for="nome">Nome</label><input id="nome" autocomplete="given-name" maxlength="40" value="${esc(u.nome)}" required></div>
            <p class="err" role="alert"></p>
            <button class="btn" type="submit">Salvar</button>
            <div class="tools"><button type="button" id="cancelar">Cancelar</button></div>
          </form>` : `<h2>${esc(u.nome)}</h2>`}
        <p class="muted" ${editandoPerfil ? 'style="margin-top:10px"' : ""}>${esc(email)}</p>
        ${editandoPerfil ? "" : `<div class="tools"><button id="editar">${icon("edit")}Editar perfil</button><button id="trocarSenha" aria-expanded="${trocandoSenha}" aria-controls="senhaForm">${icon("shield")}Trocar senha</button></div>`}
      </section>
      ${trocandoSenha && !editandoPerfil ? `<form class="card" id="senhaForm" novalidate aria-labelledby="senhaTit">
        <h2 id="senhaTit" tabindex="-1">Trocar senha</h2>
        ${campoUsuario(email)}
        ${campoSenha("senhaAtual", "Senha atual", "current-password")}${campoSenha("senhaNova1", "Nova senha", "new-password", "senhaDica")}${campoSenha("senhaNova2", "Repetir a nova senha", "new-password", "senhaDica")}
        <p class="muted" id="senhaDica" style="margin:-6px 0 10px">Pelo menos 6 caracteres. Os outros aparelhos conectados nesta conta serão desconectados.</p>
        ${mostrarSenhas("senhaVer")}
        <p class="err" role="alert"></p>
        <button class="btn" type="submit">Salvar nova senha</button>
        <div class="tools"><button type="button" id="senhaCancelar">Cancelar</button></div>
      </form>` : ""}
      ${adminUser && !editandoPerfil ? cartaoDoisFatores() : ""}
      <section class="card">
        <div class="row"><span>Plano</span><span>${plano() ? esc(plano().nome) : "Nenhum"}</span></div>
        <div class="row"><span>Sessões feitas</span><span>${data.sessoes}</span></div>
        <div class="row"><span>Check-ins</span><span>${data.checkins.length}</span></div>
      </section>
      <section class="card ia" id="ia" aria-live="polite" ${ia && !ia.ativo && !ia.temPlanoIA && !ia.pedido ? "hidden" : ""}>${pintarIA()}</section>
      <section class="card">
        <h2>Meu treino</h2>
        <p class="muted" style="margin:6px 0 12px">${data.plano ? "Para trocar de treino, envie outro PDF." : "Envie o PDF do seu treino para liberar a aba Treinos."} O site lê os exercícios, as séries e as repetições e escolhe a foto de cada exercício.</p>
        <input type="file" id="pdf" accept="application/pdf,.pdf" hidden>
        <p class="err" role="alert" id="pdfErr"></p>
        <button class="btn" id="enviarPdf">${data.plano ? "Trocar PDF do treino" : "Enviar PDF do treino"}</button>
        ${data.plano ? `<div class="tools"><button id="removerTreino">Remover treino</button></div>` : ""}
      </section>
      <a class="card sup-card" id="supCard" href="#/suporte"><span class="sup-card-ic">${icon("help")}</span>
        <span class="sup-card-t"><b>Ajuda e suporte</b><span class="muted">Fale com a gente sobre pagamento, treino, conta ou o app.</span></span>
        <span class="sup-card-ponto">${ponto()}${pontoSr()}</span></a>
      <button class="btn" id="sair" style="margin-top:16px">Sair</button>
      <p class="muted login-links"><a href="#/privacidade">Política de privacidade</a></p>`, "perfil");
    $("#sair").onclick = sair;
    ligarIA();
    atualizarIA(repintura);
    // Resposta nova no suporte enquanto o Perfil está aberto: o ponto aparece em até 30 s.
    pararAviso();
    pararAviso = repetir(async () => { const r = await api("suporte_aviso"); if (r.naoLido !== suporteAviso) avisoSuporte(r.naoLido); },
      { base: 30000, ativo: () => !!email && location.hash.split("/")[1] === "perfil" });
    const pdfErr = $("#pdfErr"), enviar = $("#enviarPdf");
    // O treino feito pela IA é pago: substituir por PDF ou remover pede confirmação (vale também se ele está escondido por acesso vencido).
    const temIA = () => (ia && ia.temPlanoIA) || (data.plano && data.plano.origem === "ia");
    const AVISO_IA = "Você tem um treino personalizado pago. Ele será apagado e substituído, e a mensalidade deixa de valer para ele. Continuar?";
    const trocarPlano = async (corpo) => {
      if (sessao && sessao.inicio && !confirm("Há um treino em andamento. Trocar de plano descarta o progresso dele. Continuar?")) return;
      enviar.disabled = true;
      enviar.textContent = "Aguarde…";
      pdfErr.textContent = "";
      try { loadData((await api("treino", { ...corpo, dados: data })).dados); store.del(dataKey()); }
      catch (e) {
        enviar.disabled = false;
        enviar.textContent = "Enviar PDF do treino";
        return (pdfErr.textContent = e.status ? e.message : "Sem conexão com o servidor. Tente de novo.");
      }
      stopRest(); sessao = null; saveSessao();
      const ex = data.plano ? data.plano.treinos.flatMap((t) => t.exercicios) : [], sem = ex.filter((e) => !e[1]).length;
      toast(data.plano ? `Treino carregado: ${data.plano.treinos.length} treinos, ${ex.length} exercícios${sem ? `, ${sem} sem foto` : ""}.` : "Treino removido.");
      render(); // redesenha a tela em que a pessoa estiver, que pode ter mudado durante o envio
    };
    enviar.onclick = () => { if (!temIA() || confirm(AVISO_IA)) $("#pdf").click(); };
    if (data.plano) $("#removerTreino").onclick = () => {
      if (confirm(temIA() ? AVISO_IA.replace(" e substituído", "") : "Remover o treino da sua conta? A aba Treinos some até você enviar outro PDF.")) trocarPlano({ remover: true });
    };
    $("#pdf").onchange = (ev) => {
      const f = ev.target.files[0];
      ev.target.value = ""; // permite escolher o mesmo arquivo de novo depois de um erro
      if (!f || !f.size) return;
      if (f.size > 3e6) return erro(pdfErr, "O PDF precisa ter no máximo 3 MB.", $("#pdf"));
      const fr = new FileReader();
      fr.onload = () => trocarPlano({ pdf: String(fr.result).split(",")[1] });
      fr.onerror = () => (pdfErr.textContent = "Não consegui ler o arquivo.");
      fr.readAsDataURL(f);
    };
    if (!editandoPerfil) {
      if (adminUser) ligarDoisFatores();
      $("#editar").onclick = () => { editandoPerfil = true; trocandoSenha = false; viewPerfil(true); $("#nome").focus(); };
      $("#trocarSenha").onclick = () => { trocandoSenha = !trocandoSenha; viewPerfil(true); (trocandoSenha ? $("#senhaAtual") : $("#trocarSenha")).focus(); };
      const sf = $("#senhaForm");
      if (sf) {
        $("#senhaCancelar").onclick = () => { trocandoSenha = false; viewPerfil(true); $("#trocarSenha").focus(); };
        ligarMostrar("senhaVer", sf);
        sf.onsubmit = async (ev) => {
          ev.preventDefault();
          const err = sf.querySelector(".err"), atual = $("#senhaAtual").value, a = $("#senhaNova1").value, b = $("#senhaNova2").value, botao = sf.querySelector(".btn");
          if (!atual) return erro(err, "Digite a senha atual.", $("#senhaAtual"));
          if (a.length < 6) return erro(err, "A senha precisa ter pelo menos 6 caracteres.", $("#senhaNova1"));
          if (a !== b) return erro(err, "As duas senhas não são iguais.", $("#senhaNova2"));
          botao.disabled = true; botao.textContent = "Salvando…"; erro(err, "");
          try { await api("senha_alterar", { atual, nova: a }); }
          catch (e) { botao.disabled = false; botao.textContent = "Salvar nova senha"; erro(err, e.status ? e.message : "Sem conexão com o servidor. Tente de novo."); return; }
          trocandoSenha = false;
          toast("Senha trocada. Os outros aparelhos foram desconectados.");
          if (location.hash.split("/")[1] === "perfil") { viewPerfil(true); $("#trocarSenha").focus(); }
        };
      }
      return;
    }
    // Depois de mudar a foto: avisa e redesenha o Perfil mantendo o nome que estava sendo digitado.
    const fotoMudou = (msg) => {
      toast(msg);
      if (location.hash.split("/")[1] !== "perfil" || !editandoPerfil) return;
      const nome = $("#nome").value;
      viewPerfil(true); $("#nome").value = nome; $("#trocarFoto").focus();
    };
    const removerFoto = async () => {
      try { fotoUser = (await api("foto", { foto: "" })).foto; }
      catch (e) { return toast(e.status ? e.message : "Sem conexão com o servidor. Tente de novo."); }
      fotoMudou("Foto removida.");
    };
    $("#trocarFoto").onclick = () => $("#fotoArq").click();
    // A foto escolhida abre o recorte (js/recorte.js, baixado agora): nada é enviado antes de "Salvar".
    $("#fotoArq").onchange = async (ev) => {
      const f = ev.target.files[0];
      ev.target.value = "";
      if (!f) return;
      try { await carregar("js/recorte.js"); } catch (e) { return toast("Não consegui abrir o editor de foto. Verifique a conexão e tente de novo."); }
      const salvou = await window.FitWayRecorte.abrir(f, {
        voltarFoco: $("#trocarFoto"), aviso: toast,
        salvar: async (foto) => { fotoUser = (await api("foto", { foto })).foto; },
      });
      if (salvou) fotoMudou("Foto atualizada.");
    };
    if (fotoUser) $("#tirarFoto").onclick = () => { if (confirm("Remover sua foto de perfil?")) removerFoto(); };
    const fechar = () => { editandoPerfil = false; viewPerfil(true); $("#editar").focus(); };
    $("#cancelar").onclick = fechar;
    $("form").onsubmit = async (ev) => {
      ev.preventDefault();
      const err = $(".err"), botao = $("form .btn"), nome = $("#nome").value.trim();
      if (!nome) return erro(err, "Digite seu nome.", $("#nome"));
      botao.disabled = true;
      erro(err, "");
      try { nomeUser = (await api("perfil", { nome })).nome; }
      catch (e) {
        botao.disabled = false;
        return erro(err, e.status ? e.message : "Sem conexão com o servidor. Tente de novo.");
      }
      toast("Nome atualizado.");
      if (location.hash.split("/")[1] === "perfil") fechar(); else editandoPerfil = false;
    };
  }

  // ---------- treino personalizado (IA): estado do acesso e do pedido no Perfil ----------
  let ia = null, iaTimer = null;
  const reais = (c) => "R$ " + (c / 100).toFixed(2).replace(".", ",");
  const diaMes = (iso) => new Date(new Date(iso) - 1).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const NOME_PEDIDO = { inicial: "Treino personalizado", mensalidade: "Renovação do acesso", novo_treino: "Novo treino" };
  function pintarIA() {
    let h = `<h2>Treino personalizado</h2>`;
    if (!ia) return h + `<p class="muted">Carregando…</p>`;
    const p = ia.pedido, agora = Date.now();
    const botao = (tipo, txt) => `<button class="btn" data-pedir="${tipo}">${txt} — ${reais(ia.precos[tipo])}</button>`;
    if (p && p.status === "aguardando_pagamento") {
      h += `<p class="ia-status">${NOME_PEDIDO[p.tipo]} — ${reais(p.valor)}</p>
        <p class="muted" style="margin-bottom:10px">Aguardando pagamento. Assim que ele for confirmado, ${p.tipo === "mensalidade" ? "seu acesso é renovado" : "seu treino começa a ser montado"}.</p>
        <a class="btn pag-link" href="#/pagamento/${encodeURIComponent(p.id)}">Pagar</a>`;
    } else if (p && p.status === "aguardando_confirmacao") {
      h += `<p class="ia-status">${NOME_PEDIDO[p.tipo]} — ${reais(p.valor)}</p>
        <p class="muted">Seu pedido está em análise.</p>`; // Pix manual antigo
    } else if (p && (p.status === "pago" || p.status === "gerando")) {
      h += `<p class="ia-status">Gerando seu treino…</p>
        <p class="muted">Isso leva até 1 minuto. Pode sair desta tela: o treino aparece na aba Treinos quando ficar pronto.</p>`;
    } else if (p && p.status === "erro") {
      // Sem botões: o pedido já foi pago, o admin gera de novo sem novo pagamento.
      h += `<p class="ia-status erro">Não conseguimos montar seu treino.</p>
        <p class="muted">Já estamos vendo o problema e vamos gerar de novo, sem novo pagamento.</p>`;
    } else {
      if (p && p.status === "pronto" && p.tipo !== "mensalidade" && ia.plano && agora - Date.parse(p.gerado_em) < 7 * 864e5)
        h += `<p class="ia-status ok">Seu treino está pronto. <a href="#/treinos">Ver na aba Treinos</a></p>`;
      if (!ia.temPlanoIA) {
        h += `<p class="muted" style="margin:6px 0 12px">Um plano de 8 semanas montado para o seu objetivo, sua rotina e sua saúde, com 30 dias de acesso.</p>`;
        if (ia.pode.inicial) h += botao("inicial", "Solicitar meu treino personalizado");
      } else {
        const ate = ia.acessoAte ? Date.parse(ia.acessoAte) : 0;
        if (ate > agora) {
          h += `<p class="ia-status ok">Treino ativo até ${diaMes(ia.acessoAte)}</p>`;
          if (ia.pode.mensalidade && ate - agora <= 5 * 864e5) h += botao("mensalidade", "Renovar acesso");
        } else {
          h += `<p class="ia-status">${ate ? `Seu acesso venceu em ${diaMes(ia.acessoAte)}.` : "Seu acesso não está ativo."} Renove para voltar a ver seu treino.</p>`;
          if (ia.pode.mensalidade) h += botao("mensalidade", "Renovar acesso");
        }
        if (ia.pode.novo_treino) h += `<div style="margin-top:8px">${botao("novo_treino", "Pedir um novo treino")}</div>`;
      }
    }
    return h + (ia.ativo ? `<p class="ia-termo"><a href="#/termo">Termo de Responsabilidade e Uso</a></p>` : ""); // desligada: o termo não é público
  }
  function ligarIA() {
    app.querySelectorAll("[data-pedir]").forEach((b) => b.onclick = async () => {
      const tipo = b.dataset.pedir;
      if (tipo !== "mensalidade") return (location.hash = "#/pedido/" + tipo);
      if (!confirm(`Pedir a renovação do acesso (${reais(ia.precos.mensalidade)})? Em seguida você vai para o pagamento.`)) return;
      b.disabled = true;
      try { const r = await api("pedido_criar", { tipo }); location.hash = "#/pagamento/" + encodeURIComponent(r.pedido.id); return; }
      catch (e) { toast(e.status ? e.message : "Sem conexão com o servidor. Tente de novo."); }
      atualizarIA();
    });
  }
  // Consulta o pedido; enquanto ele está pago ou gerando, de novo a cada 4 s (só nesta tela). Essas repetições são polls leves
  // (só o status); a resposta completa, com o plano, vem na primeira consulta e uma vez quando o pedido deixa de esperar.
  async function atualizarIA(doCache = false, poll = false) {
    clearTimeout(iaTimer);
    const outra = () => setTimeout(() => atualizarIA(false, true), 4000);
    if (document.hidden && ia) { iaTimer = outra(); return; } // aba escondida: não consulta
    if (!(doCache && ia)) {
      let r;
      try { r = await api("pedido_status", poll ? { poll: true } : undefined); } catch (e) { if (e.status === 401) return; }
      if (r && r.poll) { // só o status: o resto da tela continua como está
        if (location.hash.split("/")[1] !== "perfil" || !$("#ia") || !ia || !ia.pedido) return;
        if (r.pedido.status !== ia.pedido.status) { ia.pedido.status = r.pedido.status; $("#ia").innerHTML = pintarIA(); ligarIA(); }
        iaTimer = outra();
        return;
      }
      if (r) ia = r; // sem conexão: segue com o que já havia
    }
    if (ia && typeof ia.suporteNaoLido === "boolean" && ia.suporteNaoLido !== suporteAviso) avisoSuporte(ia.suporteNaoLido);
    if (location.hash.split("/")[1] !== "perfil" || !$("#ia")) return;
    if (ia && JSON.stringify(data.plano) !== JSON.stringify(ia.plano)) { // treino pronto, acesso renovado ou vencido
      if (ia.plano && (!data.plano || data.plano.pedido !== ia.plano.pedido)) data.proximo = ia.plano.treinos[0].id; // plano novo começa no 1º treino
      trocouPlano(ia.plano);
      return render();
    }
    if (!ia) { $("#ia").innerHTML = `<h2>Treino personalizado</h2><p class="err">Sem conexão com o servidor.</p>`; return; }
    $("#ia").innerHTML = pintarIA();
    $("#ia").hidden = !ia.ativo && !ia.temPlanoIA && !ia.pedido; // função desligada (TREINO_IA_ATIVO) e nada de IA nesta conta
    ligarIA();
    if (ia.pedido && (ia.pedido.status === "pago" || ia.pedido.status === "gerando")) iaTimer = outra();
  }

  // ---------- política de privacidade (pública: abre também sem login) ----------
  // O texto já escapado ganha o link na expressão fixa (usado também no termo).
  const linkPrivacidade = (h, alvo = "") => h.replace(/Política de privacidade/g, `<a href="#/privacidade"${alvo}>Política de privacidade${alvo ? '<span class="sr"> (abre em nova aba)</span>' : ""}</a>`);
  async function viewPrivacidade() {
    const tela = (corpo) => {
      const voltar = email ? `<a class="adm-voltar" href="#/perfil">${icon("back")}Perfil</a>` : `<a class="adm-voltar" href="#/">${icon("back")}Entrar</a>`;
      const h = email ? "h2" : "h1"; // sem login, a página não tem outro título
      const html = `${voltar}<section class="card"><${h} id="privTit" class="priv-tit" tabindex="-1">Política de privacidade</${h}>${corpo}</section>`;
      if (email) shell("Privacidade", html, "perfil"); else app.innerHTML = `<main class="login privacidade">${html}</main>`;
    };
    tela(`<p class="muted" style="margin-top:12px">Carregando…</p>`);
    let t = null, erro = "";
    try { t = await api("privacidade"); } catch (e) { erro = e.status ? e.message : "Sem conexão com o servidor. Tente de novo."; }
    if (location.hash.split("/")[1] !== "privacidade") return;
    tela(t ? `<p class="muted">Versão de ${esc(t.versao.slice(8, 10) + "/" + t.versao.slice(5, 7) + "/" + t.versao.slice(0, 4))}</p><div class="termo-texto">${esc(t.texto)}</div>`
      : `<div class="adm-estado" role="alert"><p>${esc(erro)}</p><button class="btn-sec" id="privTentar">Tentar de novo</button></div>`);
    if ($("#privTentar")) $("#privTentar").onclick = viewPrivacidade;
    $("#privTit").focus();
  }

  // ---------- termo de responsabilidade (texto atual, vindo do servidor) ----------
  async function viewTermo() {
    shell("Termo", `<p class="muted" style="margin-top:16px">Carregando…</p>`, "perfil");
    let t = null, erro = "";
    try { t = await api("termo"); } catch (e) { erro = e.status ? e.message : "Sem conexão com o servidor. Tente de novo."; }
    if (location.hash.split("/")[1] !== "termo") return;
    shell("Termo", `<a class="adm-voltar" href="#/perfil">${icon("back")}Perfil</a>
      <section class="card">${t ? `<p class="muted">Versão ${esc(t.versao)}</p><div class="termo-texto">${linkPrivacidade(esc(t.texto))}</div>`
        : `<p class="err" role="alert">${esc(erro)}</p>`}</section>`, "perfil");
  }

  // ---------- ranking: grupo de amigos que compara check-ins ----------
  let rank = null, rankModo = "semana";
  async function viewRanking(op) {
    if (rank && !op) paintRanking();
    else if (!rank) shell("Ranking", `<p class="muted" style="margin-top:16px">Carregando…</p>`, "ranking");
    const t = today();
    let erro = "";
    try { rank = await api("ranking", { ...op, semana: dayKey(addDays(t, -t.getDay())), mes: dayKey(t).slice(0, 8) + "01" }); }
    catch (e) { erro = e.status ? e.message : "Sem conexão com o servidor. Tente de novo."; }
    if (location.hash.split("/")[1] !== "ranking") return;
    if (!rank) return shell("Ranking", `<p class="err" role="alert" style="margin-top:16px">${esc(erro)}</p>`, "ranking");
    paintRanking();
    if (erro) { const e = $(".err"); if (e) e.textContent = erro; else toast(erro); }
  }
  function paintRanking() {
    if (!rank.codigo) {
      shell("Ranking", `
        <section class="card">
          <h2>Desafio de check-ins</h2>
          <p class="muted" style="margin:6px 0 12px">Crie um grupo e mande o código para seus amigos, ou entre no grupo de alguém. Quem está no grupo vê o nome e o número de check-ins dos outros na semana e no mês.</p>
          <button class="btn" id="criar">Criar grupo</button>
        </section>
        <section class="card">
          <form novalidate>
            <div class="field"><label for="codigo">Código do grupo</label><input id="codigo" maxlength="6" autocomplete="off" autocapitalize="characters" required></div>
            <p class="err" role="alert"></p>
            <button class="btn" type="submit">Entrar no grupo</button>
          </form>
        </section>`, "ranking");
      $("#criar").onclick = (ev) => { ev.currentTarget.disabled = true; viewRanking({ op: "criar" }); };
      $("form").onsubmit = (ev) => {
        ev.preventDefault();
        const codigo = $("#codigo").value.trim().toUpperCase();
        if (codigo.length !== 6) return erro($(".err"), "O código tem 6 letras ou números.", $("#codigo"));
        viewRanking({ op: "entrar", codigo });
      };
      return;
    }
    const lista = rank.membros.slice().sort((a, b) => b[rankModo] - a[rankModo] || a.nome.localeCompare(b.nome));
    shell("Ranking", `
      <section class="card">
        <div class="chart-head">
          <h2>Check-ins do grupo</h2>
          <div class="seg">
            <button data-r="semana" class="${rankModo === "semana" ? "on" : ""}" aria-pressed="${rankModo === "semana"}">Semana</button>
            <button data-r="mes" class="${rankModo === "mes" ? "on" : ""}" aria-pressed="${rankModo === "mes"}">Mês</button>
          </div>
        </div>
        ${lista.map((m, i) => `<div class="row"><span>${i + 1}º ${i === 0 && m[rankModo] > 0 ? "🏆 " : ""}${esc(m.nome)}${m.eu ? " (você)" : ""}</span><b>${m[rankModo]}</b></div>`).join("")}
        <p class="muted" style="margin-top:10px">${rankModo === "semana" ? "Dias com check-in nesta semana, contando a partir de domingo." : "Dias com check-in neste mês."}</p>
      </section>
      <section class="card">
        <div class="row"><span>Código do grupo</span><b id="cod">${esc(rank.codigo)}</b></div>
        <p class="muted" style="margin-top:10px">Mande este código para quem você quer no grupo.</p>
        <div class="tools"><button id="copiar">Copiar código</button><button id="sairGrupo">Sair do grupo</button></div>
      </section>`, "ranking");
    app.querySelectorAll("[data-r]").forEach((b) => b.onclick = () => { rankModo = b.dataset.r; paintRanking(); $(`[data-r="${rankModo}"]`).focus(); });
    $("#copiar").onclick = () => navigator.clipboard.writeText(rank.codigo).then(() => toast("Código copiado."), () => toast("Não consegui copiar. O código é " + rank.codigo));
    $("#sairGrupo").onclick = () => { if (confirm("Sair do grupo? Você pode voltar com o mesmo código enquanto alguém continuar nele.")) viewRanking({ op: "sair" }); };
  }

  // ---------- rotas ----------
  function render() {
    tirarToken();
    consultas.forEach((p) => p());
    clearInterval(tickTimer);
    clearTimeout(iaTimer);
    const [, rota, arg] = location.hash.split("/");
    editandoPerfil = false; trocandoSenha = false;
    if (rota !== "treino") stopRest();
    if (rota === "privacidade") { window.scrollTo(0, 0); return viewPrivacidade(); } // pública
    if (rota === "nova-senha") { window.scrollTo(0, 0); return viewNovaSenha(); } // pública
    if (!email) return viewLogin();
    if (!plano() && (rota === "treinos" || rota === "treino")) { location.hash = "#/perfil"; return; }
    if (rota === "treinos") viewTreinos();
    else if (rota === "treino") {
      viewTreino(arg);
      tickTimer = setInterval(() => { if (!document.hidden && sessao && sessao.inicio && rest === 0) paintBottom(); }, 1000);
    }
    else if (rota === "perfil") viewPerfil();
    else if (rota === "ranking") viewRanking();
    else if (rota === "admin" && adminUser) { expor(); viewAdmin(arg); }
    else if (rota === "pedido") { expor(); viewPedido(arg); }
    else if (rota === "pagamento") { expor(); viewPagamento(arg); }
    else if (rota === "suporte") { expor(); viewSuporte(arg); }
    else if (rota === "termo") viewTermo();
    else viewInicio();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", render);
  // volta do segundo plano: acerta o cronômetro e vira o dia na tela inicial
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !email) return;
    tickRest();
    const rota = location.hash.split("/")[1];
    if (!["treino", "treinos", "perfil", "ranking", "admin", "pedido", "pagamento", "termo", "privacidade", "suporte", "nova-senha"].includes(rota) && diaRender !== dayKey(today())) render();
  });
  // outra aba entrou ou saiu da conta
  window.addEventListener("storage", (ev) => { if (ev.key === "mt_session") location.reload(); });
  // Link de troca de senha aberto na carga da página: o token sai do endereço antes da primeira requisição.
  tirarToken();
  // Volta do checkout do InfinitePay (Pix ou cartão): guarda o retorno, limpa a URL e abre o pagamento, que confere.
  (() => {
    const q = new URLSearchParams(location.search), o = q.get("order_nsu"), t = q.get("transaction_nsu"), s = q.get("slug");
    if (!q.toString()) return;
    if (o && t && s && /^[A-Za-z0-9_-]{1,40}$/.test(o)) {
      try { sessionStorage.setItem("fw_pag_" + o, JSON.stringify({ transaction_nsu: t, slug: s, novo: true })); } catch (e) { /* sem armazenamento */ }
      history.replaceState(null, "", location.pathname + "#/pagamento/" + o);
    } else history.replaceState(null, "", location.pathname + location.hash);
  })();
  // o cookie de sessão é HttpOnly: só o servidor sabe dizer se há alguém logado
  (async () => {
    try { await entrou(await api("eu")); }
    catch (e) { if (e.status !== 401) toast("Sem conexão com o servidor."); }
    if (email) restoreSessao();
    render();
  })();
})();
