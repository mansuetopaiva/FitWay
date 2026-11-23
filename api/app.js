// Backend do FitWay: uma função Vercel, POST /api/app com { acao, ... }.
// Ações: criar, entrar, privacidade e senha_* (públicas; docs/senha.md), senha_alterar, eu, salvar, sair, perfil, foto, treino, ranking, admin, termo, pedido_criar, pedido_status
// e as de pagamento (api/_pagamento.js) e de suporte (api/_suporte.js). O webhook do InfinitePay é outra função: api/infinitepay.js.
// Banco: Postgres (Neon) via DATABASE_URL.
import { neon } from "@neondatabase/serverless";
import { createHash, randomBytes } from "node:crypto";
import { acaoAdmin, ehAdmin } from "./_admin.js";
import { DIA, hojeBR, juntar, limpar } from "./_dados.js";
import { gerarSeDevido } from "./_ia.js";
import { ACOES as ACOES_PAGAMENTO, acaoPagamento } from "./_pagamento.js";
import { LETRAS, OPCOES, PARQ, TEXTOS, criarPedido, limparPedidos } from "./_pedido.js";
import { ABERTOS, PRECOS, iaAtiva, planoVisivel, podePedir } from "./_precos.js";
import { TERMO_VERSAO, montarTermo, termoFaltando } from "./_termo.js";
import { montarPrivacidade } from "./_privacidade.js";
import { ACOES as ACOES_SUPORTE, acaoSuporte, naoLido } from "./_suporte.js";
import { ERRO_SENHA, alterarSenha, avisarTroca, confere, pedirLink, senhaHash, senhaValida, trocarPorToken, verToken } from "./_senha.js";
import { emailDisponivel, mensagemIndisponivel, transporteGmail } from "./_email.js";
import { lerPdf } from "./_treino.js";
import { ipDe } from "./_ip.js";
import { limparFotoPerfil } from "./_foto.js";
import { MSG_LOGIN, reservar, reservarCadastro, reservarGrupo, zerar, zerarGrupo } from "./_login.js";

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
const TRINTA_DIAS = 2592000;
const ERRO_CADASTRO = "Não foi possível criar a conta com este email. Se você já tem conta, use a aba Entrar ou Esqueci a senha.";
import { garantirSchema } from "./_schema.js";
let pronto;
const schema = () => pronto ||= garantirSchema(sql).catch((e) => { pronto = null; throw e; }); // na primeira chamada de cada instância (api/_schema.js)

