// Pedidos de treino: validação do formulário e das fotos e a criação do pedido. O "_" impede a Vercel de expor como rota.
// O formulário (js/pedido.js) recebe PARQ, OPCOES e TEXTOS do servidor, então o texto fica só aqui.
import { randomBytes } from "node:crypto";
export const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 símbolos, sem 0/O e 1/I (grupos do ranking e código do pedido)
// Código curto do pedido, para a pessoa anotar e o admin achar o Pix: "FW" + 6.
export const novoCodigo = () => "FW" + Array.from(randomBytes(6), (x) => LETRAS[x % 32]).join("");
import { ABERTOS, PRECOS, iaAtiva, podePedir } from "./_precos.js";
import { registrarAceite, termoFaltando } from "./_termo.js";

export const PARQ = [
  "Algum médico já disse que você tem algum problema de coração e que só deve fazer atividade física com orientação médica?",
  "Você sente dor no peito quando faz atividade física?",
  "No último mês, você sentiu dor no peito sem estar fazendo atividade física?",
  "Você perde o equilíbrio por causa de tontura ou já perdeu a consciência?",
  "Você tem algum problema nos ossos ou nas articulações que pode piorar com atividade física?",
  "Você toma hoje algum remédio para pressão arterial ou para o coração?",
  "Você sabe de algum outro motivo para não fazer atividade física?",
];
export const OPCOES = {
  objetivo: ["Emagrecer", "Ganhar massa muscular", "Definir", "Condicionamento", "Saúde e bem-estar"],
  nivel: ["Nunca treinei", "Iniciante: até 6 meses", "Intermediário: 6 meses a 2 anos", "Avançado: mais de 2 anos"],
  sexo: ["Feminino", "Masculino"],
  minutos: [30, 45, 60, 90],
};
export const TEXTOS = { lesoes: 300, cirurgias: 300, doencas: 300, remedios: 300, evitar: 300, observacoes: 600 };
const NUMEROS = { idade: [18, 90, true], altura: [120, 230, true], peso: [30, 300, false], dias: [2, 6, true] };
const NOMES = { objetivo: "o objetivo", nivel: "o nível", sexo: "o sexo", minutos: "o tempo por treino", idade: "A idade", altura: "A altura", peso: "O peso", dias: "Os dias por semana" };
const FAIXA = { idade: "de 18 a 90 anos", altura: "de 120 a 230 cm", peso: "de 30 a 300 kg", dias: "de 2 a 6" };

// Tira caracteres de controle (menos quebra de linha) e espaços nas pontas.
export const limparTexto = (s) => s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").trim();

// Nunca confia no navegador: confere tudo de novo e devolve só os campos conhecidos.
export function limparRespostas(r, { temFotos, agora }) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return { erro: "Respostas inválidas." };
  const out = {};
  // Objetivo: um ou mais (texto único vem de rascunho antigo); guardado na ordem da lista, sem repetir.
  const obj = [].concat(r.objetivo ?? []);
  if (!obj.length || !obj.every((o) => OPCOES.objetivo.includes(o))) return { erro: `Escolha ${NOMES.objetivo}.` };
  out.objetivo = OPCOES.objetivo.filter((o) => obj.includes(o));
  for (const [k, ops] of Object.entries(OPCOES)) {
    if (k === "objetivo") continue;
    if (!ops.includes(r[k])) return { erro: `Escolha ${NOMES[k]}.` };
    out[k] = r[k];
  }
  for (const [k, [min, max, inteiro]] of Object.entries(NUMEROS)) {
    const v = r[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (inteiro && !Number.isInteger(v)))
      return { erro: `${NOMES[k]} precisa ser ${FAIXA[k]}.` };
    out[k] = inteiro ? v : Math.round(v * 10) / 10;
  }
  if (!Array.isArray(r.parq) || r.parq.length !== PARQ.length || !r.parq.every((x) => typeof x === "boolean"))
    return { erro: "Responda Sim ou Não em todas as perguntas de saúde (PAR-Q)." };
  out.parq = [...r.parq];
  const algumSim = out.parq.includes(true);
  if (algumSim && r.liberacao !== true)
    return { erro: "Você respondeu Sim no questionário de saúde. Para montar o treino, é preciso ter liberação médica para fazer musculação." };
  out.liberacao = algumSim;
  for (const [k, max] of Object.entries(TEXTOS)) {
    const v = r[k] === undefined ? "" : r[k];
    if (typeof v !== "string") return { erro: "Resposta de texto inválida." };
    const t = limparTexto(v);
    if (t.length > max) return { erro: `Cada campo de texto pode ter no máximo ${max} caracteres.` };
    out[k] = t;
  }
  const c = r.consentimentos && typeof r.consentimentos === "object" ? r.consentimentos : {};
  if (c.dados !== true) return { erro: "O consentimento para guardar dados de saúde é obrigatório." };
  if (temFotos && c.fotos !== true) return { erro: "Para enviar fotos, marque o consentimento das fotos." };
  out.consentimentos = { dados: agora.toISOString(), fotos: temFotos ? agora.toISOString() : null };
  return { respostas: out };
}

