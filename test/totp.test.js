// TOTP (RFC 6238) e cifra do segredo (api/_totp.js): funções puras, sem banco.
import { test } from "node:test";
import assert from "node:assert/strict";
import { base32, desbase32, passoDe, codigo, confere, cifrar, decifrar, novoSegredo, novosCodigosRecuperacao, otpauth, agrupar } from "../api/_totp.js";

const SEGREDO_RFC = Buffer.from("12345678901234567890"); // RFC 6238, Apêndice B (SHA-1)
// Apêndice B: [tempo em s, TOTP de 8 dígitos]. Com 6 dígitos valem os 6 últimos.
const VETORES = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]];

test("vetores do RFC 6238 (SHA-1): 8 dígitos e 6 dígitos", () => {
  for (const [t, esperado] of VETORES) {
    assert.equal(codigo(SEGREDO_RFC, passoDe(t * 1000), 8), esperado, "8 dígitos em T=" + t);
    assert.equal(codigo(SEGREDO_RFC, passoDe(t * 1000)), esperado.slice(-6), "6 dígitos em T=" + t);
  }
});

test("base32 (RFC 4648): vetores, ida e volta, minúsculas e espaços", () => {
  assert.equal(base32(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.equal(desbase32("MZXW6YTBOI").toString(), "foobar");
  assert.equal(desbase32("mzxw 6ytb-oi").toString(), "foobar");
  const s = novoSegredo(); assert.equal(s.length, 20);
  assert.deepEqual(desbase32(base32(s)), s);
  assert.equal(desbase32("1"), null, "caractere fora do alfabeto");
});

test("confere: janela de ±1 passo; fora dela recusa; devolve o passo aceito", () => {
  const agora = 1234567890 * 1000, p = passoDe(agora);
  assert.equal(confere(SEGREDO_RFC, codigo(SEGREDO_RFC, p), agora), p);
  assert.equal(confere(SEGREDO_RFC, codigo(SEGREDO_RFC, p - 1), agora), p - 1, "relógio do celular 30 s atrasado");
  assert.equal(confere(SEGREDO_RFC, codigo(SEGREDO_RFC, p + 1), agora), p + 1, "30 s adiantado");
  assert.equal(confere(SEGREDO_RFC, codigo(SEGREDO_RFC, p - 2), agora), null);
  assert.equal(confere(SEGREDO_RFC, codigo(SEGREDO_RFC, p + 2), agora), null);
  assert.equal(confere(SEGREDO_RFC, "12345", agora), null);
  assert.equal(confere(SEGREDO_RFC, "abcdef", agora), null);
  assert.equal(confere(SEGREDO_RFC, undefined, agora), null);
  assert.equal(confere(SEGREDO_RFC, codigo(SEGREDO_RFC, p).replace(/(...)(...)/, "$1 $2"), agora), p, "aceita espaço no meio");
});

const K1 = "a".repeat(40), K2 = "b".repeat(40);
test("cifra: ida e volta; cada cifragem é diferente; adulterada, formato errado e chave errada falham", () => {
  const s = novoSegredo(), c = cifrar(s, { TOTP_CHAVE: K1 });
  assert.match(c, /^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
  assert.notEqual(c, cifrar(s, { TOTP_CHAVE: K1 }), "IV novo a cada vez");
  assert.deepEqual(decifrar(c, { TOTP_CHAVE: K1 }).segredo, s);
  const partes = c.split(":"); partes[3] = (partes[3][0] === "0" ? "1" : "0") + partes[3].slice(1);
  assert.equal(decifrar(partes.join(":"), { TOTP_CHAVE: K1 }), null, "texto adulterado");
  assert.equal(decifrar(c.replace(/^v1/, "v2"), { TOTP_CHAVE: K1 }), null);
  assert.equal(decifrar("lixo", { TOTP_CHAVE: K1 }), null);
  assert.equal(decifrar(c, { TOTP_CHAVE: K2 }), null, "outra chave");
  assert.equal(decifrar(c, {}), null, "sem chave");
});

test("troca de chave: a anterior ainda lê e avisa que precisa regravar; a nova não pede nada", () => {
  const s = novoSegredo(), velho = cifrar(s, { TOTP_CHAVE: K1 });
  const r = decifrar(velho, { TOTP_CHAVE: K2, TOTP_CHAVE_ANTERIOR: K1 });
  assert.deepEqual(r.segredo, s); assert.equal(r.regravar, true);
  assert.equal(decifrar(cifrar(s, { TOTP_CHAVE: K2 }), { TOTP_CHAVE: K2, TOTP_CHAVE_ANTERIOR: K1 }).regravar, false);
  assert.equal(decifrar(velho, { TOTP_CHAVE: K2 }), null, "sem a anterior, não lê");
});

test("chave curta (menos de 32 caracteres) conta como não configurada", () => {
  assert.throws(() => cifrar(novoSegredo(), { TOTP_CHAVE: "curta" }));
  assert.equal(decifrar("v1:a:b:c", { TOTP_CHAVE: "curta" }), null);
});

test("códigos de recuperação: 10, únicos, 10 caracteres base32; link otpauth e agrupamento da chave", () => {
  const c = novosCodigosRecuperacao();
  assert.equal(c.length, 10); assert.equal(new Set(c).size, 10);
  for (const x of c) assert.match(x, /^[A-Z2-7]{10}$/);
  assert.equal(agrupar("ABCDEFGHIJKLMNOP"), "ABCD EFGH IJKL MNOP");
  const u = otpauth("dono@x.com", "ABCDEFGH"), url = new URL(u);
  assert.equal(url.protocol, "otpauth:"); assert.equal(url.host, "totp");
  assert.equal(url.searchParams.get("secret"), "ABCDEFGH"); assert.equal(url.searchParams.get("issuer"), "FitWay");
  assert.equal(url.searchParams.get("digits"), "6"); assert.equal(url.searchParams.get("period"), "30");
  assert.equal(decodeURIComponent(url.pathname), "/FitWay:dono@x.com");
});
