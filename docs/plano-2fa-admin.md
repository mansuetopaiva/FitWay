# Plano: segundo fator (TOTP) para contas de admin — para aprovação, nada implementado

## Objetivo e escopo
Hoje a conta de admin tem um fator só (senha de 6+ caracteres) e o único freio é o bloqueio de 15 min após 5 erros, que também deixa **qualquer pessoa** manter o admin fora do painel (basta errar a senha a cada 15 min), e o admin não tem "Esqueci a senha". O 2º fator resolve os dois lados: uma senha vazada não basta, e o bloqueio por conta pode ser afrouxado.
Só contas em `ADMIN_EMAILS`. Alunos não mudam. Sem dependência nova: TOTP (RFC 6238: HMAC-SHA1, 30 s, 6 dígitos) em ~30 linhas com `node:crypto`.

## Onde guardar o segredo
- Tabela própria `admin_2fa (email pk, segredo_cifrado text, criado, ativado_em, ultimo_passo bigint)`. Nunca em `usuarios.dados` (volta ao navegador) nem no `admin_log`.
- Segredo de 20 bytes aleatórios (base32), cifrado com **AES-256-GCM**; chave derivada por HKDF da variável `TOTP_CHAVE` (32+ bytes aleatórios, **separada** de `HASH_SEGREDO`). Formato `v1:iv:tag:texto`; `TOTP_CHAVE_ANTERIOR` permite trocar a chave sem desativar ninguém (lê com qualquer uma das duas, regrava com a nova).
- Sem `TOTP_CHAVE` o recurso fica desligado e o login do admin continua como hoje (com aviso no painel). Um vazamento só do banco não entrega o segredo; precisa do banco **e** da variável.
- Anti-repetição: `ultimo_passo` guarda o último intervalo de 30 s aceito; um código só vale se o passo for maior, via `update ... where ultimo_passo < $passo returning` (atômico: duas requisições com o mesmo código não passam as duas).

## Códigos de recuperação
10 códigos de uso único (10 caracteres base32, ~50 bits), mostrados **uma vez** na ativação. Guardados como HMAC-SHA256 com `HASH_SEGREDO` em `admin_recuperacao (email, hash, usado_em)`. Usar um loga, marca `usado_em`, grava no `admin_log` e pede para gerar novos; gerar novos invalida todos os antigos; com 2 ou menos sobrando, o painel avisa.
Sem email no fluxo (o admin não recebe link de senha). Saída de emergência documentada: quem tem o banco apaga a linha de `admin_2fa` do admin e ele entra só com a senha para reativar.

## Ativação (Perfil do admin)
1. "Ativar verificação em duas etapas" pede a senha atual.
2. O servidor cria o segredo **pendente** (`ativado_em` nulo) e devolve o `otpauth://` (link que abre o app autenticador no celular) e a chave em texto para digitar. QR: proposta de começar sem QR (link + chave); um gerador de QR embutido de ~150 linhas fica como opção.
3. A pessoa digita o 1º código; só então ativa e mostra os códigos de recuperação. Desativar pede senha + código.

## Ordem do login
1. Reserva atômica da tentativa (conta/IP, como hoje) e confere a senha (hash falso para conta inexistente, igual hoje).
2. Senha certa e admin **sem** 2FA: entra, como hoje (ou, com `ADMIN_2FA_OBRIGATORIO=1`, abre uma sessão restrita que só acessa a ativação).
3. Senha certa e admin **com** 2FA: **não abre sessão**. Responde `{ precisa2fa: true, desafio }`; o desafio é aleatório, guardado só como hash em `login_desafios` (validade 5 min, uso único, 5 tentativas). A senha não viaja de novo.
4. `entrar_2fa { desafio, codigo }`: aceita TOTP (janela de ±1 passo = ±30 s, para relógio atrasado) ou código de recuperação. Só então `abrirSessao`.
5. A resposta para "senha errada", "conta inexistente" e "bloqueada" continua única; a tela do código só aparece depois de a senha estar certa.

## Como fica o bloqueio de 15 minutos
Proposta (recomendada), em duas camadas:
- **Senha errada** conta por **(conta, IP)** e por IP, como hoje, mas **não** bloqueia a conta inteira: um terceiro não consegue mais trancar o admin de fora. Um teto alto por conta (50 erros por hora) bloqueia 15 min só contra tentativa distribuída.
- **Código errado** (quem chegou aqui sabe a senha): conta na chave `admin` da conta, **5 erros = 15 min** (o bloqueio de hoje, agora no ponto onde ele não pode ser provocado por estranhos), mais o limite de 5 por desafio.
- Login completo (senha + código) zera só os contadores da conta; o do IP não zera (como hoje).
Alternativa conservadora: manter tudo como está e só acrescentar o código (o bloqueio por conta continua provocável por terceiros).

## Registro e testes
- `admin_log`: `2fa_ativado`, `2fa_desativado`, `2fa_recuperacao_usada`, `2fa_falha_codigo` (sem segredo, sem código, sem IP em claro).
- Testes (PGlite/jsdom/Chromium): vetores do RFC 6238; janela ±1; repetição do mesmo código (e em paralelo); cifra ida e volta, adulterada e com a chave anterior; ativação completa; login nas duas etapas; sem `TOTP_CHAVE`; rajada de 60 códigos em paralelo conta 5; recuperação de uso único; desafio expirado/reutilizado; tela do código no `test:layout` (44 px, erro ligado ao campo, foco no campo do código).

## Ordem de commits proposta
1. TOTP puro + cifra + vetores do RFC (sem tocar no login). 2. Tabelas e API de ativação/desativação/recuperação. 3. Login em duas etapas atrás de `TOTP_CHAVE` (desligado sem a variável). 4. Telas (ativação, código, recuperação) + layout. 5. Bloqueio novo (senha por conta+IP, código por conta). 6. Opcional: `ADMIN_2FA_OBRIGATORIO` e "Esqueci a senha" do admin com código.

## Riscos
Relógio do celular fora (janela ±30 s e dica na tela); celular perdido (códigos de recuperação e saída pelo banco); perda da `TOTP_CHAVE` (guardar fora da Vercel; sem ela o 2FA existente não valida: a saída é apagar `admin_2fa`); deploy sem a variável (recurso fica desligado, não trava o login).

## Decisões para você
1. Bloqueio: a proposta recomendada (senha por conta+IP, código por conta) ou a conservadora?
2. Obrigatório ou opcional para os admins no começo (`ADMIN_2FA_OBRIGATORIO`)?
3. Ativação sem QR (link + chave) está bom, ou quer o QR embutido?
4. Permitir "Esqueci a senha" do admin com código do autenticador/recuperação?
5. 10 códigos de recuperação está bom?
