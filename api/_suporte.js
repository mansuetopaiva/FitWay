// Suporte por chamados (docs/suporte.md). O "_" impede a Vercel de expor como rota. Recebe sql por parâmetro para o teste.
// Toda instrução do aluno filtra por "email = u.email" no próprio SQL: um id de outra conta simplesmente não é achado.
import { randomBytes } from "node:crypto";

export const ACOES = ["suporte", "suporte_aviso", "chamado_abrir", "chamado", "chamado_anexo", "chamado_responder", "chamado_encerrar"];
export const ASSUNTOS = ["pagamento", "treino", "conta", "app"];
const STATUS = ["aberto", "respondido", "fechado"];
const MAX_ABERTOS = 3, MAX_HORA = 10, // os mesmos números estão escritos no SQL
  MAX_TEXTO = 2000, MAX_ANEXO = 410000; // ~300 KB de imagem em base64

const ok = (corpo) => ({ status: 200, corpo });
const falha = (status, erro) => ({ status, corpo: { erro } });
const idValido = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v);
const msgValida = (v) => Number.isSafeInteger(v) && v > 0;
// "depois_de": id da última mensagem que a tela já tem (a atualização automática busca só as novas). Ausente = todas.
const depoisDe = (v) => (v === undefined ? 0 : Number.isSafeInteger(v) && v >= 0 ? v : -1);
// Texto do usuário: aparado, 1 a 2000 caracteres. Sempre mostrado escapado (esc + pre-wrap), nunca como HTML.
const textoDe = (v) => (typeof v === "string" && v.trim().length >= 1 && v.trim().length <= MAX_TEXTO ? v.trim() : "");
// Só JPEG em data URL, com a assinatura FF D8 FF ("/9j/" em base64): nada de SVG, HTML ou outro tipo.
export const anexoValido = (v) => typeof v === "string" && v.length <= MAX_ANEXO && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*=*$/.test(v);
// Sem anexo: undefined, null ou "". Inválido: false.
const anexoDe = (v) => (v === undefined || v === null || v === "" ? null : anexoValido(v) ? v : false);
const ERRO_TEXTO = `Escreva a mensagem (até ${MAX_TEXTO} caracteres).`;
const ERRO_ANEXO = "Imagem inválida. Tente outra (JPEG).";
const ERRO_HORA = `Você mandou ${MAX_HORA} mensagens na última hora. Espere um pouco e tente de novo.`;
const ERRO_IMAGENS = "Limite de imagens de hoje atingido (cerca de 2 MB). Mande só o texto ou tente amanhã.";
const naoAchou = () => falha(404, "Chamado não encontrado.");

// Há resposta do admin que o aluno ainda não viu (ponto de aviso no Perfil e na aba).
export async function naoLido(sql, email) {
  const [x] = await sql`select exists (select 1 from chamados c join chamado_mensagens m on m.chamado_id = c.id
    where c.email = ${email} and m.autor = 'admin' and m.criado > coalesce(c.lido_aluno_em, '-infinity'::timestamptz)) as n`;
  return !!(x && x.n);
}

// Prazos, sem cron: roda na lista do aluno, no resumo e na lista do admin. email null = todos.
export async function limparChamados(sql, email) {
  const [f] = await sql`with x as (update chamados set status = 'fechado', fechado_em = now()
    where (${email}::text is null or email = ${email}) and status = 'respondido' and atualizado < now() - interval '7 days' returning 1)
    select count(*)::int as n from x`;
  const [a] = await sql`with x as (update chamado_mensagens set anexo = null where anexo is not null and chamado_id in (select id from chamados
    where (${email}::text is null or email = ${email}) and status = 'fechado' and fechado_em < now() - interval '90 days') returning 1)
    select count(*)::int as n from x`;
  return { fechados: (f && f.n) || 0, anexos: (a && a.n) || 0 };
}

