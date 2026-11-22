// JPEG sintético para os testes (estrutura de marcadores válida, sem pixels reais): o servidor só lê marcadores e dimensões.
export function jpeg({ w = 512, h = 512, app1 = null, xmp = null, icc = null, com = null, semEoi = false, entropia = 64, semSof = false } = {}) {
  const seg = (m, corpo) => Buffer.concat([Buffer.from([0xff, m, (corpo.length + 2) >> 8, (corpo.length + 2) & 255]), corpo]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    ...(app1 ? [seg(0xe1, Buffer.from(app1, "latin1"))] : []),
    ...(xmp ? [seg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0" + xmp, "latin1"))] : []),
    ...(icc ? [seg(0xe2, Buffer.from("ICC_PROFILE\0" + icc, "latin1"))] : []),
    ...(com ? [seg(0xfe, Buffer.from(com, "latin1"))] : []),
    seg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 16)])),
    ...(semSof ? [] : [seg(0xc0, Buffer.from([8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]))]),
    seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.alloc(entropia, 0x55),
    ...(semEoi ? [] : [Buffer.from([0xff, 0xd9])]),
  ]);
}
export const urlDe = (b) => "data:image/jpeg;base64," + b.toString("base64");
