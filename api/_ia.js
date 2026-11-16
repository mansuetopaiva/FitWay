// Treino com IA: requisição à API da Anthropic (fetch, sem SDK), leitura e validação da resposta e a geração do pedido.
// Formato da API conforme a documentação oficial:
//   versões: https://platform.claude.com/docs/en/api/versioning
//   saída estruturada: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
import { NOMES_FOTOS, foto } from "./_treino.js";
import { CHAVES_FOTOS } from "./_pedido.js";
import { montarPrompt, ROTULOS_FOTOS } from "./_prompt.js";

const NOMES = [...new Set(NOMES_FOTOS)];
const txt = { type: "string" };
const obj = (properties, opcionais = []) => ({
  type: "object", additionalProperties: false, properties,
  required: Object.keys(properties).filter((k) => !opcionais.includes(k)),
});

// O schema garante tipos e nomes de exercício; tamanhos e faixas (que o schema não aceita) ficam em validarPlanoIA.
export const SCHEMA = obj({
  nome_plano: txt, resumo: txt, avaliacao_fotos: txt,
  fases: { type: "array", items: obj({ semanas: txt, foco: txt }) },
  cardio: txt, progressao: txt, cuidados: txt,
  treinos: { type: "array", items: obj({
    nome: txt,
    exercicios: { type: "array", items: obj({ nome: { type: "string", enum: NOMES }, series: { type: "integer" }, reps: txt, descanso_s: { type: "integer" }, obs: txt }) },
  }) },
}, ["avaliacao_fotos"]);

export const MODELO = () => process.env.IA_MODELO || "claude-sonnet-5-5";

export function montarRequisicao({ system, mensagem }, fotos, modelo = MODELO()) {
  const content = [];
  for (const k of CHAVES_FOTOS) if (fotos && fotos[k])
    content.push({ type: "text", text: `Foto: ${ROTULOS_FOTOS[k]}` },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: fotos[k].slice(fotos[k].indexOf(",") + 1) } });
  content.push({ type: "text", text: mensagem });
  return {
    model: modelo, max_tokens: 8000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
  };
}

// Chama a API. A mensagem de erro vai só para o pedido (visto pelo admin), nunca com a chave.
export async function chamarIA(body, { chave = process.env.ANTHROPIC_API_KEY, fetch = globalThis.fetch } = {}) {
  if (!chave) throw new Error("ANTHROPIC_API_KEY não configurada.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": chave, "anthropic-version": "2026-10-21", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(50000), // a função tem 60 s; sobra tempo para gravar a falha
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`API ${r.status}: ${(j.error && j.error.message || "").slice(0, 300)}`);
  return j;
}

// Resposta da API → JSON do plano. Recusa e resposta cortada contam como falha.
export function lerResposta(r) {
  if (!r || typeof r !== "object") return { erro: "Resposta vazia da IA." };
  if (r.stop_reason === "refusal") return { erro: "A IA recusou o pedido." };
  if (r.stop_reason === "max_tokens") return { erro: "A resposta da IA veio cortada (max_tokens)." };
  const t = Array.isArray(r.content) && r.content.find((b) => b && b.type === "text");
  if (!t) return { erro: "A IA não devolveu texto." };
  try { return { json: JSON.parse(t.text), modelo: typeof r.model === "string" ? r.model : "" }; }
  catch { return { erro: "A IA devolveu um JSON inválido." }; }
}

