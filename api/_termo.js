// Termo de Responsabilidade e Uso. A versão atual é a primeira da lista; versões antigas ficam aqui para o texto
// aceito em cada pedido sempre poder ser consultado. Ao mudar o texto, acrescente uma versão nova no topo.
// Os dados pessoais do responsável NÃO ficam no código (o repositório é público): os marcadores {{...}} são
// trocados na hora pelas variáveis de ambiente de CAMPOS. Faltando alguma, o treino com IA não pode ser ligado.
import { createHash } from "node:crypto";

export const CAMPOS = { responsavel: "TERMO_RESPONSAVEL", documento: "TERMO_DOCUMENTO", email_contato: "TERMO_EMAIL", foro: "TERMO_FORO" };

const V_2026_11_16 = `TERMO DE RESPONSABILIDADE E USO — TREINO PERSONALIZADO FITWAY

Ao marcar "Li e aceito", eu declaro que li, entendi e concordo com o que segue.

1. Sobre o serviço
1.1. O FitWay, oferecido por {{responsavel}}, {{documento}}, monta um plano de treino de musculação a partir das informações que eu forneço no formulário. O plano é elaborado com o auxílio de inteligência artificial.
1.2. O plano é uma orientação geral a distância. Ele não substitui consulta médica, avaliação física presencial nem o acompanhamento de um profissional de educação física registrado no CREF.
1.3. O FitWay não oferece orientação de dieta, suplementação ou medicamentos.

2. Minha saúde
2.1. Declaro ter 18 anos ou mais.
2.2. Declaro que todas as informações que forneci, principalmente as de saúde (PAR-Q, lesões, dores, cirurgias, doenças e remédios), são verdadeiras e completas. Sei que o plano depende delas, e que informações falsas ou omitidas podem tornar o treino inadequado para mim.
2.3. Se respondi "Sim" a alguma pergunta do PAR-Q, declaro que tenho liberação médica para praticar musculação.
2.4. Se minha saúde mudar, comprometo-me a interromper o treino e procurar um médico antes de continuar.

3. Durante os treinos
3.1. Vou executar os exercícios com a técnica correta, respeitando meus limites, e procurar orientação de um profissional na academia sempre que tiver dúvida sobre a execução ou as cargas.
3.2. Vou interromper o exercício imediatamente e procurar atendimento se sentir dor no peito, falta de ar fora do normal, tontura, desmaio, palpitações ou dor forte em músculos ou articulações.
3.3. Entendo que toda atividade física tem riscos, e que a execução dos treinos, a escolha das cargas e o local onde treino são de minha responsabilidade.
3.4. Resultados dependem de fatores individuais, como alimentação, sono, frequência e genética. O FitWay não garante resultado específico.

4. Meus dados e fotos
4.1. Autorizo o uso dos meus dados, incluindo os de saúde e as fotos que eu enviar, apenas para montar e ajustar meu plano de treino.
4.2. Para isso, essas informações são enviadas ao serviço de inteligência artificial usado na montagem do plano. Elas não são vendidas nem usadas para publicidade.
4.3. As fotos são apagadas 90 dias depois que o plano fica pronto. Se o pedido ficar aguardando pagamento por mais de 30 dias, ele é cancelado e as fotos são apagadas. As demais respostas ficam guardadas enquanto eu tiver conta, para eu poder pedir um novo treino sem preencher tudo de novo.
4.4. Posso pedir a qualquer momento acesso, correção ou exclusão dos meus dados pelo email {{email_contato}}.

5. Pagamento e acesso
5.1. O primeiro treino custa R$ 9,99 e inclui 30 dias de acesso. Para continuar vendo o treino depois disso, pago R$ 9,99 a cada 30 dias. Sem o pagamento, o treino deixa de aparecer no app até eu renovar. Meus check-ins e meu histórico continuam guardados.
5.2. Depois de 8 semanas do plano, com o acesso em dia, posso pedir um novo treino por R$ 4,99.
5.3. Valores e condições podem mudar. Mudanças valem para os próximos pagamentos, nunca para o que já foi pago, e serão avisadas no app.

6. Disposições gerais
6.1. Este termo pode ser atualizado. Quando isso acontecer, vou precisar aceitar a nova versão no próximo pedido.
6.2. Fica eleito o foro da comarca de {{foro}}, ressalvado o meu direito, como consumidor, de propor ação no foro do meu domicílio.`;

