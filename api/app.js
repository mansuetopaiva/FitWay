// Backend do FitWay: uma função Vercel, POST /api/app com { acao, ... }.
// Ações: criar, entrar, eu, salvar, sair, perfil, foto, treino, ranking, admin, termo, pedido_criar, pedido_status.
// Banco: Postgres (Neon) via DATABASE_URL.
import { neon } from "@neondatabase/serverless";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { acaoAdmin, ehAdmin } from "./_admin.js";
import { DIA, juntar, limpar } from "./_dados.js";
import { gerarSeDevido } from "./_ia.js";
import { OPCOES, PARQ, TEXTOS, criarPedido, limparPedidos } from "./_pedido.js";
import { ABERTOS, PRECOS, iaAtiva, planoVisivel, podePedir } from "./_precos.js";
import { TERMO, termoDaVersao } from "./_termo.js";
import { lerPdf } from "./_treino.js";

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
  // Data de cadastro: contas antigas ficam null (o banco não guardou a data real) e só as novas ganham now().
  // O dia desta migração vai no comentário da coluna, para o painel mostrar "Antes de DD/MM/AAAA".
  await sql`do $$ begin
    if not exists (select 1 from information_schema.columns where table_name = 'usuarios' and column_name = 'criado') then
      alter table usuarios add column if not exists criado timestamptz;
      execute format('comment on column usuarios.criado is %L', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'));
      alter table usuarios alter column criado set default now();
    end if;
  end $$`;
  await sql`alter table usuarios add column if not exists acesso_ate timestamptz`; // até quando o admin liberou o acesso (ainda não bloqueia nada)
  await sql`create table if not exists admin_log (
    id bigint generated always as identity primary key,
    admin_email text not null,
    acao text not null,
    alvo_email text,
    detalhes jsonb,
    criado timestamptz not null default now()
  )`;
  await sql`create index if not exists admin_log_alvo on admin_log (alvo_email, criado desc)`;
  await sql`create table if not exists pedidos (
    id text primary key,
    email text not null references usuarios on delete cascade,
    tipo text not null check (tipo in ('inicial', 'mensalidade', 'novo_treino')),
    status text not null check (status in ('aguardando_pagamento', 'pago', 'gerando', 'pronto', 'erro', 'cancelado')),
    valor int not null,
    metodo text,
    respostas jsonb,
    fotos jsonb,
    aceite jsonb,
    plano_gerado jsonb,
    modelo text,
    erro text,
    tentativas int not null default 0,
    criado timestamptz not null default now(),
    pago_em timestamptz,
    gerado_em timestamptz,
    atualizado timestamptz
  )`;
  await sql`create index if not exists pedidos_email_criado on pedidos (email, criado desc)`;
  await sql`create index if not exists pedidos_status on pedidos (status)`;
  // No máximo 1 pedido aberto por usuário, garantido pelo banco (dois cliques ao mesmo tempo).
  await sql`create unique index if not exists pedidos_um_aberto on pedidos (email) where status in ('aguardando_pagamento', 'pago', 'gerando')`;
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
  const [u] = await sql`select u.email, u.nome, u.dados, u.grupo, u.foto, u.acesso_ate from sessoes s join usuarios u on u.email = s.email
    where s.token = ${sha(t)} and s.expira > now()`;
  return u || null;
}
// O plano feito pela IA só sai do servidor com acesso ativo (continua guardado no banco).
const visivel = (u, dados) => {
  const d = limpar(dados);
  if (!planoVisivel({ acesso_ate: u.acesso_ate, dados: d }, new Date())) delete d.plano;
  return d;
};
const publico = (u) => ({ email: u.email, nome: u.nome, foto: u.foto || "", admin: ehAdmin(u.email), dados: visivel(u, u.dados) });
const gerar = (id) => gerarSeDevido(sql, id);

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
        // Email listado em ADMIN_EMAILS sem conta: quem cadastrasse primeiro viraria admin. A conta tem de existir antes.
        if (ehAdmin(email)) return res.status(403).json({ erro: "Este email não pode ser cadastrado por aqui." });
        [u] = await sql`insert into usuarios (email, nome, senha) values (${email}, ${nome}, ${senhaHash(b.senha)})
          on conflict do nothing returning email, nome, dados`;
        if (!u) return res.status(409).json({ erro: "Já existe uma conta com este email. Use a aba Entrar." });
      } else {
        [u] = await sql`select email, nome, senha, dados, foto, acesso_ate from usuarios where email = ${email}`;
        if (!u || !confere(b.senha, u.senha)) return res.status(401).json({ erro: "Email ou senha incorretos." });
        await sql`delete from sessoes where expira < now()`;
      }
      await abrirSessao(res, u.email);
      return res.json(publico(u));
    }

    if (b.acao === "termo") { // versão antiga serve para o admin conferir o que foi aceito
      // Com a função desligada o termo não é público (tem dados pessoais do responsável): só o admin lê.
      if (!iaAtiva()) {
        const s = await usuarioDaSessao(req);
        if (!s || !ehAdmin(s.email)) return res.status(400).json({ erro: "Em breve." });
      }
      const t = b.versao === undefined ? TERMO : termoDaVersao(b.versao);
      return t ? res.json(t) : res.status(404).json({ erro: "Versão do termo não encontrada." });
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
    if (b.acao === "admin") { const r = await acaoAdmin(sql, u, b, { gerar }); return res.status(r.status).json(r.corpo); }
    if (b.acao === "salvar") {
      const dados = juntar(limpar(u.dados), limpar(b.dados));
      // O treino é o que estiver no banco na hora da gravação, não o lido no início: assim um salvamento
      // de check-in que cruza com o admin trocando o treino não desfaz a troca.
      const [x] = await sql`update usuarios set dados = (${JSON.stringify(dados)}::jsonb - 'plano')
          || case when dados->'plano' is not null then jsonb_build_object('plano', dados->'plano') else '{}'::jsonb end
        where email = ${u.email} returning dados`;
      return res.json({ dados: visivel(u, x.dados) });
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
        return res.json({ dados: visivel(u, dados) });
      }
      const { plano, status, erro } = await lerPdf(b.pdf);
      if (!plano) return res.status(status).json({ erro });
      dados.plano = plano;
      dados.proximo = plano.treinos[0].id;
      await sql`update usuarios set dados = ${JSON.stringify(dados)}::jsonb where email = ${u.email}`;
      return res.json({ dados });
    }
    if (b.acao === "pedido_criar") {
      const r = await criarPedido(sql, u, b, req.headers, new Date(), { admin: ehAdmin(u.email) });
      return res.status(r.status).json(r.corpo);
    }
    if (b.acao === "pedido_status") {
      await limparPedidos(sql, u.email);
      // O pedido aberto vem primeiro: o admin pode reabrir um pedido antigo com "Gerar de novo".
      const ultimo = async () => (await sql`select id, tipo, status, valor, criado, pago_em, gerado_em from pedidos
        where email = ${u.email} order by status in ('aguardando_pagamento', 'pago', 'gerando') desc, criado desc limit 1`)[0] || null;
      let pedido = await ultimo(), x = u;
      // O formulário só lê as perguntas: não segura a tela esperando uma geração.
      if (b.form !== true && pedido && (pedido.status === "pago" || pedido.status === "gerando") && await gerar(pedido.id)) {
        pedido = await ultimo();
        [x] = await sql`select acesso_ate, dados from usuarios where email = ${u.email}`;
      }
      const agora = new Date(), aberto = !!pedido && ABERTOS.includes(pedido.status), plano = x.dados && x.dados.plano;
      // Função desligada (TREINO_IA_ATIVO): usuário comum não vê pedido inicial nem novo treino; renovar continua.
      const ativo = iaAtiva() || ehAdmin(u.email);
      const pode = Object.fromEntries(Object.keys(PRECOS).map((t) => [t, (ativo || t === "mensalidade") && !podePedir(t, x, agora, aberto).erro]));
      // novo_treino: o formulário vem com as últimas respostas; os consentimentos precisam ser marcados de novo.
      let ultimas = null;
      if (pode.novo_treino) {
        const [r] = await sql`select respostas from pedidos where email = ${u.email} and respostas is not null order by criado desc limit 1`;
        if (r) { ultimas = r.respostas; delete ultimas.consentimentos; }
      }
      return res.json({
        pedido, ativo, acessoAte: x.acesso_ate, temPlanoIA: !!plano && plano.origem === "ia", planoCriado: (plano && plano.criado) || null,
        pode, precos: PRECOS, termo: TERMO.versao, ultimas, plano: visivel(x, x.dados).plano || null,
        ...(b.form === true ? { form: { parq: PARQ, opcoes: OPCOES, textos: TEXTOS } } : {}),
      });
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
