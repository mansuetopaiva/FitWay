// Senha: o jeito de guardar (scrypt, o mesmo do cadastro), "Esqueci a senha" por email e troca no Perfil (docs/senha.md).
// O "_" impede a Vercel de expor como rota. Recebe sql e o transporte de email por parâmetro para o teste.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { emailDisponivel, enviarEmail, mensagemIndisponivel } from "./_email.js";

export const senhaHash = (senha, salt = randomBytes(16).toString("hex")) => `${salt}:${scryptSync(senha, salt, 32).toString("hex")}`;
export const confere = (senha, guardada) => {
  const feita = Buffer.from(senhaHash(senha, guardada.split(":")[0])), certa = Buffer.from(guardada);
  return feita.length === certa.length && timingSafeEqual(feita, certa);
};
// As regras do cadastro: 6 a 100 caracteres.
export const senhaValida = (s) => typeof s === "string" && s.length >= 6 && s.length <= 100;
export const ERRO_SENHA = "A senha precisa ter pelo menos 6 caracteres.";

export const MSG_PEDIDO = "Se houver uma conta com esse email, enviamos um link para trocar a senha. Ele vale por 30 minutos. Confira também o spam.";
export const MSG_LINK = "Este link não vale mais. Peça um novo em Esqueci a senha.";
const sha = (t) => createHash("sha256").update(t).digest("hex");
const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const site = () => (process.env.SITE_URL || "").trim().replace(/\/+$/, "");
const PISO = 2500; // ms: a resposta do "Esqueci a senha" leva sempre isso, com ou sem conta

// "Esqueci a senha". A resposta é sempre MSG_PEDIDO: com ou sem conta, dentro ou fora do limite, email válido ou não,
// e sempre depois do mesmo piso de tempo (as instruções no banco também são as mesmas).
// shortcut: se o Gmail demorar mais que o piso, a resposta com conta sai depois; trocar por envio em segundo plano se medir diferença.
export async function pedirLink(sql, { email, ip }, { transporte, esperar = (ms) => new Promise((ok) => setTimeout(ok, ms)), piso = PISO, agora = Date.now } = {}) {
  if (!emailDisponivel()) return { indisponivel: true, mensagem: mensagemIndisponivel() };
  const inicio = agora();
  try {
    const e = typeof email === "string" ? email.trim().toLowerCase().slice(0, 120) : "";
    ip = typeof ip === "string" ? ip.slice(0, 64) : "";
    // Registra antes de contar (também email sem conta). O registro guarda o hash do email digitado, não o email.
    const [l] = await sql`with r as (insert into senha_pedidos (email_hash, ip) values (${sha(e)}, ${ip}) returning id),
        d as (delete from senha_pedidos where criado < now() - interval '1 day')
      select (select count(*) from senha_pedidos where email_hash = ${sha(e)} and criado > now() - interval '1 hour')::int as por_email,
        (select count(*) from senha_pedidos where ip = ${ip} and criado > now() - interval '1 hour')::int as por_ip`;
    if (!EMAIL.test(e) || !l || l.por_email >= 3 || l.por_ip >= 10) return { mensagem: MSG_PEDIDO };
    const token = randomBytes(32).toString("base64url");
    // Numa instrução: vence os links anteriores não usados e grava o novo (só o hash). Sem conta, o insert não acha linha.
    const [u] = await sql`with v as (update senha_tokens set expira = least(expira, now()) where email = ${e} and usado_em is null and expira > now()),
        t as (insert into senha_tokens (email, hash, expira, ip) select email, ${sha(token)}, now() + interval '30 minutes', ${ip}
          from usuarios where email = ${e} returning email)
      select u.nome from usuarios u where u.email = (select email from t)`;
    if (u) {
      const link = `${site()}/#/nova-senha/${token}`;
      const texto = `Olá, ${u.nome}. Recebemos um pedido para trocar a senha da sua conta no FitWay. Para criar uma senha nova, abra o link abaixo. ` +
        `Ele vale por 30 minutos e só pode ser usado uma vez.\n\n${link}\n\nSe você não pediu isso, ignore este email: sua senha continua a mesma.`;
      const html = `<p>Olá, ${escHtml(u.nome)}.</p><p>Recebemos um pedido para trocar a senha da sua conta no FitWay. Para criar uma senha nova, ` +
        `abra o link abaixo. Ele vale por 30 minutos e só pode ser usado uma vez.</p><p><a href="${escHtml(link)}">Criar uma senha nova</a></p>` +
        `<p>Se o botão não abrir, copie este endereço: ${escHtml(link)}</p><p>Se você não pediu isso, ignore este email: sua senha continua a mesma.</p>`;
      try { await enviarEmail({ para: e, assunto: "Trocar sua senha do FitWay", texto, html }, { transporte }); }
      catch (err) { console.error("email de troca de senha:", err && err.message); }
    }
    return { mensagem: MSG_PEDIDO };
  } finally {
    await esperar(Math.max(0, piso - (agora() - inicio)));
  }
}