export const CHAVES_FOTOS = ["frente", "costas", "direito", "esquerdo"];
const MAX_FOTO = 409600; // caracteres base64 ≈ 300 KB de imagem
const JPEG = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;
export const jpegValido = (v) => typeof v === "string" && v.length <= MAX_FOTO + 23 && JPEG.test(v); // fotos

export function limparFotos(f) {
  if (f === undefined || f === null) return { fotos: null };
  if (typeof f !== "object" || Array.isArray(f)) return { erro: "Fotos inválidas." };
  const fotos = {};
  for (const [k, v] of Object.entries(f)) {
    if (!CHAVES_FOTOS.includes(k)) return { erro: "Fotos inválidas." };
    if (!jpegValido(v)) return { erro: "Uma das fotos é inválida ou grande demais. Tente outra." };
    fotos[k] = v;
  }
  return { fotos: Object.keys(fotos).length ? fotos : null };
}

// Rotinas de prazo, sem cron: rodam no pedido_status (email do usuário) e no resumo do admin (email null = todos).
// - aguardando pagamento há mais de 30 dias (aviso_em: último aviso do Pix manual antigo, se houve): cancelado e sem fotos;
// - fotos (e o comprovante do Pix manual antigo) apagados 90 dias depois do pedido ficar pronto, cancelado ou com erro (as respostas ficam).
//   aguardando_confirmacao (Pix manual antigo) não é cancelado aqui: a pessoa disse que pagou; só o admin cancela.
export async function limparPedidos(sql, email) {
  const [a] = await sql`with x as (update pedidos set status = 'cancelado', fotos = null, comprovante = null, pagador_nome = null, atualizado = now()
    where (${email}::text is null or email = ${email}) and status = 'aguardando_pagamento' and greatest(criado, aviso_em) < now() - interval '30 days' returning 1)
    select count(*)::int as n from x`;
  // A mensalidade vira pronto sem gerado_em: conta de pago_em.
  const [f] = await sql`with x as (update pedidos set fotos = null, comprovante = null, pagador_nome = null where (${email}::text is null or email = ${email}) and (fotos is not null or comprovante is not null) and (
    (status = 'pronto' and coalesce(gerado_em, pago_em) < now() - interval '90 days') or (status in ('cancelado', 'erro') and atualizado < now() - interval '90 days')) returning 1)
    select count(*)::int as n from x`;
  return { cancelados: (a && a.n) || 0, fotos: (f && f.n) || 0 }; // contagens, para o resumo da tarefa diária
}

// pedido_criar. Recebe sql e "agora" por parâmetro para o teste. u traz email, acesso_ate e dados do banco.
export async function criarPedido(sql, u, b, headers, agora, { admin = false } = {}) {
  if (b.tipo !== "mensalidade") {
    const falta = termoFaltando();
    if (falta.length) return { status: 400, corpo: { erro: admin ? `Termo incompleto: configure ${falta.join(", ")}.` : "Em breve." } };
    if (!iaAtiva() && !admin) return { status: 400, corpo: { erro: "Em breve." } };
  }
  const [{ aberto }] = await sql`select exists (select 1 from pedidos where email = ${u.email} and status = any(${ABERTOS})) as aberto`;
  const pode = podePedir(b.tipo, u, agora, aberto);
  if (pode.erro) return { status: 400, corpo: { erro: pode.erro } };
  let respostas = null, fotos = null, aceite = null;
  if (b.tipo !== "mensalidade") { // inicial e novo_treino têm formulário de saúde: termo, fotos e respostas de novo
    const a = registrarAceite(b.termo, b.termoHash, headers || {}, agora);
    if (a.erro) return { status: 400, corpo: { erro: a.erro, termoMudou: a.termoMudou } }; // termoMudou: o app recarrega o termo
    const f = limparFotos(b.fotos);
    if (f.erro) return { status: 400, corpo: { erro: f.erro } };
    const r = limparRespostas(b.respostas, { temFotos: !!f.fotos, agora });
    if (r.erro) return { status: 400, corpo: { erro: r.erro } };
    ({ aceite } = a); ({ fotos } = f); ({ respostas } = r);
  }
  const id = randomBytes(12).toString("base64url");
  // shortcut: colisão do código (1 em ~1 bilhão) cai no "já tem pedido"; tentar de novo se um dia acontecer.
  const codigo = novoCodigo();
  const js = (v) => (v ? JSON.stringify(v) : null);
  // O índice único pedidos_um_aberto recusa um 2º pedido aberto mesmo em dois cliques simultâneos.
  // metodo vazio até a pessoa escolher; o valor do Pix (o menor) é provisório, só para a lista do admin.
  const [p] = await sql`insert into pedidos (id, email, tipo, status, valor, codigo, respostas, fotos, aceite)
    values (${id}, ${u.email}, ${b.tipo}, 'aguardando_pagamento', ${PRECOS[b.tipo]}, ${codigo}, ${js(respostas)}::jsonb, ${js(fotos)}::jsonb, ${js(aceite)}::jsonb)
    on conflict do nothing returning id, tipo, status, metodo, valor, codigo, criado, pago_em, gerado_em`;
  if (!p) return { status: 400, corpo: { erro: "Você já tem um pedido em andamento." } };
  return { status: 200, corpo: { pedido: p } };
}
