// Segundo fator do admin, obrigatório (docs/admin-2fa.md). A senha certa nunca abre sessão de admin: devolve um desafio de uso único
// (só o hash fica no banco) e a sessão nasce em entrar2fa, depois de um código válido. Sem 1º código válido ainda não há segundo fator:
// o desafio é de "ativar" (mostra a chave e o link otpauth) e o código de ativação também cria a sessão.
import { createHash, randomBytes } from "node:crypto";
import { hmacTexto } from "./_admin.js";
import { confere as senhaConfere } from "./_senha.js";
import { reservarCodigo, zerarAdmin } from "./_login.js";
import { agrupar, base32, cifrar, confere, decifrar, desbase32, novoSegredo, novosCodigosRecuperacao, otpauth, passoDe, totpChaveOk } from "./_totp.js";

export const MSG_CODIGO = "Código incorreto. Depois de várias tentativas erradas, a verificação espera até 15 minutos antes de aceitar de novo.";
export const MSG_RECOMECAR = "A verificação expirou ou já foi usada. Entre de novo com a senha.";
export const MSG_SEM_CONFIG = "Entrada de administrador indisponível: o servidor está sem a chave do segundo fator (TOTP_CHAVE, com 32 ou mais caracteres) ou sem HASH_SEGREDO. Configure as variáveis na Vercel e tente de novo. Veja docs/admin-2fa.md.";
export const MSG_ILEGIVEL = "Entrada de administrador indisponível: o servidor não consegue ler o segundo fator guardado (TOTP_CHAVE trocada sem TOTP_CHAVE_ANTERIOR?). Veja docs/admin-2fa.md.";
const VALE = { ativar: "10 minutes", codigo: "5 minutes" }, TENTATIVAS = 5;
const sha = (t) => createHash("sha256").update(t).digest("hex");
const falha = (status, erro, extra = {}) => ({ status, corpo: { erro, ...extra } });
const prontoParaUsar = () => totpChaveOk() && !!hmacTexto("x");
const hashRec = (email, cod) => hmacTexto("rec:" + email + ":" + cod);
const normRec = (t) => String(t).toUpperCase().replace(/[\s-]/g, "");
// Sem segredo, código nem IP no log.
const registrar = (sql, email, acao) => sql`insert into admin_log (admin_email, acao, alvo_email) values (${email}, ${acao}, ${email})`;

// Grava os 10 códigos de uma vez (os antigos somem na mesma instrução) e devolve os códigos em claro: só este retorno os mostra.
async function trocarCodigos(sql, email) {
  const codigos = novosCodigosRecuperacao();
  await sql`with d as (delete from admin_recuperacao where email = ${email})
    insert into admin_recuperacao (email, hash) select ${email}, unnest(${codigos.map((c) => hashRec(email, c))}::text[])`;
  return codigos;
}
// Segredo do admin (lido com a chave atual ou a anterior; regravado com a atual). null: não abre.
async function lerSegredo(sql, email) {
  const [l] = await sql`select segredo_cifrado, ativado_em from admin_2fa where email = ${email}`;
  if (!l) return { l: null };
  const d = decifrar(l.segredo_cifrado);
  if (d && d.regravar) await sql`update admin_2fa set segredo_cifrado = ${cifrar(d.segredo)} where email = ${email}`;
  return { l, segredo: d && d.segredo };
}

// Senha certa de um admin: abre o desafio. Sem sessão, sem dado da conta.
export async function desafiar(sql, email) {
  if (!prontoParaUsar()) return falha(503, MSG_SEM_CONFIG);
  let { l, segredo } = await lerSegredo(sql, email);
  if (!l) {
    await sql`insert into admin_2fa (email, segredo_cifrado) values (${email}, ${cifrar(novoSegredo())}) on conflict do nothing`; // duas entradas juntas: vale a primeira
    ({ l, segredo } = await lerSegredo(sql, email));
  } else if (!segredo && !l.ativado_em) { // pendente e ilegível (chave trocada antes de ativar): recomeça
    await sql`update admin_2fa set segredo_cifrado = ${cifrar(novoSegredo())} where email = ${email} and ativado_em is null`;
    ({ l, segredo } = await lerSegredo(sql, email));
  }
  if (!segredo) return falha(503, MSG_ILEGIVEL);
  const tipo = l.ativado_em ? "codigo" : "ativar", desafio = randomBytes(32).toString("hex");
  await sql`delete from login_desafios where expira < now() - interval '1 day'`;
  await sql`insert into login_desafios (hash, email, tipo, expira) values (${sha(desafio)}, ${email}, ${tipo}, now() + ${VALE[tipo]}::interval)`;
  const chave = base32(segredo);
  return { status: 200, corpo: { precisa2fa: true, etapa: tipo, desafio, ...(tipo === "ativar" ? { chave: agrupar(chave), otpauth: otpauth(email, chave) } : {}) } };
}

