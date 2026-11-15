// Backend do FitWay: uma função Vercel, POST /api/app com { acao, ... }.
// Ações: criar, entrar, eu, salvar, sair. Banco: Postgres (Neon) via DATABASE_URL.
import { neon } from "@neondatabase/serverless";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import { DIA, juntar, limpar } from "./_dados.js";
import { lerTreino } from "./_treino.js";

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
const TRINTA_DIAS = 2592000;
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 símbolos, sem 0/O e 1/I

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
  await sql`alter table usuarios add column if not exists grupo text`; // código do grupo do ranking
  await sql`alter table usuarios add column if not exists foto text`; // foto de perfil, JPEG 160x160 em data URL
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
  const [u] = await sql`select u.email, u.nome, u.dados, u.grupo, u.foto from sessoes s join usuarios u on u.email = s.email
    where s.token = ${sha(t)} and s.expira > now()`;
  return u || null;
}
const publico = (u) => ({ email: u.email, nome: u.nome, foto: u.foto || "", dados: limpar(u.dados) });

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
        [u] = await sql`select email, nome, senha, dados, foto from usuarios where email = ${email}`;
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
    // O cookie é do navegador inteiro: se alguém entrou em outra conta em outra aba, esta aba ainda acha que é
    // a conta antiga. Sem esta checagem, ela gravaria check-ins, cargas e o PDF na conta errada.
    if (b.conta !== undefined && b.conta !== u.email) return res.status(409).json({ erro: "Outra conta entrou neste navegador. Recarregando…" });
    if (b.acao === "eu") return res.json(publico(u));
    if (b.acao === "salvar") {
      const dados = juntar(limpar(u.dados), limpar(b.dados));
      await sql`update usuarios set dados = ${JSON.stringify(dados)}::jsonb where email = ${u.email}`;
      return res.json({ dados });
    }
    if (b.acao === "perfil") {
      const nome = texto(b.nome, 1, 40) ? b.nome.trim() : "";
      if (!nome) return res.status(400).json({ erro: "Digite seu nome." });
      await sql`update usuarios set nome = ${nome} where email = ${u.email}`;
      return res.json({ nome });
    }
    if (b.acao === "foto") {
      // Só aceita a imagem já reduzida pelo app; "" remove a foto.
      if (b.foto !== "" && !(texto(b.foto, 30, 60000) && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(b.foto)))
        return res.status(400).json({ erro: "Imagem inválida. Tente outra foto." });
      await sql`update usuarios set foto = ${b.foto || null} where email = ${u.email}`;
      return res.json({ foto: b.foto });
    }
    if (b.acao === "treino") {
      // Junta o que o aparelho mandou: um check-in feito sem conexão ainda não chegou ao banco.
      const dados = juntar(limpar(u.dados), limpar(b.dados));
      if (b.remover === true) {
        delete dados.plano;
        await sql`update usuarios set dados = ${JSON.stringify(dados)}::jsonb where email = ${u.email}`;
        return res.json({ dados });
      }
      const pdf = texto(b.pdf, 100, 4200000) ? Buffer.from(b.pdf, "base64") : null;
      if (!pdf || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ erro: "Envie um arquivo PDF de até 3 MB." });
      let lido, doc;
      try {
        doc = await getDocumentProxy(new Uint8Array(pdf));
        if (doc.numPages > 30) return res.status(400).json({ erro: "O PDF pode ter no máximo 30 páginas." });
        lido = (await extractText(doc, { mergePages: true })).text;
      } catch (e) { return res.status(422).json({ erro: "Não consegui abrir este PDF." }); }
      const plano = lerTreino(lido.slice(0, 200000));
      if (!plano) return res.status(422).json({ erro: "Não encontrei exercícios neste PDF. Ele precisa ter listas numeradas com séries x repetições, como “1 Supino reto 3 x 10”. PDF escaneado (foto) não funciona." });
      dados.plano = plano;
      dados.proximo = plano.treinos[0].id;
      await sql`update usuarios set dados = ${JSON.stringify(dados)}::jsonb where email = ${u.email}`;
      return res.json({ dados });
    }
    if (b.acao === "ranking") {
      // As datas vêm do aparelho (fuso da pessoa), mas só podem ser da semana e do mês atuais:
      // datas antigas permitiriam reconstruir o histórico de check-ins dos outros membros.
      const dias = (d) => (Date.now() - Date.parse(d)) / 864e5;
      if (typeof b.semana !== "string" || typeof b.mes !== "string" || !DIA.test(b.semana) || !DIA.test(b.mes)
        || !(dias(b.semana) > -2 && dias(b.semana) < 8) || !(dias(b.mes) > -2 && dias(b.mes) < 33))
        return res.status(400).json({ erro: "Requisição inválida." });
      let grupo = u.grupo;
      if (b.op === "criar") grupo = Array.from(randomBytes(6), (x) => LETRAS[x % 32]).join("");
      else if (b.op === "sair") grupo = null;
      else if (b.op === "entrar") {
        const codigo = texto(b.codigo, 6, 6) ? b.codigo.toUpperCase() : "";
        const [{ n }] = await sql`select count(*)::int as n from usuarios where grupo = ${codigo}`;
        if (!n) return res.status(404).json({ erro: "Não encontrei um grupo com este código." });
        if (n >= 50) return res.status(409).json({ erro: "Este grupo já está cheio." });
        grupo = codigo;
      }
      if (grupo !== u.grupo) await sql`update usuarios set grupo = ${grupo} where email = ${u.email}`;
      if (!grupo) return res.json({ codigo: null, membros: [] });
      // Os outros membros veem só nome e contagens, nunca o email.
      const membros = await sql`select nome, email = ${u.email} as eu,
          (select count(*) from jsonb_array_elements_text(dados->'checkins') as d(dia) where dia >= ${b.semana})::int as semana,
          (select count(*) from jsonb_array_elements_text(dados->'checkins') as d(dia) where dia >= ${b.mes})::int as mes
        from usuarios where grupo = ${grupo}`;
      return res.json({ codigo: grupo, membros });
    }
    return res.status(400).json({ erro: "Ação desconhecida." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Erro no servidor. Tente de novo." });
  }
}
