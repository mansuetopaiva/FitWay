// Schema do banco (criado e atualizado na primeira chamada de cada instância; não precisa rodar SQL à mão). Compartilhado por api/app.js
// e api/cron.js: a tarefa diária também pode ser a primeira a falar com um banco novo. O "_" impede a Vercel de expor como rota.
import { createHash } from "node:crypto";


// Cria as tabelas na primeira chamada de cada instância; não precisa rodar SQL à mão.
// Os ~35 comandos só rodam quando a versão gravada no banco difere da deste código. A versão é o hash do texto de
// aplicarSchema(): qualquer mudança no schema troca a versão sozinha, sem ninguém lembrar de somar um número.
async function aplicarSchema(sql) {
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
  await sql`alter table usuarios add column if not exists foto text`; // foto de perfil: JPEG quadrado em data URL (160 px nas antigas, 512 px nas novas; api/_foto.js)
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
  // pedidos.email sem chave estrangeira: na exclusão da conta os pedidos pagos ficam, anonimizados (email = "excluida:<HMAC>"),
  // e os outros são apagados explicitamente (usuario_excluir em api/_admin.js).
  await sql`create table if not exists pedidos (
    id text primary key,
    email text not null,
    tipo text not null check (tipo in ('inicial', 'mensalidade', 'novo_treino')),
    status text not null check (status in ('aguardando_pagamento', 'aguardando_confirmacao', 'pago', 'gerando', 'pronto', 'erro', 'cancelado')),
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
  await sql`do $$ declare c text; begin
    for c in select conname from pg_constraint where conrelid = 'pedidos'::regclass and contype = 'f' and confrelid = 'usuarios'::regclass loop
      execute format('alter table pedidos drop constraint %I', c);
    end loop;
  end $$`;
  await sql`create index if not exists pedidos_email_criado on pedidos (email, criado desc)`;
  await sql`create index if not exists pedidos_status on pedidos (status)`;
  // Pagamento (docs/pagamento.md). Os "unique" ficam em índices próprios: "add column if not exists ... unique" não é idempotente em todo Postgres.
  await sql`alter table pedidos add column if not exists codigo text, add column if not exists pagador_nome text,
    add column if not exists comprovante text, add column if not exists aviso_em timestamptz, add column if not exists confirmado_por text,
    add column if not exists transaction_nsu text, add column if not exists capture_method text, add column if not exists mensagem_usuario text,
    add column if not exists checkout_url text, add column if not exists checkout_ref jsonb, add column if not exists pix_e2e text,
    add column if not exists pix_e2e_informado text, add column if not exists checkout_slug text, add column if not exists checado_em timestamptz,
    add column if not exists checkout_url_pix text, add column if not exists estornado_em timestamptz, add column if not exists estornado_por text`;
  await sql`create unique index if not exists pedidos_codigo on pedidos (codigo)`;
  await sql`create unique index if not exists pedidos_transaction_nsu on pedidos (transaction_nsu)`;
  await sql`create unique index if not exists pedidos_pix_e2e on pedidos (upper(pix_e2e))`; // o mesmo ID com outra caixa é o mesmo Pix
  await sql`create unique index if not exists pedidos_checkout_slug on pedidos (checkout_slug)`;
  // Status novo aguardando_confirmacao: troca a restrição antiga uma vez só.
  await sql`do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'pedidos_status_check' and pg_get_constraintdef(oid) like '%aguardando_confirmacao%') then
      alter table pedidos drop constraint if exists pedidos_status_check;
      alter table pedidos add constraint pedidos_status_check
        check (status in ('aguardando_pagamento', 'aguardando_confirmacao', 'pago', 'gerando', 'pronto', 'erro', 'cancelado'));
    end if;
  end $$`;
  // No máximo 1 pedido aberto por usuário (ABERTOS), garantido pelo banco (dois cliques ao mesmo tempo).
  await sql`create unique index if not exists pedidos_um_aberto_v2 on pedidos (email)
    where status in ('aguardando_pagamento', 'aguardando_confirmacao', 'pago', 'gerando')`;
  await sql`drop index if exists pedidos_um_aberto`;
  // Suporte por chamados (docs/suporte.md).
  await sql`create table if not exists chamados (
    id text primary key,
    email text not null references usuarios on delete cascade,
    assunto text not null check (assunto in ('pagamento', 'treino', 'conta', 'app')),
    pedido_id text references pedidos on delete set null,
    status text not null default 'aberto' check (status in ('aberto', 'respondido', 'fechado')),
    criado timestamptz not null default now(),
    atualizado timestamptz not null default now(),
    fechado_em timestamptz,
    lido_aluno_em timestamptz,
    lido_admin_em timestamptz
  )`;
  await sql`create index if not exists chamados_email on chamados (email, atualizado desc)`;
  await sql`create index if not exists chamados_status on chamados (status, atualizado desc)`;
  await sql`create table if not exists chamado_mensagens (
    id bigint generated always as identity primary key,
    chamado_id text not null references chamados on delete cascade,
    autor text not null check (autor in ('aluno', 'admin')),
    admin_email text,
    texto text not null check (char_length(texto) between 1 and 2000),
    anexo text,
    criado timestamptz not null default now()
  )`;
  await sql`create index if not exists chamado_mensagens_chamado on chamado_mensagens (chamado_id, id)`;
  // Esqueci a senha (docs/senha.md): só o hash do token; os pedidos guardam o hash do email digitado (limites).
  await sql`create table if not exists senha_tokens (
    id bigint generated always as identity primary key,
    email text not null references usuarios on delete cascade,
    hash text not null unique,
    criado timestamptz not null default now(),
    expira timestamptz not null,
    usado_em timestamptz,
    ip text
  )`;
  await sql`create index if not exists senha_tokens_email on senha_tokens (email)`;
  await sql`create table if not exists senha_pedidos (
    id bigint generated always as identity primary key,
    email_hash text not null,
    ip text not null,
    criado timestamptz not null default now()
  )`;
  await sql`create index if not exists senha_pedidos_email on senha_pedidos (email_hash, criado)`;
  await sql`create index if not exists senha_pedidos_ip on senha_pedidos (ip, criado)`;
  await sql`create table if not exists login_tentativas (
    chave text primary key,
    falhas int not null default 0,
    bloqueado_ate timestamptz,
    atualizado timestamptz not null default now(),
    liberado boolean
  )`;
  await sql`alter table login_tentativas add column if not exists liberado boolean`;
  // Segundo fator do admin (docs/admin-2fa.md): segredo cifrado (nunca em usuarios.dados), códigos de recuperação só como HMAC e
  // desafios do login (só o hash; uso único, validade curta).
  await sql`create table if not exists admin_2fa (
    email text primary key references usuarios on delete cascade,
    segredo_cifrado text not null,
    criado timestamptz not null default now(),
    ativado_em timestamptz,
    ultimo_passo bigint not null default 0
  )`;
  await sql`create table if not exists admin_recuperacao (
    email text not null references usuarios on delete cascade,
    hash text not null,
    usado_em timestamptz,
    primary key (email, hash)
  )`;
  await sql`create table if not exists login_desafios (
    hash text primary key,
    email text not null references usuarios on delete cascade,
    tipo text not null check (tipo in ('ativar', 'codigo')),
    criado timestamptz not null default now(),
    expira timestamptz not null,
    tentativas int not null default 0,
    usado_em timestamptz
  )`;
  await sql`create unique index if not exists admin_log_devolvido on admin_log ((detalhes->>'transaction_nsu')) where acao = 'devolvido'`;
}
const VERSAO_SCHEMA = createHash("sha256").update(aplicarSchema.toString()).digest("hex").slice(0, 16);
// Sem memória própria: quem chama (app.js, por instância) guarda a promessa. Com o schema em dia, é 1 comando.
export const garantirSchema = (sql) => (async () => {
  let atual;
  try { [atual] = await sql`select versao from schema_versao where id = 1`; } catch (e) { /* tabela ainda não existe: banco novo */ }
  if (atual && atual.versao === VERSAO_SCHEMA) return; // partida a frio: 1 comando em vez de dezenas
  await aplicarSchema(sql);
  await sql`create table if not exists schema_versao (id int primary key, versao text not null)`;
  await sql`insert into schema_versao (id, versao) values (1, ${VERSAO_SCHEMA}) on conflict (id) do update set versao = excluded.versao`;
})();