// 2026-11-16-2: o 4.5 aponta para a Política de privacidade; o 4.2 diz que os dados vão para a Anthropic (EUA) e que nome e email vão para a InfinitePay; o 6.1 fala em "pedido de treino"; e o item 5 passa a ter os dois meios de pagamento
// (Pix e cartão, os dois pelo InfinitePay), com os valores de PRECOS.
const ITEM_4_2 = "4.2. Para isso, essas informações são enviadas à Anthropic, empresa dos Estados Unidos que fornece o serviço de inteligência artificial usado na montagem do plano, e podem ser processadas fora do Brasil. Ao pagar, meu nome e email são enviados à InfinitePay, que processa os pagamentos por Pix e cartão. Meus dados não são vendidos nem usados para publicidade.";
const ITEM_5_PAGAMENTO = `5. Pagamento e acesso
5.1. O primeiro treino custa R$ 9,99 no Pix ou R$ 11,99 no cartão de crédito e inclui 30 dias de acesso. Para continuar vendo o treino, pago a mensalidade de R$ 9,99 no Pix ou R$ 11,99 no cartão a cada 30 dias. Sem o pagamento, o treino deixa de aparecer no app até eu renovar. Meus check-ins e meu histórico continuam guardados.
5.2. Depois de 8 semanas do plano, com o acesso em dia, posso pedir um novo treino por R$ 4,99 no Pix ou R$ 5,99 no cartão.
5.3. Os pagamentos por Pix e por cartão são processados pela InfinitePay e confirmados automaticamente. O acesso e o treino são liberados assim que o pagamento é confirmado.
5.4. Pedidos sem pagamento em 30 dias são cancelados, e as fotos enviadas são apagadas.
5.5. Posso desistir da compra em até 7 dias depois do pagamento, como garante o Código de Defesa do Consumidor, pedindo pelo email de contato. O valor pago é devolvido.
5.6. Valores e condições podem mudar. Mudanças valem para os próximos pagamentos, nunca para o que já foi pago, e serão avisadas no app.`;
const V_2026_11_16_2 = V_2026_11_16.replace(/5\. Pagamento e acesso[\s\S]*?(?=\n\n6\.)/, () => ITEM_5_PAGAMENTO).replace(/^4\.2\. .*$/m, () => ITEM_4_2)
  .replace(/^4\.4\. .*$/m, (m) => m + "\n4.5. A Política de privacidade do FitWay, disponível no app, explica com mais detalhes como meus dados são tratados.")
  .replace(/^6\.1\. .*$/m, () => "6.1. Este termo pode ser atualizado. Quando isso acontecer, vou precisar aceitar a nova versão no próximo pedido de treino.");

// 2026-11-16-3: preço único, qualquer que seja o meio (o 5.1 e o 5.2 deixam de ter o preço do cartão).
const V_2026_11_16_3 = V_2026_11_16_2
  .replace(/^5\.1\. .*$/m, () => "5.1. O primeiro treino custa R$ 9,99, pago por Pix ou cartão de crédito, e inclui 30 dias de acesso. Para continuar vendo o treino, pago a mensalidade de R$ 9,99 a cada 30 dias. Sem o pagamento, o treino deixa de aparecer no app até eu renovar. Meus check-ins e meu histórico continuam guardados.")
  .replace(/^5\.2\. .*$/m, () => "5.2. Depois de 8 semanas do plano, com o acesso em dia, posso pedir um novo treino por R$ 4,99.");

export const TERMOS = [{ versao: "2026-11-16-3", modelo: V_2026_11_16_3 }, { versao: "2026-11-16-2", modelo: V_2026_11_16_2 }, { versao: "2026-11-16", modelo: V_2026_11_16 }];
export const TERMO_VERSAO = TERMOS[0].versao;

const valor = (k) => (process.env[CAMPOS[k]] || "").trim();
// Variáveis do termo que estão vazias (lidas a cada chamada, como ADMIN_EMAILS).
export const termoFaltando = () => Object.keys(CAMPOS).filter((k) => !valor(k)).map((k) => CAMPOS[k]);

// Texto pronto para mostrar e o SHA-256 dele. Uma passada só; marcador sem variável fica como está (o admin vê o que falta).
export function montarTermo(versao = TERMO_VERSAO) {
  const t = TERMOS.find((x) => x.versao === versao);
  if (!t) return null;
  const texto = t.modelo.replace(/\{\{(\w+)\}\}/g, (m, k) => (Object.hasOwn(CAMPOS, k) && valor(k) ? valor(k) : m));
  return { versao: t.versao, texto, hash: createHash("sha256").update(texto, "utf8").digest("hex") };
}

// Só vale o aceite da versão atual, com o termo completo e o hash do texto que o app mostrou (vem da ação "termo").
// Assim o aceite prova o texto exato, mesmo que as variáveis mudem depois. A hora é a do servidor; IP e navegador
// vêm dos cabeçalhos (na Vercel, x-real-ip e x-forwarded-for são preenchidos pela própria Vercel).
export function registrarAceite(versao, hash, headers, agora) {
  const atual = montarTermo();
  if (versao !== TERMO_VERSAO || termoFaltando().length) return { erro: "Aceite a versão atual do Termo de Responsabilidade e Uso para enviar o pedido." };
  if (hash !== atual.hash) return { erro: "O termo foi atualizado. Leia de novo e aceite para enviar o pedido." };
  const h = (k) => (typeof headers[k] === "string" ? headers[k] : "");
  return { aceite: { versao, hash, aceito_em: agora.toISOString(), ip: (h("x-real-ip") || h("x-forwarded-for").split(",")[0]).trim().slice(0, 64), user_agent: h("user-agent").slice(0, 200) } };
}