const NOMES_SET = new Set(NOMES);
const texto = (v, max, min = 1) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// A saída da IA é tratada como entrada hostil: confere todos os limites e monta o plano no formato do app.
export function validarPlanoIA(j, { criado, pedido }) {
  if (!j || typeof j !== "object" || Array.isArray(j)) return { erro: "Plano da IA inválido." };
  if (!texto(j.nome_plano, 80)) return { erro: "nome_plano: de 1 a 80 caracteres." };
  for (const [k, max] of [["resumo", 600], ["cardio", 300], ["progressao", 400], ["cuidados", 400]])
    if (!texto(j[k], max)) return { erro: `${k}: de 1 a ${max} caracteres.` };
  if (j.avaliacao_fotos !== undefined && !texto(j.avaliacao_fotos, 600, 0)) return { erro: "avaliacao_fotos: até 600 caracteres." };
  if (!Array.isArray(j.fases) || j.fases.length < 2 || j.fases.length > 4) return { erro: "fases: de 2 a 4." };
  for (const f of j.fases) if (!f || !texto(f.semanas, 10) || !texto(f.foco, 200)) return { erro: "fase inválida." };
  if (!Array.isArray(j.treinos) || j.treinos.length < 1 || j.treinos.length > 6) return { erro: "treinos: de 1 a 6." };
  const treinos = [];
  for (const [i, t] of j.treinos.entries()) {
    const id = "ABCDEF"[i];
    if (!t || !texto(t.nome, 60)) return { erro: `treino ${id}: nome de 1 a 60 caracteres.` };
    if (!Array.isArray(t.exercicios) || t.exercicios.length < 3 || t.exercicios.length > 10) return { erro: `treino ${id}: de 3 a 10 exercícios.` };
    const exercicios = [];
    for (const e of t.exercicios) {
      if (!e || !NOMES_SET.has(e.nome)) return { erro: `treino ${id}: exercício fora da lista.` };
      if (!int(e.series, 1, 6) || !texto(e.reps, 12) || !int(e.descanso_s, 30, 240) || !texto(e.obs, 160, 0))
        return { erro: `treino ${id}, ${e.nome}: séries, repetições, descanso ou observação fora do limite.` };
      exercicios.push([e.nome, foto(e.nome), e.series, e.reps.trim(), 0, e.descanso_s, e.obs.trim()]);
    }
    treinos.push({ id, nome: t.nome.trim(), exercicios });
  }
  const guia = {
    resumo: j.resumo.trim(), avaliacao_fotos: (j.avaliacao_fotos || "").trim(),
    fases: j.fases.map((f) => ({ semanas: f.semanas.trim(), foco: f.foco.trim() })),
    cardio: j.cardio.trim(), progressao: j.progressao.trim(), cuidados: j.cuidados.trim(),
  };
  return { plano: { nome: j.nome_plano.trim(), origem: "ia", criado, semanas: 8, pedido, guia, treinos } };
}

// Gera o treino de um pedido pago. Chamada pelo pedido_status (usuário) e pelo admin; o UPDATE condicional
// garante que só uma chamada gera. Um "gerando" parado há 3 minutos (função derrubada no meio) é retomado.
// Uma tentativa por chamada (decisão D3): na 1ª falha o pedido volta para "pago"; na 2ª vira "erro".
export async function gerarSeDevido(sql, id, { ia = chamarIA, agora = () => new Date() } = {}) {
  // A função pode ser derrubada no meio (limite de tempo): parado há 3 minutos conta como falha; com 2 tentativas, vira erro.
  await sql`update pedidos set status = 'erro', erro = 'A geração não terminou a tempo (2 tentativas).', atualizado = now()
    where id = ${id} and status = 'gerando' and tentativas >= 2 and atualizado < now() - interval '3 minutes'`;
  const [p] = await sql`update pedidos set status = 'gerando', tentativas = tentativas + 1, atualizado = now()
    where id = ${id} and tipo <> 'mensalidade' and (status = 'pago' or (status = 'gerando' and tentativas < 2 and atualizado < now() - interval '3 minutes'))
    returning id, email, tipo, respostas, fotos, tentativas, (select dados->'plano' from usuarios where email = pedidos.email) as anterior`;
  if (!p) return false;
  let r;
  try {
    const fotos = p.fotos || {};
    const prompt = montarPrompt(p.respostas, { fotos: Object.keys(fotos), anterior: p.tipo === "novo_treino" ? p.anterior : null });
    const lida = lerResposta(await ia(montarRequisicao(prompt, fotos)));
    r = lida.erro ? lida : { ...validarPlanoIA(lida.json, { criado: agora().toISOString(), pedido: p.id }), modelo: lida.modelo };
  } catch (e) {
    r = { erro: String((e && e.message) || e).slice(0, 300) };
  }
  // "tentativas" na condição: se outra chamada retomou o pedido, só a mais recente grava.
  if (r.plano) {
    const plano = JSON.stringify(r.plano);
    await sql`with p as (update pedidos set status = 'pronto', plano_gerado = ${plano}::jsonb, modelo = ${r.modelo}, erro = null,
        gerado_em = now(), atualizado = now() where id = ${p.id} and status = 'gerando' and tentativas = ${p.tentativas} returning email)
      update usuarios set dados = jsonb_set(dados, '{plano}', ${plano}::jsonb) || '{"proximo":"A"}'::jsonb where email = (select email from p)`;
    return true;
  }
  await sql`update pedidos set status = case when tentativas >= 2 then 'erro' else 'pago' end, erro = ${r.erro}, atualizado = now()
    where id = ${p.id} and status = 'gerando' and tentativas = ${p.tentativas}`;
  return false;
}
