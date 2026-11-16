# Spec: Esqueci a senha e troca de senha

## Objetivo

"Esqueci a senha" na tela de login, com link de troca enviado pelo Gmail do FitWay, e "Trocar senha" no Perfil. É recuperação de conta:
o desenho é contra roubo de conta e contra descobrir quais emails têm conta.

## Fontes

- nodemailer **10.3.1** (licença MIT-0, sem dependências; versão de 29/10/2026, a mais nova com mais de duas semanas). Lido no próprio pacote:
  o serviço "Gmail" é `host: "smtp.gmail.com", port: 465, secure: true`; os tempos padrão são longos (`connectionTimeout` 2 min,
  `greetingTimeout` 30 s, `socketTimeout` 10 min), então ficam em 10 s.
- Gmail exige **senha de app** (conta com verificação em duas etapas) para SMTP com usuário e senha.

## Envio (`api/_email.js`)

```js
transporteGmail()                                       // null sem SMTP_USER ou SMTP_SENHA_APP
enviarEmail({ para, assunto, texto, html }, { transporte }) // remetente "FitWay <SMTP_USER>", desiste em 10 s
emailDisponivel()                                        // SMTP_USER, SMTP_SENHA_APP e SITE_URL
```

Sem as variáveis, a tela de "Esqueci a senha" mostra: "A recuperação por email está indisponível. Escreva para {TERMO_EMAIL}."
(sem `TERMO_EMAIL`: "… indisponível no momento."). Os testes usam um transporte falso; nenhum email real.

## Banco

```sql
senha_tokens (id identity, email → usuarios on delete cascade, hash text unique (SHA-256 hex do token), criado, expira (30 min),
  usado_em, ip)
senha_pedidos (id identity, email_hash (SHA-256 do email digitado), ip, criado)   -- limites; guarda o hash, não o email
```

## Ações (sem login, em `api/app.js` antes da sessão; lógica em `api/_senha.js`)

- **`senha_disponivel`** → `{ disponivel, mensagem? }`.
- **`senha_pedir { email }`** → sempre `{ mensagem: "Se houver uma conta com esse email, enviamos um link para trocar a senha. Ele vale
  por 30 minutos. Confira também o spam." }`, exista a conta ou não, e também quando o limite estoura ou o email tem formato inválido.
  - Limites: 3 por email por hora e 10 por IP por hora, contados em `senha_pedidos`. Primeiro registra (inclusive email sem conta),
    depois conta só os pedidos de id menor: com pedidos em paralelo, a ordem de chegada decide. IPv6 conta pelo bloco /64. Teto global
    de 100 links por hora (cota do Gmail). Acima disso: a mesma mensagem, sem enviar. Linhas de mais de 1 dia são apagadas.
  - **Conta de admin** (`ADMIN_EMAILS`) não recebe link: a mesma mensagem, sem enviar (um fator só é pouco para o painel; o admin
    recupera pela Vercel/banco).
  - Token: `randomBytes(32)` em base64url (43 caracteres); no banco só o SHA-256. Numa instrução: os tokens anteriores não usados do
    email vencem (`expira = now()`) e o novo é gravado — `insert … select from usuarios where email = …` (sem conta, nada é gravado,
    mas a instrução é a mesma).
  - **Tempo igual:** a resposta sai sempre no mesmo piso (2,5 s desde o início), com ou sem conta, com ou sem envio.
    `shortcut:` se o Gmail demorar mais que o piso, a resposta com conta sai depois; trocar por envio em segundo plano (`waitUntil`)
    se medir diferença.
  - Email (texto + HTML simples, sem imagem externa nem rastreamento), assunto "Trocar sua senha do FitWay", com o texto pedido e o
    link `SITE_URL + "/#/nova-senha/" + token` (depois do `#`: não vai a log de servidor nem a outro site).
- **`senha_conta { token }`** → `{ email }` de um link válido, sem gastá-lo: a tela mostra de que conta é a senha e, se outra conta
  estiver conectada no aparelho, pede para sair antes (contra quem manda o próprio link para outra pessoa).
