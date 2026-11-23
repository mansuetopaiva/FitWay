// Foto de perfil: o app manda um JPEG quadrado de 512 px já recortado (js/recorte.js), mas o servidor trata tudo como entrada hostil.
// Confere formato, estrutura e dimensões do JPEG (inclusive depois da primeira varredura) e REMOVE os metadados (EXIF/GPS, XMP, IPTC, comentários) em vez de só recusar,
// para nunca guardar a localização de ninguém, venha a foto do app ou de um cliente feito à mão. O "_" impede a Vercel de expor como rota.
export const MAX_CHARS = 150000; // ~110 KB de JPEG; 512 px a qualidade 0,85 fica em 30–90 KB
export const LADO_MIN = 64, LADO_MAX = 1024; // as fotos antigas têm 160 px; as novas, 512 px
const PREFIXO = "data:image/jpeg;base64,";
const INVALIDA = { erro: "Imagem inválida. Tente outra foto." };

// Devolve { foto } (data URL limpa) ou { erro }.
export function limparFotoPerfil(foto) {
  if (typeof foto !== "string" || foto.length > MAX_CHARS || !foto.startsWith(PREFIXO)) return INVALIDA;
  const b64 = foto.slice(PREFIXO.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4) return INVALIDA;
  const b = Buffer.from(b64, "base64");
  if (b.length < 12 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return INVALIDA;
  const saida = [b.subarray(0, 2)];
  let i = 2, w = 0, h = 0, fim = false, naImagem = false;
  while (i + 2 <= b.length) {
    if (naImagem && b[i] !== 0xff) { // dados da imagem: vão até o próximo marcador de verdade (FF 00 é byte com FF, FF D0..D7 é reinício)
      let j = i;
      while (j + 1 < b.length && !(b[j] === 0xff && b[j + 1] !== 0x00 && b[j + 1] !== 0xff && !(b[j + 1] >= 0xd0 && b[j + 1] <= 0xd7))) j++;
      saida.push(b.subarray(i, j)); i = j;
      continue;
    }
    if (b[i] !== 0xff) return INVALIDA;
    const m = b[i + 1];
    if (m === 0xd9) { saida.push(b.subarray(i, i + 2)); i += 2; fim = true; break; } // EOI: nada pode vir depois
    if (m === 0xff || m === 0x00 || i + 4 > b.length) return INVALIDA;
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) return INVALIDA; // tamanho impossível
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { if (len < 8) return INVALIDA; h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); }
    // Fora: APP1..APP15 (EXIF, XMP, IPTC...) menos o perfil de cor (APP2) e o Adobe (APP14, que muda a leitura da cor), e comentários. Vale também entre varreduras.
    if (!((m >= 0xe1 && m <= 0xef && m !== 0xe2 && m !== 0xee) || m === 0xfe)) saida.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
    if (m === 0xda) naImagem = true;
  }
  if (!fim || i !== b.length) return INVALIDA; // sem EOI, ou com bytes sobrando depois dele
  if (w !== h || w < LADO_MIN || w > LADO_MAX) return INVALIDA;
  const limpa = PREFIXO + Buffer.concat(saida).toString("base64");
  return limpa.length > MAX_CHARS ? INVALIDA : { foto: limpa };
}