export async function acaoSuporte(sql, u, b) {
  const email = u.email;
  if (b.acao === "suporte") {
    await limparChamados(sql, email);
    const chamados = await sql`select c.id, c.assunto, c.status, c.pedido_id, c.criado, c.atualizado,
        (select max(criado) from chamado_mensagens m where m.chamado_id = c.id) as ultima,
        exists (select 1 from chamado_mensagens m where m.chamado_id = c.id and m.autor = 'admin'
          and m.criado > coalesce(c.lido_aluno_em, '-infinity'::timestamptz)) as nao_lido
      from chamados c where c.email = ${email} order by c.atualizado desc limit 50`;
    const pedidos = await sql`select id, codigo, tipo, valor, status, criado from pedidos where email = ${email} order by criado desc limit 20`;
    return ok({ chamados, pedidos, naoLido: chamados.some((c) => c.nao_lido) });
  }

  if (b.acao === "suporte_aviso") return ok({ naoLido: await naoLido(sql, email) }); // a cada 30 s no Perfil: só o ponto

  if (b.acao === "chamado_abrir") {
    const assunto = typeof b.assunto === "string" && ASSUNTOS.includes(b.assunto) ? b.assunto : "";
    const texto = textoDe(b.texto), anexo = anexoDe(b.anexo);
    const pid = b.pedido_id === undefined || b.pedido_id === null || b.pedido_id === "" ? null : idValido(b.pedido_id) ? b.pedido_id : false;
    if (!assunto) return falha(400, "Escolha o assunto.");
    if (!texto) return falha(400, ERRO_TEXTO);
    if (anexo === false) return falha(400, ERRO_ANEXO);
    if (pid === false) return falha(400, "Pedido inválido.");
    const id = randomBytes(12).toString("base64url");
    // Os limites e a posse do pedido vão dentro do INSERT.
    // shortcut: dois envios exatamente simultâneos podem passar 1 do limite; travar a linha do usuário se virar abuso.
    const [x] = await sql`with c as (insert into chamados (id, email, assunto, pedido_id)
          select ${id}, ${email}, ${assunto}, (select id from pedidos where id = ${pid}::text and email = ${email})
          where (select count(*) from chamados where email = ${email} and status in ('aberto', 'respondido')) < 3
            and (select count(*) from chamado_mensagens m join chamados k on k.id = m.chamado_id
              where k.email = ${email} and m.autor = 'aluno' and m.criado > now() - interval '1 hour') < 10
            and (${pid}::text is null or exists (select 1 from pedidos where id = ${pid}::text and email = ${email}))
            and (select count(*) from chamados where email = ${email} and criado > now() - interval '1 day') < 5
            and (${anexo}::text is null or (select coalesce(sum(length(m.anexo)), 0) from chamado_mensagens m join chamados k on k.id = m.chamado_id
              where k.email = ${email} and m.autor = 'aluno' and m.criado > now() - interval '1 day') + length(${anexo}::text) <= 2000000)
          returning id),
        m as (insert into chamado_mensagens (chamado_id, autor, texto, anexo) select id, 'aluno', ${texto}, ${anexo}::text from c)
      select id from c`;
    if (x) return ok({ id: x.id });
    const [d] = await sql`select (select count(*) from chamados where email = ${email} and status in ('aberto', 'respondido'))::int as abertos,
        (select count(*) from chamado_mensagens m join chamados k on k.id = m.chamado_id
          where k.email = ${email} and m.autor = 'aluno' and m.criado > now() - interval '1 hour')::int as hora,
        (${pid}::text is null or exists (select 1 from pedidos where id = ${pid}::text and email = ${email})) as pedido_ok,
        (select count(*) from chamados where email = ${email} and criado > now() - interval '1 day')::int as hoje`;
    if (d && !d.pedido_ok) return falha(404, "Pedido não encontrado.");
    if (d && d.abertos >= MAX_ABERTOS) return falha(429, `Você já tem ${MAX_ABERTOS} chamados em andamento. Encerre um deles ou aguarde a resposta.`);
    if (d && d.hora >= MAX_HORA) return falha(429, ERRO_HORA);
    if (d && d.hoje >= 5) return falha(429, "Você abriu 5 chamados hoje. Continue pelos que já estão abertos ou tente amanhã.");
    return falha(429, ERRO_IMAGENS);
  }

  if (!idValido(b.id)) return falha(400, "Chamado inválido.");
  const id = b.id;

  if (b.acao === "chamado") {
    const depois = depoisDe(b.depois_de);
    if (depois < 0) return falha(400, "Requisição inválida.");
    // Abrir a conversa (e cada atualização com ela aberta) marca as respostas como lidas.
    const [c] = await sql`update chamados set lido_aluno_em = now() where id = ${id} and email = ${email}
      returning id, assunto, status, pedido_id, criado, atualizado, fechado_em`;
    if (!c) return naoAchou();
    // Sem o anexo (só se existe) e sem o email de quem respondeu.
    const mensagens = await sql`select id, autor, texto, anexo is not null as anexo, criado from chamado_mensagens
      where chamado_id = ${id} and id > ${depois} order by id`;
    return ok({ chamado: c, mensagens, naoLido: await naoLido(sql, email) });
  }

  if (b.acao === "chamado_anexo") {
    if (!msgValida(b.msg)) return falha(400, "Mensagem inválida.");
    const [m] = await sql`select m.anexo from chamado_mensagens m join chamados c on c.id = m.chamado_id
      where c.id = ${id} and c.email = ${email} and m.id = ${b.msg} and m.anexo is not null`;
    return m ? ok({ anexo: m.anexo }) : falha(404, "Imagem não encontrada (pode ter sido apagada 90 dias depois do encerramento).");
  }

  if (b.acao === "chamado_responder") {
    const texto = textoDe(b.texto), anexo = anexoDe(b.anexo);
    if (!texto) return falha(400, ERRO_TEXTO);
    if (anexo === false) return falha(400, ERRO_ANEXO);
    const [x] = await sql`with c as (update chamados set status = 'aberto', atualizado = now(), lido_aluno_em = now()
          where id = ${id} and email = ${email} and status <> 'fechado'
            and (select count(*) from chamado_mensagens m join chamados k on k.id = m.chamado_id
              where k.email = ${email} and m.autor = 'aluno' and m.criado > now() - interval '1 hour') < 10
            and (${anexo}::text is null or (select coalesce(sum(length(m.anexo)), 0) from chamado_mensagens m join chamados k on k.id = m.chamado_id
              where k.email = ${email} and m.autor = 'aluno' and m.criado > now() - interval '1 day') + length(${anexo}::text) <= 2000000)
          returning id),
        m as (insert into chamado_mensagens (chamado_id, autor, texto, anexo) select id, 'aluno', ${texto}, ${anexo}::text from c returning id)
      select id from m`;
    if (x) return ok({ status: "aberto" });
    const [d] = await sql`select status from chamados where id = ${id} and email = ${email}`;
    if (!d) return naoAchou();
    if (d.status === "fechado") return falha(400, "Este chamado foi encerrado. Abra um novo chamado.");
    return falha(429, anexo ? `${ERRO_HORA} ${ERRO_IMAGENS}` : ERRO_HORA);
  }

  if (b.acao === "chamado_encerrar") {
    const [c] = await sql`update chamados set fechado_em = case when status = 'fechado' then fechado_em else now() end,
        atualizado = case when status = 'fechado' then atualizado else now() end, status = 'fechado'
      where id = ${id} and email = ${email} returning status`;
    return c ? ok({ status: "fechado" }) : naoAchou();
  }
  return falha(400, "Ação desconhecida.");
}

