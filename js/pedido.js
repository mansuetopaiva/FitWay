/* FitWay — formulário do treino personalizado. Baixado só quando a pessoa abre o pedido.
   As perguntas, opções e limites vêm do servidor (pedido_status com form), que confere tudo de novo no envio. */
(function () {
  "use strict";
  const { api, esc, toast, shell, $, app } = window.FitWay;
  const ETAPAS = ["Você", "Rotina", "Saúde", "Fotos", "Observações", "Resumo"];
  const FOTOS = [["frente", "Frente"], ["costas", "Costas"], ["direito", "Perfil direito"], ["esquerdo", "Perfil esquerdo"]];
  const TEXTOS = [["lesoes", "Lesões ou dores"], ["cirurgias", "Cirurgias"], ["doencas", "Problemas de saúde"],
    ["remedios", "Remédios em uso"], ["evitar", "Exercícios que você não pode ou não quer fazer"]];
  const reais = (c) => "R$ " + (c / 100).toFixed(2).replace(".", ",");
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* sem armazenamento */ } },
  };

  let tipo, st, termo, f, fotos, etapa, chave, enviando = false;
  const lendo = {}; // por posição: número da leitura de foto mais recente; trocar de etapa invalida as que ainda estão lendo

  async function render(t) {
    tipo = t === "novo_treino" ? "novo_treino" : "inicial";
    shell("Treino personalizado", `<p class="muted" style="margin-top:16px">Carregando…</p>`, "perfil");
    // Primeiro confere se o pedido está liberado; o termo só é lido depois (com a função desligada, ele não é público).
    try { st = await api("pedido_status", { form: true }); if (st.pode[tipo]) termo = await api("termo"); }
    catch (e) { return shell("Treino personalizado", `<p class="err" role="alert" style="margin-top:16px">${esc(e.message)}</p><a class="btn-sec" href="#/perfil">Voltar ao perfil</a>`, "perfil"); }
    if (location.hash.split("/")[1] !== "pedido") return;
    if (!st.pode[tipo]) { toast(st.pedido && ["aguardando_pagamento", "aguardando_confirmacao", "pago", "gerando"].includes(st.pedido.status) ? "Você já tem um pedido em andamento." : "Este pedido não está disponível agora."); location.hash = "#/perfil"; return; }
    chave = "fw_pedido_" + tipo + "_" + (window.FitWay.email || "");
    const rasc = store.get(chave);
    // Rascunho sem fotos; no novo treino, começa com as últimas respostas. Os consentimentos são sempre marcados de novo.
    f = Object.assign({ parq: Array(st.form.parq.length).fill(null), liberacao: false }, tipo === "novo_treino" ? st.ultimas || {} : {}, rasc && rasc.f || {});
    f.consentimentos = { dados: false, fotos: false }; f.termo = false;
    f.objetivo = f.objetivo ? [].concat(f.objetivo) : []; // pedido e rascunho antigos guardavam um texto só
    fotos = {};
    etapa = rasc && Number.isInteger(rasc.etapa) ? Math.min(rasc.etapa, 4) : 0;
    pintar();
  }
  const guardar = () => { const { consentimentos, termo: _t, ...resto } = f; store.set(chave, { f: resto, etapa }); };

  const radios = (nome, legenda, ops, rotulo = (o) => o) => `<fieldset class="ped-grupo"><legend>${legenda}</legend><div class="ped-ops">
    ${ops.map((o) => `<label><input type="radio" name="${nome}" value="${esc(o)}" ${f[nome] === o ? "checked" : ""}><span>${esc(rotulo(o))}</span></label>`).join("")}</div></fieldset>`;
  const marcas = (nome, legenda, ops) => `<fieldset class="ped-grupo"><legend>${legenda}</legend><div class="ped-ops">
    ${ops.map((o) => `<label><input type="checkbox" name="${nome}" value="${esc(o)}" ${f[nome].includes(o) ? "checked" : ""}><span>${esc(o)}</span></label>`).join("")}</div></fieldset>`;
  const numero = (k, rot, min, max, passo = 1) => `<div class="field"><label for="p_${k}">${rot}</label>
    <input id="p_${k}" name="${k}" type="number" inputmode="${passo < 1 ? "decimal" : "numeric"}" min="${min}" max="${max}" step="${passo}" value="${f[k] ?? ""}"></div>`;
  const caixa = (k, texto, marcado) => `<label class="ped-caixa"><input type="checkbox" name="${k}" ${marcado ? "checked" : ""}><span>${texto}</span></label>`;

  function corpo() {
    const o = st.form.opcoes;
    if (etapa === 0) return marcas("objetivo", "Objetivo <span class=\"muted\">(pode escolher mais de um)</span>", o.objetivo) + radios("nivel", "Nível de experiência", o.nivel)
      + numero("idade", "Idade (anos)", 18, 90) + radios("sexo", "Sexo", o.sexo)
      + `<div class="ped-2">${numero("altura", "Altura (cm)", 120, 230)}${numero("peso", "Peso (kg)", 30, 300, 0.1)}</div>`;
    if (etapa === 1) return radios("dias", "Quantos dias por semana você pode treinar?", [2, 3, 4, 5, 6], (d) => d + " dias")
      + radios("minutos", "Tempo por treino", o.minutos, (m) => m + " min");
    if (etapa === 2) return `<p class="muted ped-intro">Perguntas do PAR-Q, um questionário usado antes de começar atividade física.</p>`
      + st.form.parq.map((q, i) => `<fieldset class="ped-grupo"><legend>${i + 1}. ${esc(q)}</legend><div class="ped-ops">
        <label><input type="radio" name="parq${i}" value="sim" ${f.parq[i] === true ? "checked" : ""}><span>Sim</span></label>
        <label><input type="radio" name="parq${i}" value="nao" ${f.parq[i] === false ? "checked" : ""}><span>Não</span></label></div></fieldset>`).join("")
      + (f.parq.includes(true) ? `<div class="ped-aviso" id="avisoParq"><p>Você respondeu Sim em alguma pergunta. Por segurança, só montamos o treino para quem tem liberação médica para fazer musculação.</p>
        ${caixa("liberacao", "Tenho liberação médica para fazer musculação", f.liberacao)}</div>` : "")
      + TEXTOS.map(([k, rot]) => `<div class="field"><label for="p_${k}">${rot} <span class="muted">(opcional)</span></label>
        <textarea id="p_${k}" name="${k}" maxlength="${st.form.textos[k]}" rows="2">${esc(f[k] || "")}</textarea></div>`).join("");
    if (etapa === 3) return `<p class="muted ped-intro">Opcional. As fotos servem para avaliar a postura e os pontos a desenvolver. Use roupa de treino, corpo inteiro e boa luz. Elas são apagadas 90 dias depois que o treino fica pronto.</p>
      <div class="ped-fotos">${FOTOS.map(([k, rot]) => `<div class="ped-foto">
        ${fotos[k] ? `<img src="${fotos[k]}" alt="Foto: ${rot}">` : `<div class="ped-vazia" aria-hidden="true">${rot}</div>`}
        <input type="file" accept="image/*" id="f_${k}" data-foto="${k}" class="sr">
        <label class="btn-sec" for="f_${k}">${fotos[k] ? "Trocar" : "Adicionar"}<span class="sr"> foto: ${rot}</span></label>
        ${fotos[k] ? `<button type="button" class="btn-sec" data-tirar="${k}">Remover<span class="sr"> foto: ${rot}</span></button>` : ""}</div>`).join("")}</div>
      ${Object.keys(fotos).length ? caixa("cfotos", "Autorizo guardar e usar minhas fotos para avaliar a postura e montar meu treino.", f.consentimentos.fotos) : ""}`;
    if (etapa === 4) return `<div class="field"><label for="p_observacoes">Algo mais que devemos saber? <span class="muted">(opcional)</span></label>
      <textarea id="p_observacoes" name="observacoes" maxlength="${st.form.textos.observacoes}" rows="5">${esc(f.observacoes || "")}</textarea>
      <p class="muted"><span id="conta">${(f.observacoes || "").length}</span> de ${st.form.textos.observacoes} caracteres</p></div>`;
    const item = (i, linhas) => `<div class="ped-res"><div class="chart-head"><h3>${ETAPAS[i]}</h3><button type="button" class="btn-sec" data-ir="${i}">Editar<span class="sr"> ${ETAPAS[i]}</span></button></div>
      ${linhas.map(([k, v]) => `<div class="row"><span>${k}</span><span>${esc(v)}</span></div>`).join("")}</div>`;
    const sims = f.parq.map((x, i) => (x ? i + 1 : 0)).filter(Boolean);
    return item(0, [["Objetivo", f.objetivo.join(", ")], ["Nível", f.nivel], ["Idade", f.idade + " anos"], ["Sexo", f.sexo], ["Altura", f.altura + " cm"], ["Peso", String(f.peso).replace(".", ",") + " kg"]])
      + item(1, [["Dias por semana", f.dias], ["Tempo por treino", f.minutos + " min"]])
      + item(2, [["PAR-Q", sims.length ? "Sim nas perguntas " + sims.join(", ") : "Não em todas"], ...(sims.length ? [["Liberação médica", "Sim"]] : []),
        ...TEXTOS.filter(([k]) => f[k]).map(([k, rot]) => [rot, f[k]])])
      + item(3, [["Fotos", Object.keys(fotos).length ? FOTOS.filter(([k]) => fotos[k]).map(([, r]) => r).join(", ") : "Nenhuma"]])
      + item(4, [["Observações", f.observacoes || "Nenhuma"]])
      + `<div class="row ped-total"><span>Valor do pedido</span><b>${reais(st.precos[tipo])}</b></div>
      <h3 class="ped-termo-tit" id="termoTit">Termo de Responsabilidade e Uso</h3>
      <div class="ped-termo" tabindex="0" role="region" aria-labelledby="termoTit">${window.FitWay.linkPrivacidade(esc(termo.texto), ' target="_blank" rel="noopener"')}</div>
      ${caixa("termo", "Li e aceito o Termo de Responsabilidade e Uso", f.termo)}
      ${caixa("cdados", "Autorizo guardar meus dados de saúde e fotos para montar e ajustar meu treino (LGPD: dado de saúde é dado sensível).", f.consentimentos.dados)}
      <p class="muted">Depois de enviar, você escolhe como pagar (Pix ou cartão). Assim que o pagamento for confirmado, o treino é montado e aparece na aba Treinos.</p>`;
  }

  function pintar(foco = true) {
    const ultima = etapa === ETAPAS.length - 1;
    shell("Treino personalizado", `
      <a class="adm-voltar" href="#/perfil">${window.FitWay.icon("back")}Perfil</a>
      <section class="card ped">
        <p class="muted" id="passo">Etapa ${etapa + 1} de ${ETAPAS.length}</p>
        <div class="progress" aria-hidden="true"><span class="track"><i style="width:${((etapa + 1) / ETAPAS.length) * 100}%"></i></span></div>
        <h2 id="etapaTit" tabindex="-1">${ETAPAS[etapa]}</h2>
        <form novalidate id="pedForm" aria-describedby="passo">${corpo()}
          <p class="err" role="alert" id="pedErr"></p>
          <div class="ped-nav">
            ${etapa ? `<button type="button" class="btn-sec" id="voltar">Voltar</button>` : ""}
            <button class="btn" type="submit" ${enviando ? "disabled" : ""}>${ultima ? (enviando ? "Enviando…" : "Enviar pedido") : "Continuar"}</button>
          </div>
        </form>
      </section>`, "perfil");
    if (foco) $("#etapaTit").focus();
    const form = $("#pedForm");
    form.oninput = form.onchange = (ev) => ler(ev.target);
    form.onsubmit = (ev) => { ev.preventDefault(); avancar(); };
    if (etapa) $("#voltar").onclick = () => irPara(etapa - 1);
    app.querySelectorAll("[data-ir]").forEach((b) => b.onclick = () => irPara(+b.dataset.ir));
    app.querySelectorAll("[data-foto]").forEach((i) => i.onchange = () => lerFoto(i));
    app.querySelectorAll("[data-tirar]").forEach((b) => b.onclick = () => { delete fotos[b.dataset.tirar]; pintar(false); $("#f_" + b.dataset.tirar).focus(); });
  }

  // A etapa só muda depois que a tela da nova etapa foi desenhada; se o desenho falhar, volta à de antes (e ao rascunho dela).
  function irPara(nova, foco = true) {
    const antes = etapa;
    etapa = nova;
    for (const [k] of FOTOS) lendo[k] = (lendo[k] || 0) + 1;
    try { pintar(foco); } catch (e) {
      etapa = antes; pintar(foco);
      $("#pedErr").textContent = "Não consegui abrir esta etapa. Tente de novo ou recarregue a página.";
      return false;
    }
    guardar();
    return true;
  }

  function ler(el) {
    const n = el.name;
    if (!n || el.type === "file") return;
    if (/^parq\d$/.test(n)) {
      const antes = f.parq.includes(true);
      f.parq[+n.slice(4)] = el.value === "sim";
      if (antes !== f.parq.includes(true)) { pintar(false); const a = $(`[name="${n}"][value="${el.value}"]`); if (a) a.focus(); }
    } else if (n === "objetivo") f.objetivo = [...app.querySelectorAll('[name="objetivo"]:checked')].map((i) => i.value);
    else if (n === "liberacao" || n === "termo") f[n] = el.checked;
    else if (n === "cdados") f.consentimentos.dados = el.checked;
    else if (n === "cfotos") f.consentimentos.fotos = el.checked;
    else if (["idade", "altura", "peso", "dias", "minutos"].includes(n)) f[n] = el.value === "" ? undefined : Number(el.value);
    else f[n] = el.value;
    if (n === "observacoes") $("#conta").textContent = el.value.length;
    guardar();
  }

  // Mesmos limites do servidor (api/_pedido.js), para avisar já na etapa; o servidor confere de novo.
  function erroDaEtapa() {
    const faixa = (v, a, b, int = true) => typeof v === "number" && Number.isFinite(v) && v >= a && v <= b && (!int || Number.isInteger(v));
    if (etapa === 0) {
      if (!f.objetivo.length) return "Escolha pelo menos um objetivo.";
      if (!f.nivel) return "Escolha o nível de experiência.";
      if (typeof f.idade === "number" && f.idade < 18) return "O treino personalizado é só para quem tem 18 anos ou mais.";
      if (!faixa(f.idade, 18, 90)) return "A idade precisa ser de 18 a 90 anos.";
      if (!f.sexo) return "Escolha o sexo.";
      if (!faixa(f.altura, 120, 230)) return "A altura precisa ser de 120 a 230 cm.";
      if (!faixa(f.peso, 30, 300, false)) return "O peso precisa ser de 30 a 300 kg.";
    }
    if (etapa === 1) {
      if (!faixa(f.dias, 2, 6)) return "Escolha quantos dias por semana.";
      if (!st.form.opcoes.minutos.includes(f.minutos)) return "Escolha o tempo por treino.";
    }
    if (etapa === 2) {
      const i = f.parq.findIndex((x) => x !== true && x !== false);
      if (i >= 0) return `Responda a pergunta ${i + 1} do questionário de saúde.`;
      if (f.parq.includes(true) && !f.liberacao) return "Você respondeu Sim no questionário de saúde. Para continuar, é preciso ter liberação médica para fazer musculação e marcar a caixa.";
    }
    if (etapa === 3 && Object.keys(fotos).length && !f.consentimentos.fotos) return "Para enviar fotos, marque a autorização das fotos (ou remova as fotos).";
    if (etapa === 5) {
      if (!f.termo) return "Para enviar, leia e aceite o Termo de Responsabilidade e Uso.";
      if (!f.consentimentos.dados) return "Para enviar, autorize guardar seus dados de saúde.";
    }
    return "";
  }

  async function avancar() {
    const erro = erroDaEtapa(), err = $("#pedErr");
    if (erro) return (err.textContent = erro);
    if (etapa < ETAPAS.length - 1) return irPara(etapa + 1);
    if (enviando) return;
    enviando = true; pintar(false);
    const respostas = { ...f, consentimentos: { dados: f.consentimentos.dados, fotos: !!Object.keys(fotos).length && f.consentimentos.fotos } };
    delete respostas.termo;
    let r;
    try {
      // O hash prova que o aceite foi deste texto exato.
      r = await api("pedido_criar", { tipo, respostas, fotos: Object.keys(fotos).length ? fotos : undefined, termo: termo.versao, termoHash: termo.hash });
    } catch (e) {
      enviando = false;
      if (location.hash.split("/")[1] !== "pedido") return toast(e.message);
      if (e.termoMudou) { // o termo mudou com o formulário aberto: busca o novo e pede o aceite de novo; as respostas ficam
        try { termo = await api("termo"); f.termo = false; } catch (_) { /* segue com o termo que já tem; o aviso abaixo basta */ }
        if (location.hash.split("/")[1] !== "pedido") return;
        pintar(false);
        return ($("#pedErr").textContent = "O termo foi atualizado. Leia de novo e aceite para enviar o pedido.");
      }
      pintar(false);
      return ($("#pedErr").textContent = e.status ? e.message : "Sem conexão com o servidor. Tente de novo.");
    }
    enviando = false;
    store.del(chave);
    toast("Pedido enviado. Agora é só pagar.");
    location.hash = "#/pagamento/" + encodeURIComponent(r.pedido.id);
  }

  // Reduz no aparelho: JPEG com lado maior de até 768 px. Se ainda passar de ~300 KB, baixa a qualidade.
  async function lerFoto(input) {
    const k = input.dataset.foto, arq = input.files[0];
    input.value = "";
    if (!arq) return;
    const meus = fotos, vez = lendo[k] = (lendo[k] || 0) + 1;
    // a leitura é assíncrona: a foto só entra se a pessoa continua nesta etapa, o formulário não recomeçou e não escolheu outra foto depois
    const aindaAqui = () => fotos === meus && lendo[k] === vez && etapa === 3 && !!$("#f_" + k);
    let img;
    try { img = await createImageBitmap(arq); } catch (e) { return aindaAqui() && toast("Não consegui abrir esta imagem."); }
    if (!aindaAqui()) { if (img.close) img.close(); return; }
    const s = Math.min(1, 768 / Math.max(img.width, img.height)), c = document.createElement("canvas");
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    if (img.close) img.close(); // libera a imagem decodificada (uma foto de 12 MP ocupa ~48 MB)
    let url = c.toDataURL("image/jpeg", 0.8);
    for (const q of [0.65, 0.5]) if (url.length > 409000) url = c.toDataURL("image/jpeg", q);
    if (url.length > 409000) return toast("Esta foto ficou grande demais. Tente outra.");
    fotos[k] = url;
    pintar(false);
    $("#f_" + k).focus();
  }

  window.FitWayPedido = { render };
})();