- **`senha_nova { token, senha }`**: token inexistente é recusado numa consulta barata, antes do scrypt. token no formato (43 caracteres base64url) e senha com as regras do cadastro (6 a 100 caracteres).
  Numa instrução: marca o token usado (só se `usado_em is null` e `expira > now()`), grava a senha (`senhaHash`, o mesmo scrypt do
  cadastro, movido para `_senha.js`), vence os outros tokens do email, **apaga todas as sessões** e grava `admin_log`
  `senha_trocada` (`{ via: "email" }`, sem token nem senha). Depois abre uma sessão nova no aparelho atual e manda o email de aviso.
  Token inválido, vencido ou usado: 400 "Este link não vale mais. Peça um novo em Esqueci a senha."
- **`senha_alterar { atual, nova }`** (logado): confere a atual (mesma `confere`), grava a nova, apaga as **outras** sessões (mantém a
  atual), vence os tokens de email pendentes, `admin_log` `senha_trocada` (`{ via: "perfil" }`) e o email de aviso.
  Limite: 5 tentativas erradas por hora por conta (contadas no `admin_log` `senha_errada`).

Email de aviso: assunto "Sua senha do FitWay foi trocada", texto "A senha da sua conta foi trocada agora há pouco. Se não foi você,
responda este email ou abra um chamado no suporte." Falha no envio não desfaz a troca (só `console.error`).

Login sem conta confere contra um hash falso (mesmo tempo do login com conta).

## Limites conhecidos (decisão do dono)

- **Tempo do envio:** se o Gmail demorar mais que o piso de 2,5 s, a resposta com conta sai depois e revela que ela existe. Resolver
  sem esperar o envio pede `waitUntil` do pacote `@vercel/functions` (dependência nova, não adicionada sem autorização).
- **O cadastro revela que o email tem conta** ("Já existe uma conta com este email"), anterior a esta mudança. A resposta única do
  "Esqueci a senha" não esconde isso de quem tentar cadastrar o email. Fechar exige confirmação de email no cadastro.
- **Nome no email:** o texto pedido começa com "Olá, {nome}." e o nome é escolhido no cadastro (sem confirmação de email): dá para
  pôr um endereço no nome e o email oficial sair com ele (phishing). O nome vai escapado no HTML.
- Login (`entrar`) sem limite de tentativas.

## Telas

- Login: link "Esqueci a senha" → campo de email → "Enviar link" → a mensagem única. Sem SMTP: o aviso com o email de contato.
- `#/nova-senha/<token>`: o app guarda o token na memória e limpa o endereço (`history.replaceState`) antes de desenhar; campos
  "Nova senha" e "Repetir a nova senha". Funciona com ou sem login; ao trocar, entra na conta.
- Perfil: "Trocar senha" (senha atual, nova e repetir).

## Política de privacidade `2026-11-16-3`

Acrescenta no item 5: "- Google (Gmail), usado para enviar os emails do FitWay, como o de troca de senha; recebe o seu email e o
conteúdo da mensagem."

## Análise de segurança (roubo de conta)

| Ataque | Barreira |
|---|---|
| Descobrir quais emails têm conta | mensagem, status e tempo iguais; limite também conta email sem conta |
| Adivinhar o token | 256 bits; só o hash no banco; 30 min; uso único |
| Vazamento do banco | só o SHA-256 do token (um token de 256 bits não se reverte por dicionário) |
| Token em log ou `Referer` | vai depois do `#` e o app limpa o endereço antes de qualquer requisição |
| Link antigo num email esquecido | pedido novo vence os anteriores; a troca vence todos |
| Sessão de quem roubou a senha antiga | a troca por email apaga todas as sessões; no Perfil, todas menos a atual |
| Encher a caixa de alguém ou gastar a cota do Gmail | 3 por email/hora e 10 por IP/hora |
| Trocar a senha de uma sessão roubada sem saber a senha | `senha_alterar` exige a senha atual, com limite de erros |
| Troca sem o dono saber | email de aviso e `admin_log` |
| Injeção de cabeçalho ou HTML no email | nome e link escapados no HTML; assunto fixo; destinatário é o email do banco |
| Corrida: dois usos do mesmo token | `update … where usado_em is null and expira > now()`: só um acha a linha |

## Testes

Banco simulado + transporte falso: mesma resposta e mesmo piso com e sem conta; limites; só o hash; validações; sem SMTP. PGlite (fora
do repositório): token vence em 30 min, uso único, pedido novo invalida o anterior, troca apaga todas as sessões, limites reais.