// ---------- admin (chamado por acaoAdmin, que já conferiu ehAdmin) ----------
export const OPS_ADMIN = ["suporte_lista", "suporte_chamado", "suporte_responder", "suporte_encerrar", "suporte_reabrir", "suporte_anexo"];
const paginaValida = (p) => p === undefined || (Number.isInteger(p) && p >= 0 && p <= 100000);

export async function acaoAdminSuporte(sql, u, b) {
  if (b.op === "suporte_lista") {
    const status = b.status === undefined ? "" : b.status, assunto = b.assunto === undefined ? "" : b.assunto;
    if (status !== "" && !STATUS.includes(status)) return falha(400, "Status inválido.");
    if (assunto !== "" && !ASSUNTOS.includes(assunto)) return falha(400, "Assunto inválido.");
    if (!paginaValida(b.pagina)) return falha(400, "Página inválida.");
    await limparChamados(sql, null);
    // Aguardando resposta primeiro, do mais antigo; depois os outros, do mais recente.
    const xs = await sql`select c.id, c.assunto, c.status, c.criado, c.atualizado, c.email, u.nome,
        left(split_part((select texto from chamado_mensagens m where m.chamado_id = c.id order by m.id limit 1), chr(10), 1), 80) as resumo,
        exists (select 1 from chamado_mensagens m where m.chamado_id = c.id and m.autor = 'aluno'
          and m.criado > coalesce(c.lido_admin_em, '-infinity'::timestamptz)) as nao_lido
      from chamados c join usuarios u on u.email = c.email
      where (${status} = '' or c.status = ${status}) and (${assunto} = '' or c.assunto = ${assunto})
      order by c.status = 'aberto' desc, case when c.status = 'aberto' then c.atualizado end asc, c.atualizado desc, c.id
      limit 21 offset ${(b.pagina || 0) * 20}`;
    return ok({ itens: xs.slice(0, 20), temMais: xs.length > 20 });
  }
  if (!idValido(b.id)) return falha(400, "Chamado inválido.");
  const id = b.id;

  if (b.op === "suporte_chamado") {
    const depois = depoisDe(b.depois_de);
    if (depois < 0) return falha(400, "Requisição inválida.");
    const [c] = await sql`with c as (update chamados set lido_admin_em = now() where id = ${id}
          returning id, email, assunto, status, pedido_id, criado, atualizado, fechado_em)
      select c.*, u.nome, u.acesso_ate, u.dados->'plano'->>'nome' as plano_nome, u.dados->'plano'->>'origem' as plano_origem,
        p.codigo as pedido_codigo, p.tipo as pedido_tipo, p.status as pedido_status, p.valor as pedido_valor
      from c join usuarios u on u.email = c.email left join pedidos p on p.id = c.pedido_id`;
    if (!c) return naoAchou();
    const mensagens = await sql`select id, autor, admin_email, texto, anexo is not null as anexo, criado from chamado_mensagens
      where chamado_id = ${id} and id > ${depois} order by id`;
    return ok({ chamado: c, mensagens });
  }

  if (b.op === "suporte_responder") {
    const texto = textoDe(b.texto);
    if (!texto) return falha(400, ERRO_TEXTO);
    // Mensagem, status e log numa instrução. O log guarda só o tamanho, não o texto.
    const [x] = await sql`with c as (update chamados set status = 'respondido', atualizado = now(), lido_admin_em = now()
          where id = ${id} and status <> 'fechado' returning id, email),
        m as (insert into chamado_mensagens (chamado_id, autor, admin_email, texto) select id, 'admin', ${u.email}, ${texto} from c),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes)
          select ${u.email}, 'suporte_responder', email, jsonb_build_object('chamado', id, 'tamanho', ${texto.length}::int) from c)
      select 'respondido' as status from c`;
    return x ? ok({ status: x.status }) : falha(400, "Chamado não encontrado ou encerrado (reabra para responder).");
  }

  if (b.op === "suporte_encerrar" || b.op === "suporte_reabrir") {
    const fechar = b.op === "suporte_encerrar";
    const [x] = await sql`with c as (update chamados set status = ${fechar ? "fechado" : "aberto"}, atualizado = now(),
            fechado_em = case when ${fechar}::boolean then now() end
          where id = ${id} and (status = 'fechado') = ${!fechar}::boolean returning id, email, status),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes)
          select ${u.email}, ${fechar ? "suporte_encerrar" : "suporte_reabrir"}, email, jsonb_build_object('chamado', id) from c)
      select status from c`;
    return x ? ok({ status: x.status }) : falha(400, fechar ? "Este chamado já está encerrado." : "Este chamado não está encerrado.");
  }

  if (b.op === "suporte_anexo") {
    if (!msgValida(b.msg)) return falha(400, "Mensagem inválida.");
    // A imagem pode ter dado pessoal: ver fica registrado.
    const [m] = await sql`with m as (select m.anexo, c.email, c.id from chamado_mensagens m join chamados c on c.id = m.chamado_id
          where c.id = ${id} and m.id = ${b.msg} and m.anexo is not null),
        l as (insert into admin_log (admin_email, acao, alvo_email, detalhes)
          select ${u.email}, 'suporte_anexo_ver', email, jsonb_build_object('chamado', id, 'mensagem', ${b.msg}::bigint) from m)
      select anexo from m`;
    return m ? ok({ anexo: m.anexo }) : falha(404, "Imagem não encontrada (pode ter sido apagada 90 dias depois do encerramento).");
  }
  return falha(400, "Operação desconhecida.");
}
