# Segundo fator (TOTP) do admin

Vale para **todo** email de `ADMIN_EMAILS`. Alunos não mudam. Decisões e alternativas descartadas: `docs/plano-2fa-admin.md`.

## Variáveis (Vercel → Settings → Environment Variables)

| Variável | Para quê |
|---|---|
| `TOTP_CHAVE` | 32+ caracteres aleatórios (ex.: `openssl rand -base64 48`). Cifra o segredo de cada admin (AES-256-GCM). **Separada de `HASH_SEGREDO`.** Guarde uma cópia fora da Vercel. |
| `TOTP_CHAVE_ANTERIOR` | Só durante uma troca de chave (abaixo). |
| `HASH_SEGREDO` | Já existente; também guarda os códigos de recuperação como HMAC. |

**Sem `TOTP_CHAVE` (ou sem `HASH_SEGREDO`) o login de admin falha** com a mensagem "Entrada de administrador indisponível…" depois da senha certa; nunca abre sem o segundo fator. Alunos entram normalmente.

## Como funciona

1. **Senha certa de admin não abre sessão.** O servidor devolve um *desafio* (aleatório, só o hash no banco, uso único, 5 tentativas, vale 5 min; 10 min na ativação).
2. **1º login (ativação guiada):** a tela mostra a chave em grupos de 4 e o link `otpauth://` (sem QR e sem biblioteca nova). A pessoa adiciona a conta no app autenticador (SHA-1, 6 dígitos, 30 s) e digita o 1º código. Só então a sessão nasce e aparecem **10 códigos de recuperação, uma única vez**.
3. **Logins seguintes:** senha, depois código do app (tolerância de ±1 janela = ±30 s) **ou** um código de recuperação (uso único).
4. Um código do app **não vale duas vezes** (nem em paralelo): se acabou de ser usado, espere o próximo (30 s).
5. **Sessão de admin aberta antes do 2FA deixa de valer** (sem segundo fator ativado): entre de novo e ative.
6. Perfil do admin: mostra quantos códigos restam (aviso com 2 ou menos) e **gera 10 novos** exigindo senha atual + código do app; os antigos deixam de valer.

## Bloqueios (todos com a resposta genérica, sem dizer o que falhou)

- **Senha errada:** por (conta, IP) e por IP, com espera crescente (1, 5, 15 min). **Não tranca a conta inteira**: de outro IP o admin entra.
- **Teto por conta:** 50 tentativas de senha (qualquer IP); a contagem recomeça depois de 1 hora sem tentativas. Passou: 15 min bloqueado.
- **Código errado (ou senha/código errados ao gerar novos códigos):** por conta, **5 erros = 15 min** (o certo também é recusado). Só conta quem já passou pela senha (desafio válido).
- Login completo zera os contadores da conta (não o do IP).
- `admin_log`: `2fa_ativado`, `2fa_falha_codigo`, `2fa_recuperacao_usada`, `2fa_codigos_novos`. Sem segredo, sem código, sem IP.

## "Esqueci a senha" do admin: continua sem

Não há link por email para admin. Recuperação, na ordem:

**A) Perdeu o celular, lembra a senha:** entre com a senha e um **código de recuperação** no campo do código. Depois, no Perfil, gere novos códigos. Para trocar o aparelho do autenticador, use **B**.

**B) Perdeu o celular e os códigos (ou quer trocar de aparelho):** pelo banco (Neon → SQL Editor), apague o segundo fator desse admin. No próximo login ele entra só com a senha, cai na ativação e cadastra um autenticador novo:

```sql
delete from admin_2fa where email = 'admin@exemplo.com';          -- apaga o segredo (os códigos de recuperação também somem junto, abaixo)
delete from admin_recuperacao where email = 'admin@exemplo.com';
delete from sessoes where email = 'admin@exemplo.com';            -- opcional: derruba sessões abertas
delete from login_tentativas;                                      -- opcional: tira bloqueios de 15 min
```

**C) Esqueceu a senha:** não há troca por email para admin. Pelo banco, grave um hash novo (gere com `node -e "import('./api/_senha.js').then(m=>console.log(m.senhaHash('NOVA_SENHA')))"` na raiz do repositório) e faça **B** em seguida se quiser:

```sql
update usuarios set senha = '<hash gerado>' where email = 'admin@exemplo.com';
delete from sessoes where email = 'admin@exemplo.com';
```

## Trocar `TOTP_CHAVE` sem desativar ninguém

1. Gere a chave nova. Na Vercel: `TOTP_CHAVE_ANTERIOR` = a chave atual, `TOTP_CHAVE` = a nova. Faça o deploy.
2. Cada admin que entrar tem o segredo regravado com a chave nova (no login).
3. Quando todos tiverem entrado uma vez, apague `TOTP_CHAVE_ANTERIOR`.

**Perdeu `TOTP_CHAVE` sem cópia?** O segredo cifrado não abre mais (o login mostra "não consegue ler o segundo fator"). Saída: configure uma `TOTP_CHAVE` nova e faça **B** para cada admin.

## Limites conhecidos

- Sem QR code: a chave e o link `otpauth://` (o link só ajuda quando o login é feito no próprio celular; no computador, digite a chave no app).
- Um segredo pendente (ativação começada e não concluída) é reaproveitado no login seguinte.
- A contagem do teto de 50 e dos bloqueios recomeça após 1 hora sem tentativas (não é janela deslizante exata).
