// Política de privacidade. Pública para todos (vale para o app inteiro, não só para o treino com IA).
// A versão atual é a primeira da lista; ao mudar o texto, acrescente uma versão nova no topo.
// Usa as variáveis do termo, menos o documento (o CPF não aparece na política). Sem elas, a política continua no ar
// com "o responsável pelo FitWay" e sem email.

const V_2026_11_16 = `POLÍTICA DE PRIVACIDADE — FITWAY

Esta política explica quais dados o FitWay usa, para quê, com quem compartilha e quais são os seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).

1. Quem cuida dos seus dados
O FitWay é mantido por {{responsavel}}, que é o controlador dos dados. Para qualquer assunto de privacidade, escreva para {{email_contato}}.

2. Quais dados usamos
2.1. Conta: nome, email e senha. A senha é guardada de forma cifrada; ninguém consegue lê-la.
2.2. Uso do app: check-ins, cargas registradas, treino, grupo de ranking e foto de perfil, se você enviar.
2.3. Treino personalizado (só se você pedir): respostas do formulário, incluindo dados de saúde (PAR-Q, lesões, doenças, remédios), peso, altura, idade e as fotos que você enviar.
2.4. Pagamento: tipo de pedido, valor, meio de pagamento e situação. Os dados do cartão são digitados direto no checkout da InfinitePay; o FitWay não recebe nem guarda número de cartão.
2.5. Registros técnicos: data e hora de acesso, endereço IP e navegador, usados para segurança e para registrar o aceite do termo.

3. Para que usamos
3.1. Criar e manter sua conta e mostrar seus treinos, check-ins e ranking.
3.2. Montar o seu treino personalizado, com auxílio de inteligência artificial, quando você pedir.
3.3. Processar pagamentos e liberar o acesso.
3.4. Cumprir obrigações legais e proteger o serviço contra fraudes.
Não vendemos seus dados e não usamos seus dados para publicidade.

4. Base legal
Usamos os dados da conta e do uso do app para executar o serviço que você contratou. Os dados de saúde e as fotos são usados somente com o seu consentimento específico, dado no formulário do treino personalizado, e você pode retirá-lo a qualquer momento.

5. Com quem compartilhamos
Só com os serviços necessários para o FitWay funcionar:
- Vercel (hospedagem do site) e Neon (banco de dados), que guardam os dados do app;
- Anthropic, que fornece a inteligência artificial usada para montar o treino personalizado e recebe as respostas do formulário e as fotos de quem pede o treino;
- InfinitePay, que processa os pagamentos por Pix e cartão e recebe seu nome e email;
- GitHub, de onde são carregadas as imagens dos exercícios (recebe apenas o endereço IP do seu navegador ao exibir as imagens).
Alguns desses serviços ficam fora do Brasil, principalmente nos Estados Unidos, e seus dados podem ser processados lá.

6. Por quanto tempo guardamos
- Fotos do treino personalizado: apagadas 90 dias depois que o plano fica pronto.
- Pedidos não pagos: cancelados em 30 dias, com as fotos apagadas.
- Demais dados da conta e respostas do formulário: enquanto você tiver conta, ou até você pedir a exclusão.
- Registros de pagamento e de aceite do termo: pelo tempo exigido por lei.

7. Seus direitos
Você pode pedir, pelo email {{email_contato}}: confirmação de que tratamos seus dados, acesso a eles, correção, exclusão, informação sobre com quem foram compartilhados e retirada do consentimento. Respondemos em até 15 dias.

8. Cookies e armazenamento no aparelho
O FitWay usa um único cookie, necessário para manter você conectado, e guarda no seu navegador uma cópia dos seus check-ins e cargas para o app funcionar mais rápido e sem internet. Não usamos cookies de publicidade nem de rastreamento. Ao sair da conta, os dados do treino personalizado guardados no aparelho são apagados.

9. Segurança
Os dados trafegam com criptografia (HTTPS), a senha é cifrada e o acesso ao painel de administração é restrito e registrado.

10. Idade
O treino personalizado é só para maiores de 18 anos.

11. Mudanças
Esta política pode ser atualizada. A versão em vigor fica sempre neste endereço, com a data da última atualização.`;

// 2026-11-16-2: suporte por chamados (2.6, os anexos no item 6 e os pedidos pelo suporte no 7).
const V_2026_11_16_2 = V_2026_11_16
  .replace(/^(2\.5\. .*)$/m, (m) => m + "\n2.6. Suporte: as mensagens e imagens que você enviar nos chamados.")
  .replace(/^(- Pedidos não pagos: .*)$/m, (m) => m + "\n- Imagens anexadas aos chamados: apagadas 90 dias depois que o chamado é encerrado. As mensagens ficam enquanto você tiver conta.")
  .replace("Respondemos em até 15 dias.", "Respondemos em até 15 dias. Pedidos sobre seus dados também podem ser feitos pelo suporte do app, no assunto Conta e dados.");

// 2026-11-16-3: o Gmail, que envia os emails (troca de senha).
const V_2026_11_16_3 = V_2026_11_16_2.replace(/^(- InfinitePay, .*)$/m, (m) => m +
  "\n- Google (Gmail), usado para enviar os emails do FitWay, como o de troca de senha; recebe o seu email e o conteúdo da mensagem.");

export const PRIVACIDADES = [{ versao: "2026-11-16-3", modelo: V_2026_11_16_3 }, { versao: "2026-11-16-2", modelo: V_2026_11_16_2 }, { versao: "2026-11-16", modelo: V_2026_11_16 }];
export const PRIVACIDADE_VERSAO = PRIVACIDADES[0].versao;

const env = (k) => (process.env[k] || "").trim();
export function montarPrivacidade() {
  const responsavel = env("TERMO_RESPONSAVEL"), email = env("TERMO_EMAIL");
  let t = PRIVACIDADES[0].modelo;
  // Sem as variáveis: frases reescritas para não mostrar marcador nem ficar sem sentido.
  if (!responsavel) t = t.replace("mantido por {{responsavel}}", "mantido pelo responsável pelo FitWay");
  if (!email) t = t.replace(" Para qualquer assunto de privacidade, escreva para {{email_contato}}.", "").replace("Você pode pedir, pelo email {{email_contato}}:", "Você pode pedir:");
  t = t.replace(/\{\{(responsavel|email_contato)\}\}/g, (m, k) => (k === "responsavel" ? responsavel : email));
  return { versao: PRIVACIDADE_VERSAO, texto: t };
}
