/* FitWay — recorte da foto de perfil. Baixado só quando a pessoa escolhe uma foto.
   Parte pura (geometria do recorte, orientação EXIF): sem DOM, testada em test/recorte.test.js. A tela vem abaixo. */
(function () {
  "use strict";
  const ZOOM_MAX = 4; // até 4x o mínimo que cobre a moldura
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  // ---------- geometria ----------
  // Estado: { iw, ih (imagem, px), lado (moldura na tela, px), zoom (1 a ZOOM_MAX; 1 = o mínimo que cobre), cx, cy (centro da janela, px da imagem) }.
  // A janela é o quadrado da imagem que aparece na moldura: nunca sai da imagem, então nunca aparece fundo vazio.
  const escala = (e) => (e.lado / Math.min(e.iw, e.ih)) * e.zoom; // px de tela por px da imagem
  const janela = (e) => e.lado / escala(e);                         // lado da janela, em px da imagem
  function ajustar(e) {
    const j = janela(e);
    e.cx = clamp(e.cx, j / 2, e.iw - j / 2);
    e.cy = clamp(e.cy, j / 2, e.ih - j / 2);
    return e;
  }
  const novo = (iw, ih, lado) => ajustar({ iw, ih, lado, zoom: 1, cx: iw / 2, cy: ih / 2 });
  // dx, dy: quanto a imagem andou na tela (arrastar para a direita = imagem para a direita = janela para a esquerda).
  const mover = (e, dx, dy) => { const s = escala(e); e.cx -= dx / s; e.cy -= dy / s; return ajustar(e); };
  // O ponto da imagem sob a âncora (ax, ay, em px da moldura; padrão: o centro) fica no mesmo lugar depois do zoom.
  function zoomar(e, zoom, ax = e.lado / 2, ay = e.lado / 2) {
    const s0 = escala(e), px = e.cx + (ax - e.lado / 2) / s0, py = e.cy + (ay - e.lado / 2) / s0;
    e.zoom = clamp(zoom, 1, ZOOM_MAX);
    const s1 = escala(e);
    e.cx = px - (ax - e.lado / 2) / s1; e.cy = py - (ay - e.lado / 2) / s1;
    return ajustar(e);
  }
  const recorte = (e) => { const j = janela(e); return { sx: e.cx - j / 2, sy: e.cy - j / 2, lado: j }; }; // para drawImage(img, sx, sy, lado, lado, 0, 0, 512, 512)

  // ---------- JPEG: dimensões e orientação EXIF ----------
  // bytes: Uint8Array com o começo do arquivo (64 KB bastam: EXIF e SOF ficam antes da imagem).
  function marcadores(bytes, f) {
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let i = 2;
    while (i + 4 <= bytes.length && bytes[i] === 0xff) {
      const m = bytes[i + 1], len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (m === 0xda || m === 0xd9 || len < 2) return null;
      const r = f(m, i + 4, len - 2);
      if (r) return r;
      i += 2 + len;
    }
    return null;
  }
  const dimensoesJpeg = (bytes) => marcadores(bytes, (m, ini) =>
    m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc && ini + 5 <= bytes.length ? { h: (bytes[ini + 1] << 8) | bytes[ini + 2], w: (bytes[ini + 3] << 8) | bytes[ini + 4] } : null);
  // 1 a 8 (1 = normal). Sem EXIF, ou EXIF estranho, vale 1.
  function orientacao(bytes) {
    return marcadores(bytes, (m, ini, n) => {
      if (m !== 0xe1 || n < 14 || String.fromCharCode(...bytes.subarray(ini, ini + 4)) !== "Exif") return null;
      const t = ini + 6, v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), le = bytes[t] === 0x49;
      if (!(bytes[t] === 0x49 || bytes[t] === 0x4d) || v.getUint16(t + 2, le) !== 42) return null;
      const ifd = t + v.getUint32(t + 4, le);
      if (ifd + 2 > bytes.length) return null;
      const qtd = v.getUint16(ifd, le);
      for (let k = 0; k < qtd && ifd + 2 + 12 * (k + 1) <= bytes.length; k++) {
        const e = ifd + 2 + 12 * k;
        if (v.getUint16(e, le) === 0x0112) { const o = v.getUint16(e + 8, le); return o >= 1 && o <= 8 ? o : null; }
      }
      return null;
    }) || 1;
  }
  // Matriz de canvas (ctx.transform) que desenha uma imagem w x h "crua" já na orientação certa, e o tamanho resultante.
  function transformacao(o, w, h) {
    if (!(o >= 1 && o <= 8)) o = 1;
    const m = { 1: [1, 0, 0, 1, 0, 0], 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h],
      5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w] }[o];
    return { matriz: m, largura: o > 4 ? h : w, altura: o > 4 ? w : h };
  }


  // ---------- tela do recorte ----------
  const LADO = 512, QUALIDADE = 0.85, MAX_CHARS = 140000; // o servidor aceita até 150000 (api/_foto.js)
  const MAX_ARQUIVO = 12 * 1024 * 1024, LADO_MIN_FOTO = 128;
  const TIPOS = /^image\/(jpeg|png|webp|gif|heic|heif)$/i;
  const $ = (s, r = document) => r.querySelector(s);

  // O navegador aplica a orientação EXIF ao decodificar? Descobre uma vez (JPEG de 2x1 com EXIF 6: aplicado vira 1x2). Sem como testar, assume que sim.
  let giraExif;
  async function navegadorGiraExif() {
    if (giraExif !== undefined) return giraExif;
    try {
      const c = document.createElement("canvas"); c.width = 2; c.height = 1; c.getContext("2d").fillRect(0, 0, 2, 1);
      const jpg = new Uint8Array(await (await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no()), "image/jpeg"))).arrayBuffer());
      const t = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0], corpo = [...new TextEncoder().encode("Exif\0\0"), ...t], n = corpo.length + 2;
      const b = await createImageBitmap(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, n >> 8, n & 255, ...corpo, ...jpg.subarray(2)])], { type: "image/jpeg" }), { imageOrientation: "from-image" });
      giraExif = b.width === 1 && b.height === 2;
    } catch (e) { giraExif = true; }
    return giraExif;
  }

  // Lê o arquivo, valida e devolve { fonte (bitmap ou canvas já na orientação certa), iw, ih }.
  // Erros viram Error com mensagem pronta para a pessoa.
  async function ler(arquivo) {
    if (!TIPOS.test(arquivo.type || "")) throw new Error("Escolha uma foto em JPEG, PNG ou WebP.");
    if (arquivo.size > MAX_ARQUIVO) throw new Error("A foto é grande demais (máximo 12 MB). Tente outra.");
    const aberta = new Error("Não consegui abrir esta imagem. Tente outra foto.");
    let bmp, cabeca = new Uint8Array(0);
    try { cabeca = new Uint8Array(await arquivo.slice(0, 65536).arrayBuffer()); } catch (e) { /* sem cabeçalho: segue sem EXIF */ }
    try { bmp = await createImageBitmap(arquivo, { imageOrientation: "from-image" }); }
    catch (e) { try { bmp = await createImageBitmap(arquivo); } catch (e2) { throw aberta; } }
    if (!bmp.width || !bmp.height) throw aberta;
    // Os navegadores de hoje já giram a foto pelo EXIF. Se não giraram (bitmap com o tamanho cru e orientação de 90°), giro aqui.
    const o = orientacao(cabeca), cru = dimensoesJpeg(cabeca);
    let fonte = bmp, iw = bmp.width, ih = bmp.height;
    // Foto retangular: o tamanho do bitmap diz se o navegador girou. Foto quadrada (e giros de 180° e espelhos) não têm essa pista:
    // testa uma vez, com um JPEG de 2x1 e EXIF 6, se o navegador aplica o EXIF.
    const girar = o >= 5 && cru && cru.w !== cru.h ? bmp.width === cru.w && bmp.height === cru.h
      : o > 1 && cru && cru.w === cru.h && !(await navegadorGiraExif());
    if (girar) {
      const t = transformacao(o, cru.w, cru.h), c = document.createElement("canvas");
      c.width = t.largura; c.height = t.altura;
      const x = c.getContext("2d"); x.transform(...t.matriz); x.drawImage(bmp, 0, 0);
      fonte = c; iw = t.largura; ih = t.altura;
    }
    if (Math.min(iw, ih) < LADO_MIN_FOTO) throw new Error("A foto é pequena demais (mínimo de 128 px de lado). Tente outra.");
    if (iw * ih > 1.5e8) throw new Error("A foto é grande demais. Tente outra.");
    return { fonte, iw, ih };
  }

  // Desenha o recorte em 512x512 (canvas) e devolve o JPEG como data URL: os metadados da foto original (local, câmera) não vêm junto.
  function gerar(fonte, e) {
    const c = document.createElement("canvas"); c.width = c.height = LADO;
    const x = c.getContext("2d"), r = recorte(e);
    x.fillStyle = "#fff"; x.fillRect(0, 0, LADO, LADO); // JPEG não tem transparência
    x.imageSmoothingQuality = "high";
    x.drawImage(fonte, r.sx, r.sy, r.lado, r.lado, 0, 0, LADO, LADO);
    for (const q of [QUALIDADE, 0.75, 0.65, 0.55]) {
      const url = c.toDataURL("image/jpeg", q);
      if (!url.startsWith("data:image/jpeg")) break;
      if (url.length <= MAX_CHARS) return url;
    }
    throw new Error("Não consegui preparar a foto. Tente outra.");
  }

  // Abre o recorte. opc: { salvar(dataUrl) -> Promise (rejeita com Error [+ status] se falhar), voltarFoco (elemento), aviso(texto) }.
  // Resolve true se a foto foi salva, false se cancelou ou nem abriu. Nada é gravado antes de "Salvar".
  async function abrir(arquivo, opc) {
    let img;
    try { img = await ler(arquivo); } catch (e) { opc.aviso(e.message); return false; }
    return new Promise((fim) => {
      const app = $("#app"), raiz = document.createElement("div");
      raiz.className = "recorte"; raiz.setAttribute("role", "dialog"); raiz.setAttribute("aria-modal", "true");
      raiz.setAttribute("aria-labelledby", "recTit"); raiz.setAttribute("aria-describedby", "recAjuda");
      raiz.innerHTML = `<div class="recorte-caixa">
        <h2 id="recTit" tabindex="-1">Ajustar foto de perfil</h2>
        <div class="recorte-palco" id="recPalco" tabindex="0" role="group" aria-label="Área de recorte. Setas movem a foto, mais e menos mudam o zoom, Enter salva, Esc cancela.">
          <canvas id="recTela"></canvas><div class="recorte-moldura" aria-hidden="true"></div>
        </div>
        <p class="muted recorte-dica" id="recAjuda">Arraste a foto para mover. Para o zoom: barra, botões, pinça com dois dedos ou roda do mouse. A moldura redonda mostra como a foto vai aparecer.</p>
        <div class="recorte-zoom"><label class="sr" for="recZoom">Zoom</label>
          <button type="button" id="recMenos" aria-label="Diminuir zoom">−</button>
          <input type="range" id="recZoom" min="100" max="${ZOOM_MAX * 100}" step="1" value="100" aria-valuetext="100%">
          <button type="button" id="recMais" aria-label="Aumentar zoom">+</button></div>
        <p class="sr" id="recVivo" role="status" aria-live="polite"></p>
        <p class="err" role="alert" id="recErr"></p>
        <div class="recorte-acoes"><button type="button" class="btn-sec" id="recCancelar">Cancelar</button><button type="button" class="btn" id="recSalvar">Salvar</button></div>
      </div>`;
      document.body.appendChild(raiz);
      app.inert = true; app.setAttribute("aria-hidden", "true"); // o resto da tela não é lido nem focado enquanto o recorte está aberto
      const palco = $("#recPalco", raiz), tela = $("#recTela", raiz), zoom = $("#recZoom", raiz), erroEl = $("#recErr", raiz), vivo = $("#recVivo", raiz);
      const lado = () => palco.clientWidth || 300;
      const e = novo(img.iw, img.ih, lado());
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let ocupado = false, quadro = 0, falar = 0;
      raiz.dataset.largura = img.iw; raiz.dataset.altura = img.ih; // a foto já na orientação certa (conferido nos testes)

      function pintar() {
        quadro = 0;
        const L = lado(); if (e.lado !== L) { e.lado = L; ajustar(e); }
        tela.width = tela.height = Math.round(L * dpr);
        const x = tela.getContext("2d"), r = recorte(e);
        x.imageSmoothingQuality = "high";
        x.drawImage(img.fonte, r.sx, r.sy, r.lado, r.lado, 0, 0, tela.width, tela.height);
        const pct = Math.round(e.zoom * 100);
        zoom.value = pct; zoom.setAttribute("aria-valuetext", pct + "%");
        $("#recMenos", raiz).disabled = e.zoom <= 1; $("#recMais", raiz).disabled = e.zoom >= ZOOM_MAX;
        raiz.dataset.zoom = pct; raiz.dataset.cx = Math.round(e.cx); raiz.dataset.cy = Math.round(e.cy);
      }
      const agendar = () => { if (!quadro) quadro = requestAnimationFrame(pintar); };
      // Anuncia o zoom depois de parar de mexer (a roda e a pinça mudam dezenas de vezes por segundo).
      const anunciar = () => { clearTimeout(falar); falar = setTimeout(() => { vivo.textContent = `Zoom ${Math.round(e.zoom * 100)}%`; }, 300); };
      const mudarZoom = (z, ax, ay) => { zoomar(e, z, ax, ay); agendar(); anunciar(); };
      const arrastar = (dx, dy) => { mover(e, dx, dy); agendar(); };

      // ponteiros: um dedo/mouse arrasta, dois dedos fazem pinça (zoom e movimento do ponto médio)
      const pt = new Map(); let base = null;
      const rel = (ev) => { const b = palco.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; };
      const dois = () => { const [a, b] = [...pt.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; };
      palco.addEventListener("pointerdown", (ev) => {
        palco.setPointerCapture && palco.setPointerCapture(ev.pointerId);
        pt.set(ev.pointerId, rel(ev));
        base = pt.size === 2 ? { ...dois(), zoom: e.zoom } : null;
        palco.focus();
      });
      palco.addEventListener("pointermove", (ev) => {
        if (!pt.has(ev.pointerId)) return;
        const antes = pt.get(ev.pointerId), agora = rel(ev);
        pt.set(ev.pointerId, agora);
        if (pt.size === 1) arrastar(agora[0] - antes[0], agora[1] - antes[1]);
        else if (pt.size === 2 && base) {
          const n = dois();
          arrastar(n.mx - base.mx, n.my - base.my); base.mx = n.mx; base.my = n.my;
          mudarZoom(base.zoom * (n.d / base.d), n.mx, n.my);
        }
      });
      const soltar = (ev) => { pt.delete(ev.pointerId); base = pt.size === 2 ? { ...dois(), zoom: e.zoom } : null; };
      palco.addEventListener("pointerup", soltar); palco.addEventListener("pointercancel", soltar);
      palco.addEventListener("wheel", (ev) => {
        ev.preventDefault(); // a página não rola enquanto a roda dá zoom
        const [ax, ay] = rel(ev), px = ev.deltaMode === 1 ? 16 : 1;
        mudarZoom(e.zoom * Math.exp(-ev.deltaY * px * 0.002), ax, ay);
      }, { passive: false });
      zoom.addEventListener("input", () => mudarZoom(+zoom.value / 100));
      $("#recMenos", raiz).onclick = () => mudarZoom(e.zoom - 0.25);
      $("#recMais", raiz).onclick = () => mudarZoom(e.zoom + 0.25);

      function fechar(salvou) {
        clearTimeout(falar); if (quadro) cancelAnimationFrame(quadro);
        document.removeEventListener("focusin", prender, true); window.removeEventListener("resize", agendar);
        raiz.remove(); app.inert = false; app.removeAttribute("aria-hidden");
        if (opc.voltarFoco && opc.voltarFoco.isConnected) opc.voltarFoco.focus();
        fim(salvou);
      }
      function liberar(onde) { ocupado = false; $("#recSalvar", raiz).disabled = false; $("#recCancelar", raiz).disabled = false; $("#recSalvar", raiz).textContent = "Salvar"; if (onde) onde.focus(); }
      async function salvar() {
        if (ocupado) return;
        ocupado = true; erroEl.textContent = "";
        $("#recSalvar", raiz).disabled = true; $("#recCancelar", raiz).disabled = true; $("#recSalvar", raiz).textContent = "Salvando…";
        let url;
        try { url = gerar(img.fonte, e); } catch (x) { erroEl.textContent = x.message; return liberar($("#recSalvar", raiz)); }
        try { await opc.salvar(url); }
        catch (x) { erroEl.textContent = x.status ? x.message : "Sem conexão com o servidor. Tente de novo."; return liberar($("#recSalvar", raiz)); } // o recorte continua aberto
        fechar(true);
      }
      $("#recSalvar", raiz).onclick = salvar;
      $("#recCancelar", raiz).onclick = () => { if (!ocupado) fechar(false); };

      // Teclado: setas movem, + e − dão zoom, Enter salva, Esc cancela, Tab fica dentro do recorte.
      const focaveis = () => [...raiz.querySelectorAll("button, input, [tabindex='0']")].filter((x) => !x.disabled);
      const passo = () => lado() * 0.05;
      raiz.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") { ev.preventDefault(); if (!ocupado) fechar(false); return; }
        if (ev.key === "Tab") {
          const f = focaveis(), i = f.indexOf(document.activeElement);
          if (ev.shiftKey && (i <= 0)) { ev.preventDefault(); f[f.length - 1].focus(); }
          else if (!ev.shiftKey && i === f.length - 1) { ev.preventDefault(); f[0].focus(); }
          return;
        }
        if (ev.key === "Enter" && ev.target.tagName !== "BUTTON") { ev.preventDefault(); return salvar(); }
        if (ev.key === "+" || ev.key === "=") { ev.preventDefault(); return mudarZoom(e.zoom + 0.25); }
        if (ev.key === "-" || ev.key === "_") { ev.preventDefault(); return mudarZoom(e.zoom - 0.25); }
        const seta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
        if (seta && ev.target === palco) { ev.preventDefault(); arrastar(seta[0] * passo(), seta[1] * passo()); } // a foto anda no sentido da seta
      });
      // Se o foco escapar (leitor de tela, clique fora), volta para dentro.
      function prender(ev) { if (!raiz.contains(ev.target)) palco.focus(); }
      document.addEventListener("focusin", prender, true);
      window.addEventListener("resize", agendar);
      pintar();
      palco.focus();
    });
  }

  window.FitWayRecorte = { ZOOM_MAX, novo, mover, zoomar, recorte, escala, janela, dimensoesJpeg, orientacao, transformacao, abrir };
})();
