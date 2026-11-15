// Backend do Firme: uma função Vercel, POST /api/app com { acao, ... }.
// Ações: criar, entrar, eu, salvar, sair. Banco: Postgres (Neon) via DATABASE_URL.
import { neon } from "@neondatabase/serverless";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { juntar, limpar } from "./_dados.js";

const sql = neon(process.env.DATABASE_URL);
const TRINTA_DIAS = 2592000;

// Cria as tabelas na primeira chamada de cada instância; não precisa rodar SQL à mão.
let pronto;
const schema = () => pronto ||= (async () => {
  await sql`create table if not exists usuarios (
    email text primary key,
    nome text not null,
    senha text not null,
    dados jsonb not null default '{}'
  )`;
  await sql`create table if not exists sessoes (
    token text primary key,
    email text not null references usuarios on delete cascade,
    expira timestamptz not null
  )`;
})().catch((e) => { pronto = null; throw e; });

const sha = (t) => createHash("sha256").update(t).digest("hex");
const cookie = (t, idade) => `mt=${t}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${idade}`;
const senhaHash = (senha, salt = randomBytes(16).toString("hex")) => `${salt}:${scryptSync(senha, salt, 32).toString("hex")}`;
const confere = (senha, guardada) => {
  const feita = Buffer.from(senhaHash(senha, guardada.split(":")[0])), certa = Buffer.from(guardada);
  return feita.length === certa.length && timingSafeEqual(feita, certa);
};
const texto = (v, min, max) => typeof v === "string" && v.length >= min && v.length <= max;

// O banco guarda só o hash do token: um vazamento do banco não entrega sessões abertas.
async function abrirSessao(res, email) {
  const t = randomBytes(32).toString("hex");
  await sql`insert into sessoes (token, email, expira) values (${sha(t)}, ${email}, now() + interval '30 days')`;
  res.setHeader("Set-Cookie", cookie(t, TRINTA_DIAS));
}
async function usuarioDaSessao(req) {
  const t = req.cookies && req.cookies.mt;
  if (!texto(t, 64, 64)) return null;
  const [u] = await sql`select u.email, u.nome, u.dados from sessoes s join usuarios u on u.email = s.email
    where s.token = ${sha(t)} and s.expira > now()`;
  return u || null;
}
const publico = (u) => ({ email: u.email, nome: u.nome, dados: limpar(u.dados) });

export default async function handler(req, res) {
  try {
    // Só JSON por POST: junto com SameSite=Strict, impede outro site de agir em nome do usuário.
    if (req.method !== "POST" || !/^application\/json/.test(req.headers["content-type"] || ""))
      return res.status(405).json({ erro: "Requisição inválida." });
    const b = req.body && typeof req.body === "object" ? req.body : {};
    await schema();

    if (b.acao === "criar" || b.acao === "entrar") {
      const email = texto(b.email, 3, 120) ? b.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: "Digite um email válido, como nome@exemplo.com." });
      if (!texto(b.senha, 6, 100)) return res.status(400).json({ erro: "A senha precisa ter pelo menos 6 caracteres." });
      let u;
      if (b.acao === "criar") {
        const nome = texto(b.nome, 1, 40) ? b.nome.trim() : "";
        if (!nome) return res.status(400).json({ erro: "Digite seu nome." });
        [u] = await sql`insert into usuarios (email, nome, senha) values (${email}, ${nome}, ${senhaHash(b.senha)})
          on conflict do nothing returning email, nome, dados`;
        if (!u) return res.status(409).json({ erro: "Já existe uma conta com este email. Use a aba Entrar." });
      } else {
        [u] = await sql`select email, nome, senha, dados from usuarios where email = ${email}`;
        if (!u || !confere(b.senha, u.senha)) return res.status(401).json({ erro: "Email ou senha incorretos." });
        await sql`delete from sessoes where expira < now()`;
      }
      await abrirSessao(res, u.email);
      return res.json(publico(u));
    }

    if (b.acao === "sair") {
      const t = req.cookies && req.cookies.mt;
      if (texto(t, 64, 64)) await sql`delete from sessoes where token = ${sha(t)}`;
      res.setHeader("Set-Cookie", cookie("", 0));
      return res.json({});
    }

    const u = await usuarioDaSessao(req);
    if (!u) return res.status(401).json({ erro: "Entre na sua conta." });
    if (b.acao === "eu") return res.json(publico(u));
    if (b.acao === "salvar") {
      const dados = juntar(limpar(u.dados), limpar(b.dados));
      await sql`update usuarios set dados = ${JSON.stringify(dados)}::jsonb where email = ${u.email}`;
      return res.json({ dados });
    }
    return res.status(400).json({ erro: "Ação desconhecida." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Erro no servidor. Tente de novo." });
  }
}
