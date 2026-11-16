// Envio de email pelo Gmail do FitWay (SMTP, docs/senha.md). O "_" impede a Vercel de expor como rota.
// O transporte vem por parâmetro: os testes usam um falso e nenhum email real sai.
import nodemailer from "nodemailer";

const env = (k) => (process.env[k] || "").trim();
const DEZ_S = 10000;

// Serviço "Gmail" do nodemailer: smtp.gmail.com, 465, TLS. Os tempos padrão vão de 30 s a 10 min; aqui, 10 s.
export function transporteGmail() {
  if (!env("SMTP_USER") || !env("SMTP_SENHA_APP")) return null;
  return nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: env("SMTP_USER"), pass: env("SMTP_SENHA_APP") },
    connectionTimeout: DEZ_S, greetingTimeout: DEZ_S, socketTimeout: DEZ_S,
  });
}

// O link de troca precisa do SITE_URL.
export const emailDisponivel = () => !!(env("SMTP_USER") && env("SMTP_SENHA_APP") && env("SITE_URL"));
export const mensagemIndisponivel = () => (env("TERMO_EMAIL")
  ? `A recuperação por email está indisponível. Escreva para ${env("TERMO_EMAIL")}.`
  : "A recuperação por email está indisponível no momento.");

export async function enviarEmail({ para, assunto, texto, html }, { transporte, limite = DEZ_S } = {}) {
  if (!transporte) throw new Error("Envio de email indisponível.");
  let timer;
  const tempo = new Promise((_, falhou) => { timer = setTimeout(() => falhou(new Error("Envio de email passou do tempo.")), limite); });
  try {
    return await Promise.race([tempo, transporte.sendMail({
      from: { name: "FitWay", address: env("SMTP_USER") }, to: para, subject: assunto, text: texto, ...(html ? { html } : {}),
    })]);
  } finally { clearTimeout(timer); }
}