const sha = (t) => createHash("sha256").update(t).digest("hex");
const cookie = (t, idade) => `mt=${t}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${idade}`;
// Hash fixo (sal + resumo no formato de senhaHash) para o login sem conta: confere() faz o mesmo scrypt de uma conta de verdade e
// nunca bate. Sem cálculo na partida, e a primeira tentativa de cada instância custa o mesmo que as outras.
const HASH_FALSO = () => "6a1f0c9e5b7d4a328c91e0f4b6d2a753:" + "0".repeat(64);
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
  const [u] = await sql`select u.email, u.nome, u.dados, u.grupo, u.acesso_ate from sessoes s join usuarios u on u.email = s.email
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
      if (!senhaValida(b.senha)) return res.status(400).json({ erro: ERRO_SENHA });
      let u;
      if (b.acao === "criar") {
        const nome = texto(b.nome, 1, 40) ? b.nome.trim() : "";
        if (!nome) return res.status(400).json({ erro: "Digite seu nome." });
        // Email listado em ADMIN_EMAILS sem conta: quem cadastrasse primeiro viraria admin. A conta tem de existir antes.
        // A recusa é a mesma do email que já tem conta (mesmo status e texto): não revela quais emails são de admin.
        if (!(await reservarCadastro(sql, ipDe(req.headers)))) return res.status(400).json({ erro: ERRO_CADASTRO }); // limite por IP: a mesma recusa de qualquer outro motivo
        const hash = senhaHash(b.senha); // sempre, antes de qualquer recusa: o tempo da resposta não separa email de admin de email comum
        if (ehAdmin(email)) return res.status(400).json({ erro: ERRO_CADASTRO });
        [u] = await sql`insert into usuarios (email, nome, senha) values (${email}, ${nome}, ${hash})
          on conflict do nothing returning email, nome, dados`;
        if (!u) return res.status(400).json({ erro: ERRO_CADASTRO });
      } else {
        const liberado = await reservar(sql, email, ipDe(req.headers), ehAdmin(email)); // antes de conferir a senha: a tentativa já conta
        [u] = await sql`select email, nome, senha, dados, foto, acesso_ate from usuarios where email = ${email}`;
        // Sem conta, confere contra um hash falso: o tempo é o mesmo do email com conta (e o do bloqueio, que também confere).
        const certa = confere(b.senha, u ? u.senha : HASH_FALSO()) && !!u;
        // Senha errada, conta inexistente e bloqueio: a mesma resposta, para não revelar quais contas existem nem qual está bloqueada.
        if (!liberado || !certa) return res.status(401).json({ erro: MSG_LOGIN });
        await zerar(sql, email);
        await sql`delete from sessoes where expira < now()`;
      }
      await abrirSessao(res, u.email);
      return res.json({ ...publico(u), suporteNaoLido: await naoLido(sql, u.email) });
    }

    if (b.acao === "privacidade") return res.json(montarPrivacidade()); // pública: vale para o app inteiro

    // Esqueci a senha (sem login). A resposta do pedido é sempre a mesma, com ou sem conta.
    if (b.acao === "senha_disponivel") return res.json(emailDisponivel() ? { disponivel: true } : { disponivel: false, mensagem: mensagemIndisponivel() });
    if (b.acao === "senha_pedir") return res.json(await pedirLink(sql, { email: b.email, ip: ipDe(req.headers) }, { transporte: transporteGmail() }));
    if (b.acao === "senha_conta") { const e = await verToken(sql, b.token); return e ? res.json({ email: e }) : res.status(400).json({ erro: "Este link não vale mais. Peça um novo em Esqueci a senha." }); }
    if (b.acao === "senha_nova") {
      const r = await trocarPorToken(sql, { token: b.token, senha: b.senha });
      if (!r.usuario) return res.status(r.status).json({ erro: r.erro });
      await avisarTroca(r.usuario.email, { transporte: transporteGmail() });
      // A senha já mudou e o link já foi usado: se a sessão nova falhar, avisa para entrar com a senha nova.
      try { await abrirSessao(res, r.usuario.email); } // as sessões antigas já foram apagadas; esta é a do aparelho atual
      catch (e) { console.error(e); return res.json({ semSessao: true, mensagem: "Senha trocada. Entre com a senha nova." }); }
      return res.json({ ...publico(r.usuario), suporteNaoLido: await naoLido(sql, r.usuario.email) });
    }

    if (b.acao === "termo") { // versão antiga serve para o admin conferir o que foi aceito
      // Com a função desligada o termo não é público (tem dados pessoais do responsável): só o admin lê.
      if (!iaAtiva()) {
        const s = await usuarioDaSessao(req);
        if (!s || !ehAdmin(s.email)) return res.status(400).json({ erro: "Em breve." });
      }
      const t = montarTermo(b.versao === undefined ? TERMO_VERSAO : b.versao);
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
    if (b.conta !== undefined && b.conta !== u.email) return res.status(409).json({ erro: "Outra conta entrou neste navegador. Recarregando…", trocaConta: true });
    if (b.acao === "eu") { // a foto (até ~110 KB) não vem em toda requisição: só aqui e no login
      const [f] = await sql`select foto from usuarios where email = ${u.email}`;
      return res.json({ ...publico({ ...u, foto: f && f.foto }), suporteNaoLido: await naoLido(sql, u.email) });
    }
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
    if (b.acao === "senha_alterar") {
      const r = await alterarSenha(sql, u, { atual: b.atual, nova: b.nova }, sha(req.cookies.mt));
      if (r.status !== 200) return res.status(r.status).json({ erro: r.erro });
      await avisarTroca(u.email, { transporte: transporteGmail() });
      return res.json({});
    }
    if (b.acao === "perfil") {
      const nome = texto(b.nome, 1, 40) ? b.nome.trim() : "";
      if (!nome) return res.status(400).json({ erro: "Digite seu nome." });
      await sql`update usuarios set nome = ${nome} where email = ${u.email}`;
      return res.json({ nome });
    }
    if (b.acao === "foto") {
      // "" remove. Senão: JPEG quadrado já recortado pelo app; o servidor confere de novo e grava a versão sem metadados.
      if (b.foto === "") { await sql`update usuarios set foto = null where email = ${u.email}`; return res.json({ foto: "" }); }
      const r = limparFotoPerfil(b.foto);
      if (r.erro) return res.status(400).json({ erro: r.erro });
      await sql`update usuarios set foto = ${r.foto} where email = ${u.email}`;
      return res.json({ foto: r.foto });
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
    if (ACOES_SUPORTE.includes(b.acao)) { // vale para o app inteiro, com ou sem TREINO_IA_ATIVO
      const r = await acaoSuporte(sql, u, b);
      return res.status(r.status).json(r.corpo);
    }
    if (ACOES_PAGAMENTO.includes(b.acao)) {
      const r = await acaoPagamento(sql, u, b);
      return res.status(r.status).json(r.corpo);
    }
    if (b.acao === "pedido_status") {
      // Poll de 4 s enquanto o pedido espera o treino: só o status (sem plano, sem listas). A resposta completa vem quando o pedido
      // deixa de esperar (pronto, erro...), uma vez. Sem limpeza de prazos aqui (o cron e as outras chamadas cuidam).
      if (b.poll === true) {
        const [p] = await sql`select id, status from pedidos where email = ${u.email} order by status = any(${ABERTOS}) desc, criado desc limit 1`;
        if (p && (p.status === "pago" || p.status === "gerando") && !(await gerar(p.id))) return res.json({ poll: true, pedido: { id: p.id, status: p.status } });
      } else await limparPedidos(sql, u.email);
      // Tudo numa consulta: o pedido aberto primeiro (o admin pode reabrir um antigo com "Gerar de novo"), as respostas do último pedido
      // (para o "novo treino") e se há resposta nova no suporte.
      const info = async () => {
        const [i] = await sql`select p.id, p.tipo, p.status, p.metodo, p.valor, p.codigo, p.criado, p.pago_em, p.gerado_em,
            (select respostas from pedidos where email = ${u.email} and respostas is not null order by criado desc limit 1) as ultimas,
            exists (select 1 from chamados c join chamado_mensagens m on m.chamado_id = c.id
              where c.email = ${u.email} and m.autor = 'admin' and m.criado > coalesce(c.lido_aluno_em, '-infinity'::timestamptz)) as suporte_nao_lido
          from (select 1) d left join lateral (select * from pedidos where email = ${u.email} order by status = any(${ABERTOS}) desc, criado desc limit 1) p on true`;
        const { ultimas, suporte_nao_lido, ...pedido } = i;
        return { pedido: pedido.id ? pedido : null, ultimas, naoLido: suporte_nao_lido };
      };
      let { pedido, ultimas, naoLido: sn } = await info(), x = u;
      // O formulário só lê as perguntas: não segura a tela esperando uma geração. (No poll, a geração já rodou acima.)
      if (b.poll !== true && b.form !== true && pedido && (pedido.status === "pago" || pedido.status === "gerando") && await gerar(pedido.id)) {
        ({ pedido, ultimas, naoLido: sn } = await info());
        [x] = await sql`select acesso_ate, dados from usuarios where email = ${u.email}`;
      } else if (b.poll === true && pedido && !["pago", "gerando"].includes(pedido.status)) {
        [x] = await sql`select acesso_ate, dados from usuarios where email = ${u.email}`; // o treino ficou pronto no poll: os dados mudaram
      }
      const agora = new Date(), aberto = !!pedido && ABERTOS.includes(pedido.status), plano = x.dados && x.dados.plano;
      // Função desligada (TREINO_IA_ATIVO): usuário comum não vê pedido inicial nem novo treino; renovar continua.
      const ativo = iaAtiva() || (ehAdmin(u.email) && !termoFaltando().length);
      const pode = Object.fromEntries(Object.keys(PRECOS).map((t) => [t, (ativo || t === "mensalidade") && !podePedir(t, x, agora, aberto).erro]));
      // novo_treino: o formulário vem com as últimas respostas; os consentimentos precisam ser marcados de novo.
      if (!pode.novo_treino || !ultimas) ultimas = null; else delete ultimas.consentimentos;
      return res.json({
        pedido, ativo, acessoAte: x.acesso_ate, temPlanoIA: !!plano && plano.origem === "ia", planoCriado: (plano && plano.criado) || null,
        pode, precos: PRECOS, termo: TERMO_VERSAO, ultimas, plano: visivel(x, x.dados).plano || null, suporteNaoLido: !!sn,
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
        // Limite por conta e por IP (reservado antes de consultar). Código inexistente, grupo cheio e tentativa bloqueada: a mesma resposta.
        const liberado = await reservarGrupo(sql, u.email, ipDe(req.headers));
        const codigo = texto(b.codigo, 6, 6) ? b.codigo.toUpperCase() : "";
        const [{ n }] = await sql`select count(*)::int as n from usuarios where grupo = ${codigo}`;
        if (!liberado || !n || n >= 50) return res.status(400).json({ erro: "Não foi possível entrar neste grupo. Confira o código com quem criou o grupo." });
        await zerarGrupo(sql, u.email);
        grupo = codigo;
      }
      if (grupo !== u.grupo) await sql`update usuarios set grupo = ${grupo} where email = ${u.email}`;
      if (!grupo) return res.json({ codigo: null, membros: [] });
      // Os outros membros veem só nome e contagens, nunca o email.
      const hoje = hojeBR(); // datas futuras que já estejam gravadas não contam
      const membros = await sql`select nome, email = ${u.email} as eu,
          (select count(*) from jsonb_array_elements_text(dados->'checkins') as d(dia) where dia >= ${b.semana} and dia <= ${hoje})::int as semana,
          (select count(*) from jsonb_array_elements_text(dados->'checkins') as d(dia) where dia >= ${b.mes} and dia <= ${hoje})::int as mes
        from usuarios where grupo = ${grupo}`;
      return res.json({ codigo: grupo, membros });
    }
    return res.status(400).json({ erro: "Ação desconhecida." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Erro no servidor. Tente de novo." });
  }
}