// Aviso depois de qualquer troca. Falha no envio não desfaz a troca.
export async function avisarTroca(para, { transporte }) {
  if (!emailDisponivel() || !transporte) return;
  const texto = "A senha da sua conta foi trocada agora há pouco. Se não foi você, responda este email ou abra um chamado no suporte.";
  try { await enviarEmail({ para, assunto: "Sua senha do FitWay foi trocada", texto, html: `<p>${escHtml(texto)}</p>` }, { transporte }); }
  catch (err) { console.error("email de aviso de troca:", err && err.message); }
}

// #/nova-senha/<token>. Numa instrução: usa o token (uma vez, dentro dos 30 min), grava a senha, vence os outros tokens,
// apaga TODAS as sessões e registra no admin_log (sem token nem senha). Devolve o usuário para o app abrir uma sessão nova.
export async function trocarPorToken(sql, { token, senha }) {
  if (typeof token !== "string" || !TOKEN.test(token)) return { status: 400, erro: MSG_LINK };
  if (!senhaValida(senha)) return { status: 400, erro: ERRO_SENHA };
  const h = sha(token);
  const [u] = await sql`with t as (update senha_tokens set usado_em = now() where hash = ${h} and usado_em is null and expira > now() returning email),
      u as (update usuarios set senha = ${senhaHash(senha)} where email = (select email from t) returning email, nome, dados, foto, acesso_ate),
      o as (update senha_tokens set expira = least(expira, now()) where email = (select email from t) and hash <> ${h} and usado_em is null),
      s as (delete from sessoes where email = (select email from t)),
      l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select email, 'senha_trocada', email, '{"via":"email"}'::jsonb from u)
    select * from u`;
  return u ? { status: 200, usuario: u } : { status: 400, erro: MSG_LINK };
}

// Perfil: exige a senha atual (até 5 erros por hora), apaga as OUTRAS sessões (sessaoHash = a atual) e vence links pendentes.
export async function alterarSenha(sql, u, { atual, nova }, sessaoHash) {
  if (!senhaValida(nova)) return { status: 400, erro: ERRO_SENHA };
  if (typeof atual !== "string" || !atual || atual.length > 100) return { status: 400, erro: "Digite a senha atual." };
  const [r] = await sql`select senha, (select count(*) from admin_log where alvo_email = ${u.email} and acao = 'senha_errada'
    and criado > now() - interval '1 hour')::int as erros from usuarios where email = ${u.email}`;
  if (!r) return { status: 401, erro: "Entre na sua conta." };
  if (r.erros >= 5) return { status: 429, erro: "Muitas tentativas com a senha errada. Espere uma hora ou use Esqueci a senha." };
  if (!confere(atual, r.senha)) {
    await sql`insert into admin_log (admin_email, acao, alvo_email, detalhes) values (${u.email}, 'senha_errada', ${u.email}, '{}'::jsonb)`;
    return { status: 400, erro: "A senha atual está incorreta." };
  }
  // "and senha = guardada": se outra troca entrou no meio, esta não sobrescreve.
  const [x] = await sql`with a as (update usuarios set senha = ${senhaHash(nova)} where email = ${u.email} and senha = ${r.senha} returning email),
      s as (delete from sessoes where email = ${u.email} and token <> ${sessaoHash} and exists (select 1 from a)),
      o as (update senha_tokens set expira = least(expira, now()) where email = ${u.email} and usado_em is null and exists (select 1 from a)),
      l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select email, 'senha_trocada', email, '{"via":"perfil"}'::jsonb from a)
    select email from a`;
  return x ? { status: 200 } : { status: 409, erro: "A senha mudou enquanto você trocava. Tente de novo." };
}
