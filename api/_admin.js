// Área de administração: acao "admin" com campo "op". O "_" no nome impede a Vercel de expor este arquivo como rota.
// Recebe o sql por parâmetro para o teste provar que quem não é admin não chega a consultar o banco.

import { DIA, escaparLike, limpar, validarPlano } from "./_dados.js";
import { NOMES_FOTOS, lerPdf } from "./_treino.js";

export const OPS = ["resumo", "usuarios", "usuario", "acesso", "plano_salvar", "plano_pdf", "plano_remover"];

// Lido a cada chamada: tirar alguém da variável na Vercel vale sem depender do navegador.
export function ehAdmin(email) {
  if (typeof email !== "string" || !email) return false;
  return (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

const ok = (corpo) => ({ status: 200, corpo });
const falha = (status, erro) => ({ status, corpo: { erro } });
const emailAlvo = (v) => (typeof v === "string" && v.length >= 3 && v.length <= 120 ? v.trim().toLowerCase() : "");

// Campos de lista. shortcut: conta check-ins dentro do JSON "dados" a cada consulta; mover check-ins para uma tabela própria se passar de alguns milhares de usuários.
const linha = (x) => {
  const ck = Array.isArray(x.dados && x.dados.checkins) ? x.dados.checkins : [];
  return { nome: x.nome, email: x.email, criado: x.criado, acessoAte: x.acesso_ate, checkins: ck.length, ultimoCheckin: ck.length ? ck[ck.length - 1] : null, temTreino: !!(x.dados && x.dados.plano) };
};

export async function acaoAdmin(sql, u, b) {
  if (!ehAdmin(u && u.email)) return falha(403, "Acesso restrito.");
  if (!OPS.includes(b.op)) return falha(400, "Operação desconhecida.");

  if (b.op === "resumo") {
    // Dias contados no horário de Brasília; a semana começa no domingo, como no app.
    const [r] = await sql`with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
      select count(*)::int as usuarios,
        count(*) filter (where criado > now() - interval '7 days')::int as novos7d,
        count(*) filter (where dados->'plano' is not null)::int as com_treino,
        count(*) filter (where acesso_ate > now())::int as com_acesso,
        coalesce(sum((select count(*) from jsonb_array_elements_text(coalesce(dados->'checkins', '[]')) c(dia)
          where dia = to_char((select d from hoje), 'YYYY-MM-DD'))), 0)::int as checkins_hoje,
        coalesce(sum((select count(*) from jsonb_array_elements_text(coalesce(dados->'checkins', '[]')) c(dia)
          where dia >= to_char((select d - extract(dow from d)::int from hoje), 'YYYY-MM-DD'))), 0)::int as checkins_semana,
        col_description('usuarios'::regclass, (select attnum from pg_attribute where attrelid = 'usuarios'::regclass and attname = 'criado')) as cadastro_antes
      from usuarios`;
    return ok({ usuarios: r.usuarios, novos7d: r.novos7d, comTreino: r.com_treino, comAcesso: r.com_acesso,
      checkinsHoje: r.checkins_hoje, checkinsSemana: r.checkins_semana, cadastroAntes: r.cadastro_antes || "" });
  }

  if (b.op === "usuarios") {
    const busca = typeof b.busca === "string" ? b.busca.trim().slice(0, 80) : "";
    const pagina = Number.isInteger(b.pagina) && b.pagina >= 0 && b.pagina <= 500 ? b.pagina : 0;
    const q = "%" + escaparLike(busca) + "%";
    const xs = await sql`select nome, email, criado, acesso_ate, dados from usuarios
      where nome ilike ${q} or email ilike ${q}
      order by criado desc nulls last, email limit 21 offset ${pagina * 20}`;
    return ok({ itens: xs.slice(0, 20).map(linha), temMais: xs.length > 20 });
  }

  const alvo = emailAlvo(b.email);
  if (!alvo) return falha(400, "Informe o email do usuário.");
  const naoExiste = async () => !(await sql`select 1 from usuarios where email = ${alvo}`).length;

  if (b.op === "usuario") {
    const [x] = await sql`select nome, email, criado, acesso_ate, dados, grupo from usuarios where email = ${alvo}`;
    if (!x) return falha(404, "Usuário não encontrado.");
    const historico = await sql`select criado, admin_email, acao, detalhes from admin_log where alvo_email = ${alvo} order by criado desc limit 20`;
    const d = limpar(x.dados);
    return ok({ ...linha(x), plano: d.plano || null, sessoes: d.sessoes, grupo: x.grupo || null, historico, nomes: NOMES_FOTOS });
  }

  // Cada escrita e o seu registro no admin_log vão numa única instrução: nunca há alteração sem log.
  if (b.op === "acesso") {
    const formas = ["dias", "ate", "cortar"].filter((k) => b[k] !== undefined);
    if (formas.length !== 1) return falha(400, "Escolha uma forma: dias, data ou cortar.");
    let x;
    if (b.dias !== undefined) {
      if (!Number.isInteger(b.dias) || b.dias < 1 || b.dias > 365) return falha(400, "Os dias precisam ser um número inteiro de 1 a 365.");
      [x] = await sql`with a as (update usuarios set acesso_ate = greatest(now(), coalesce(acesso_ate, now())) + make_interval(days => ${b.dias})
          where email = ${alvo} returning email, acesso_ate),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select ${u.email}, 'acesso', email, ${JSON.stringify({ dias: b.dias })}::jsonb from a)
        select acesso_ate from a`;
    } else if (b.ate !== undefined) {
      if (typeof b.ate !== "string" || !DIA.test(b.ate) || new Date(b.ate + "T00:00:00Z").toISOString().slice(0, 10) !== b.ate)
        return falha(400, "Data inválida.");
      // Fim do dia escolhido no horário de Brasília = início do dia seguinte lá, independente do fuso do servidor.
      [x] = await sql`with a as (update usuarios set acesso_ate = ((${b.ate}::date + 1)::timestamp at time zone 'America/Sao_Paulo')
          where email = ${alvo} and ${b.ate}::date between (now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date + 730
          returning email, acesso_ate),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select ${u.email}, 'acesso', email, ${JSON.stringify({ ate: b.ate })}::jsonb from a)
        select acesso_ate from a`;
      if (!x && !(await naoExiste())) return falha(400, "A data precisa ser de hoje até daqui a 2 anos.");
    } else {
      if (b.cortar !== true) return falha(400, "Requisição inválida.");
      [x] = await sql`with a as (update usuarios set acesso_ate = now() where email = ${alvo} returning email, acesso_ate),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select ${u.email}, 'acesso', email, '{"cortar":true}'::jsonb from a)
        select acesso_ate from a`;
    }
    if (!x) return falha(404, "Usuário não encontrado.");
    return ok({ acessoAte: x.acesso_ate });
  }

  // Treino: só a chave "plano" (e "proximo", se apontar para um treino que sumiu) muda dentro de "dados";
  // check-ins, cargas e sessões ficam como estão.
  let plano = null;
  if (b.op === "plano_salvar") {
    const v = validarPlano(b.plano);
    if (v.erro) return falha(400, v.erro);
    plano = v.plano;
  } else if (b.op === "plano_pdf") {
    const r = await lerPdf(b.pdf);
    if (!r.plano) return falha(r.status, r.erro);
    plano = r.plano;
  }
  let x;
  if (plano) {
    const ids = plano.treinos.map((t) => t.id);
    const det = { treinos: ids.length, exercicios: plano.treinos.reduce((s, t) => s + t.exercicios.length, 0) };
    [x] = await sql`with a as (update usuarios set dados = jsonb_set(dados, '{plano}', ${JSON.stringify(plano)}::jsonb)
          || case when dados->>'proximo' = any(${ids}::text[]) then '{}'::jsonb else jsonb_build_object('proximo', ${ids[0]}::text) end
          where email = ${alvo} returning email),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select ${u.email}, ${b.op}, email, ${JSON.stringify(det)}::jsonb from a)
        select email from a`;
  } else {
    [x] = await sql`with a as (update usuarios set dados = dados - 'plano' where email = ${alvo} returning email),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes) select ${u.email}, 'plano_remover', email, '{}'::jsonb from a)
        select email from a`;
  }
  if (!x) return falha(404, "Usuário não encontrado.");
  return ok({ plano });
}
