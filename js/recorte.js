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

  window.FitWayRecorte = { ZOOM_MAX, novo, mover, zoomar, recorte, escala, janela, dimensoesJpeg, orientacao, transformacao };
})();
