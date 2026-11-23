// Limite de tentativas no login. O estado fica no banco (a Vercel não guarda memória entre chamadas): uma linha por conta e
// por IP com o contador de erros da última hora e, quando passa do limite, até quando está bloqueado.
// Durante o bloqueio as tentativas são recusadas sem contar (senão quem digita o email de outra pessoa prolongaria o bloqueio).
// Por conta o bloqueio nunca passa de 15 minutos; o aluno sempre pode usar "Esqueci a senha".
import { hmacEmail } from "./_admin.js";
import { createHash } from "node:crypto";
import { grupoIp } from "./_senha.js";

// [a partir de quantos erros, minutos de espera], do maior para o menor
const REGRA = { conta: [[10, 15], [8, 5], [5, 1]], admin: [[5, 15]], ip: [[40, 15], [30, 5], [20, 1]], cadastro: [[30, 15], [20, 5], [10, 1]] };
const espera = (erros, regra) => (REGRA[regra].find(([n]) => erros >= n) || [0, 0])[1];
const chaveEmail = (prefixo, email) => prefixo + ":" + (hmacEmail(email) || createHash("sha256").update(email).digest("hex"));
const chaveConta = (email) => chaveEmail("c", email);
// Sem IP (não acontece na Vercel) não há como atribuir: só vale o limite por conta.
const chaveIp = (ip) => (grupoIp(ip) ? "i:" + grupoIp(ip) : null);
const chaves = (email, ip, admin) => [[chaveConta(email), admin ? "admin" : "conta"], ...(chaveIp(ip) ? [[chaveIp(ip), "ip"]] : [])];

export const MSG_LOGIN = "Email ou senha incorretos. Depois de várias tentativas erradas, o login espera até 15 minutos antes de aceitar de novo.";

// Reserva uma tentativa ANTES de conferir a senha, numa instrução só (o banco trava a linha): 200 requisições em paralelo contra a mesma
// conta não passam todas pela checagem. Cada chave devolve se a tentativa está liberada; o contador sobe a cada tentativa liberada (o
// acerto da conta zera depois) e, ao chegar a um limite, a mesma instrução grava até quando fica bloqueado. Tentativa feita durante
// o bloqueio é recusada sem contar. Passada 1 hora sem tentativas, a contagem recomeça.
async function reservarChaves(sql, lista) {
  let ok = true;
  for (const [chave, regra] of lista) {
    const R = REGRA[regra], [n1, m1] = R[0], [n2, m2] = R[1] || R.at(-1), [n3, m3] = R[2] || R.at(-1); // regra com menos de 3 faixas repete a última
    const [r] = await sql`insert into login_tentativas as t (chave, falhas, atualizado, liberado) values (${chave}, 1, now(), true)
      on conflict (chave) do update set
        liberado = not coalesce(t.bloqueado_ate > now(), false),
        falhas = case when t.bloqueado_ate > now() then t.falhas when t.atualizado < now() - interval '1 hour' then 1 else t.falhas + 1 end,
        atualizado = case when t.bloqueado_ate > now() then t.atualizado else now() end,
        bloqueado_ate = case when t.bloqueado_ate > now() then t.bloqueado_ate else (select now() + make_interval(mins => case
            when s.f >= ${n1}::int then ${m1}::int when s.f >= ${n2}::int then ${m2}::int when s.f >= ${n3}::int then ${m3}::int else 0 end)
          from (select case when t.atualizado < now() - interval '1 hour' then 1 else t.falhas + 1 end as f) s
          where s.f >= ${n3}::int) end
      returning liberado`;
    if (!r.liberado) ok = false;
  }
  return ok;
}

export const reservar = (sql, email, ip, admin) => reservarChaves(sql, chaves(email, ip, admin));
// Cadastro: por IP (10 tentativas por hora, depois 1, 5 e 15 min). Todas contam, inclusive as que criam conta.
export const reservarCadastro = (sql, ip) => (chaveCadastro(ip) ? reservarChaves(sql, [[chaveCadastro(ip), "cadastro"]]) : true);
const chaveCadastro = (ip) => (grupoIp(ip) ? "n:" + grupoIp(ip) : null);
// Código do grupo: por conta e por IP, como o login. Cada tentativa de "entrar" num grupo conta; entrar de verdade zera a conta.
export const reservarGrupo = (sql, email, ip) => reservarChaves(sql, [[chaveEmail("g", email), "conta"], ...(grupoIp(ip) ? [["gi:" + grupoIp(ip), "ip"]] : [])]);
export const zerarGrupo = (sql, email) => sql`delete from login_tentativas where chave = ${chaveEmail("g", email)}`;

// Login certo zera o contador da conta. O do IP não: senão um atacante intercalaria um login válido seu para zerá-lo.
export const zerar = (sql, email) => sql`delete from login_tentativas where chave = ${chaveConta(email)}`;