// Aceita o código do autenticador (6 dígitos, uma vez por janela) ou, fora da ativação, um código de recuperação (uso único).
// Devolve { email, recuperacao?, restantes? } quando vale; senão { status, corpo }.
export async function entrar2fa(sql, { desafio, codigo }) {
  if (typeof desafio !== "string" || !/^[0-9a-f]{64}$/.test(desafio) || typeof codigo !== "string" || codigo.length > 40) return falha(401, MSG_RECOMECAR, { recomecar: true });
  // Gasta uma das 5 tentativas do desafio (atômico). Desafio inventado ou vencido não chega ao contador da conta: estranho não bloqueia o admin.
  const [d] = await sql`update login_desafios set tentativas = tentativas + 1
    where hash = ${sha(desafio)} and usado_em is null and expira > now() and tentativas < ${TENTATIVAS} returning email, tipo`;
  if (!d) return falha(401, MSG_RECOMECAR, { recomecar: true });
  if (!prontoParaUsar()) return falha(503, MSG_SEM_CONFIG);
  const erro = async (liberado) => { if (liberado) await registrar(sql, d.email, "2fa_falha_codigo"); return falha(401, MSG_CODIGO); };
  if (!(await reservarCodigo(sql, d.email))) return erro(false); // bloqueado: mesma resposta, e o código certo também é recusado
  const { l, segredo } = await lerSegredo(sql, d.email);
  if (!segredo) return falha(503, MSG_ILEGIVEL);
  const totp = /^\d{6}$/.test(codigo.replace(/\s/g, ""));
  let restantes;
  if (totp) {
    const passo = confere(segredo, codigo);
    if (passo === null) return erro(true);
    // Um código só vale uma vez: o passo tem de ser maior que o último aceito (atômico: dois pedidos com o mesmo código não passam os dois).
    const [ok] = await sql`update admin_2fa set ultimo_passo = ${passo} where email = ${d.email} and ultimo_passo < ${passo} returning email`;
    if (!ok) return erro(true);
  } else {
    if (d.tipo !== "codigo") return erro(true); // na ativação só vale o código do autenticador
    const [ok] = await sql`update admin_recuperacao set usado_em = now() where email = ${d.email} and hash = ${hashRec(d.email, normRec(codigo))} and usado_em is null returning hash`;
    if (!ok) return erro(true);
    restantes = (await sql`select count(*)::int as n from admin_recuperacao where email = ${d.email} and usado_em is null`)[0].n;
    await registrar(sql, d.email, "2fa_recuperacao_usada");
  }
  const [uso] = await sql`update login_desafios set usado_em = now() where hash = ${sha(desafio)} and usado_em is null returning email`; // uso único
  if (!uso) return falha(401, MSG_RECOMECAR, { recomecar: true });
  let recuperacao;
  if (d.tipo === "ativar") {
    recuperacao = await trocarCodigos(sql, d.email);
    await sql`update admin_2fa set ativado_em = now() where email = ${d.email} and ativado_em is null`;
    await registrar(sql, d.email, "2fa_ativado");
  }
  return { email: d.email, ...(recuperacao ? { recuperacao } : {}), ...(restantes !== undefined ? { restantes } : {}) };
}
export const login2faCompleto = zerarAdmin;

export async function restantes(sql, email) {
  return (await sql`select count(*)::int as n from admin_recuperacao where email = ${email} and usado_em is null`)[0].n;
}
// Gera 10 códigos novos (os antigos deixam de valer). Exige a senha atual e um código do autenticador; um erro de qualquer um dos dois
// conta no bloqueio do código e recebe a mesma resposta.
export async function novosCodigos(sql, u, { senha, codigo }) {
  if (!prontoParaUsar()) return falha(503, MSG_SEM_CONFIG);
  if (typeof senha !== "string" || typeof codigo !== "string" || senha.length > 100 || codigo.length > 40) return falha(401, MSG_CODIGO);
  const liberado = await reservarCodigo(sql, u.email);
  const [x] = await sql`select senha from usuarios where email = ${u.email}`;
  const { segredo } = await lerSegredo(sql, u.email);
  const senhaOk = senhaConfere(senha, x.senha), passo = segredo ? confere(segredo, codigo) : null; // os dois sempre são conferidos
  let ok = liberado && senhaOk && passo !== null;
  if (ok) [ok] = await sql`update admin_2fa set ultimo_passo = ${passo} where email = ${u.email} and ultimo_passo < ${passo} returning email`;
  if (!ok) { if (liberado) await registrar(sql, u.email, "2fa_falha_codigo"); return falha(401, MSG_CODIGO); }
  const recuperacao = await trocarCodigos(sql, u.email);
  await registrar(sql, u.email, "2fa_codigos_novos");
  return { status: 200, corpo: { recuperacao, restantes: recuperacao.length } };
}
