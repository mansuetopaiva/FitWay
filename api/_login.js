// Limite de tentativas no login. O estado fica no banco (a Vercel não guarda memória entre chamadas): uma linha por conta e
// por IP com o contador de erros da última hora e, quando passa do limite, até quando está bloqueado.
// Durante o bloqueio as tentativas são recusadas sem contar (senão quem digita o email de outra pessoa prolongaria o bloqueio).
// Por conta o bloqueio nunca passa de 15 minutos; o aluno sempre pode usar "Esqueci a senha".
import { hmacEmail } from "./_admin.js";
import { createHash } from "node:crypto";
import { grupoIp } from "./_senha.js";

// [a partir de quantos erros, minutos de espera], do maior para o menor
const REGRA = { conta: [[10, 15], [8, 5], [5, 1]], admin: [[5, 15]], ip: [[40, 15], [30, 5], [20, 1]] };
const espera = (erros, regra) => (REGRA[regra].find(([n]) => erros >= n) || [0, 0])[1];
const chaveConta = (email) => "c:" + (hmacEmail(email) || createHash("sha256").update(email).digest("hex"));
// Sem IP (não acontece na Vercel) não há como atribuir: só vale o limite por conta.
const chaveIp = (ip) => (grupoIp(ip) ? "i:" + grupoIp(ip) : null);
const chaves = (email, ip, admin) => [[chaveConta(email), admin ? "admin" : "conta"], ...(chaveIp(ip) ? [[chaveIp(ip), "ip"]] : [])];

export const MSG_LOGIN = "Email ou senha incorretos. Depois de várias tentativas erradas, o login espera até 15 minutos antes de aceitar de novo.";

export async function bloqueado(sql, email, ip, admin) {
  const ks = chaves(email, ip, admin).map(([k]) => k);
  return (await sql`select 1 from login_tentativas where chave = any(${ks}::text[]) and bloqueado_ate > now() limit 1`).length > 0;
}

export async function registrarErro(sql, email, ip, admin) {
  for (const [chave, regra] of chaves(email, ip, admin)) {
    // Passada uma hora sem erros, a contagem recomeça.
    const [{ erros }] = await sql`insert into login_tentativas (chave, falhas, atualizado) values (${chave}, 1, now())
      on conflict (chave) do update set falhas = case when login_tentativas.atualizado < now() - interval '1 hour' then 1 else login_tentativas.falhas + 1 end, atualizado = now()
      returning falhas as erros`;
    const m = espera(erros, regra);
    if (m) await sql`update login_tentativas set bloqueado_ate = now() + make_interval(mins => ${m}::int) where chave = ${chave}`;
  }
}

// Login certo zera o contador da conta. O do IP não: senão um atacante intercalaria um login válido seu para zerá-lo.
export const zerar = (sql, email) => sql`delete from login_tentativas where chave = ${chaveConta(email)}`;
