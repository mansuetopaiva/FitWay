# Spec: Suporte por chamados e exclusão de conta

## Objetivo

O aluno abre um chamado dentro do app e o dono responde pelo painel do admin. Vale para o app inteiro, com ou sem `TREINO_IA_ATIVO`.
Junto vem a exclusão de conta pelo admin, para atender os pedidos de "Conta e dados" (LGPD).

**Fora do escopo:** avisos por email; anexo nas respostas do admin; chat em tempo real (a lista é relida ao abrir a tela).

## Banco (`schema()` em `api/app.js`, tudo `if not exists`)

```sql
chamados (id text pk aleatório, email → usuarios on delete cascade, assunto in ('pagamento','treino','conta','app'),
  pedido_id → pedidos on delete set null (opcional), status in ('aberto','respondido','fechado') default 'aberto',
  criado, atualizado (última mensagem ou mudança de status), fechado_em, lido_aluno_em, lido_admin_em)
chamado_mensagens (id bigint identity, chamado_id → chamados on delete cascade, autor in ('aluno','admin'),
  admin_email (null para aluno), texto 1..2000, anexo (data URL JPEG, opcional), criado)
índices: chamados (email, atualizado desc), chamados (status, atualizado desc), chamado_mensagens (chamado_id, id)
```

- `aberto` = aguardando o admin; `respondido` = aguardando o aluno; `fechado` = encerrado.
- **Não lida (aluno):** existe mensagem do admin com `criado > coalesce(lido_aluno_em, -infinity)`.

## Ações do aluno (`api/_suporte.js`, `ACOES`)

Todas exigem login e filtram por `email = u.email` dentro da própria instrução SQL (chamado de outra conta = "Chamado não encontrado.", 404).

| Ação | Corpo | Efeito |
|---|---|---|
| `suporte` | — | lista dos chamados (assunto, status, data da última mensagem, `naoLido`), os pedidos da conta (código, tipo, valor, status) e `naoLido` geral |
| `chamado_abrir` | `assunto, texto, pedido_id?, anexo?` | cria chamado + 1ª mensagem numa instrução; `pedido_id` só da própria conta |
| `chamado` | `id` | chamado + mensagens (sem o anexo: só `anexo: true`) e marca `lido_aluno_em = now()` |
| `chamado_anexo` | `id, msg` | a imagem de uma mensagem do próprio chamado |
| `chamado_responder` | `id, texto, anexo?` | só em chamado não fechado; status vira `aberto` |
| `chamado_encerrar` | `id` | `fechado`, `fechado_em = now()` |

- `eu` e `pedido_status` também devolvem `suporteNaoLido` (ponto de aviso no Perfil e no ícone da aba).
- **Limites (servidor):** no máximo 3 chamados `aberto` ou `respondido` por aluno; no máximo 10 mensagens do aluno por hora (soma de
  todos os chamados). Conferidos dentro do INSERT. `shortcut:` dois envios exatamente simultâneos podem passar 1 do limite; trocar por
  trava (`for update` na linha do usuário) se virar abuso.
- **Texto:** `trim`, 1 a 2000 caracteres. Mostrado sempre com `esc()` e `white-space: pre-wrap` (nunca como HTML).
- **Anexo:** só `data:image/jpeg;base64,/9j/…` (assinatura JPEG `FF D8 FF`), até 410 000 caracteres (~300 KB). O app reduz a imagem
  no aparelho (lado maior 1280 px, JPEG) antes de enviar.

## Admin (`acaoAdmin`, `js/admin.js`)

| Op | Efeito (cada escrita com o seu `admin_log` na mesma instrução) |
|---|---|
| `resumo` | + `suporteAguardando` (chamados `aberto`) |
| `suporte_lista {status?, assunto?, pagina?}` | nome, assunto, 1ª linha da 1ª mensagem (80 caracteres), `atualizado`; ordem: `aberto` primeiro, do mais antigo; depois os outros, do mais recente |
| `suporte_chamado {id}` | conversa + contexto (nome, email, acesso até, nome do plano atual, pedido ligado) e marca `lido_admin_em` |
| `suporte_responder {id, texto}` | mensagem do admin; status `respondido`; log `suporte_responder` (só id e tamanho, não o texto) |
| `suporte_encerrar {id}` / `suporte_reabrir {id}` | `fechado` / `aberto`; log `suporte_encerrar` / `suporte_reabrir` |
| `suporte_anexo {id, msg}` | devolve a imagem e grava `suporte_anexo_ver` no log (pode ter dado pessoal) |
| `usuario_excluir {email, confirmacao}` | ver abaixo |

### Exclusão de conta (`usuario_excluir`)

- `confirmacao` precisa ser igual ao email (o painel pede para digitar). A conta do próprio admin → 400.
- Pedido em `pago` ou `gerando` → 400 "Resolva antes o pedido em andamento (pago ou gerando)."
- Numa instrução: `delete from usuarios` (cascata: sessões, pedidos, chamados, mensagens) e `admin_log` `conta_excluida` com
  `alvo_email = null` e `detalhes = { email_sha256 }` (SHA-256 do email em minúsculas). A data e quem excluiu ficam nas colunas do log.
- O histórico antigo do `admin_log` (`alvo_email` de ações anteriores) **não** é apagado nesta versão (pergunta S1).

## Prazos (`limparChamados`, sem cron: roda junto com `limparPedidos`, no `pedido_status`, no resumo do admin e na lista do suporte)

- `respondido` com `atualizado` há mais de 7 dias → `fechado` (o aluno não escreveu depois da resposta).
- Anexos apagados (`anexo = null`) 90 dias depois de `fechado_em`. Reabrir zera `fechado_em`.

## Telas

- **Perfil:** card "Ajuda e suporte" com ponto de aviso quando há resposta não lida; o mesmo ponto no ícone da aba Perfil.
- **`#/suporte`:** lista + "Abrir chamado". **`#/suporte/novo`:** 4 assuntos com o texto de ajuda; Pagamento mostra o seletor de pedidos;
  Meu treino mostra o aviso fixo de saúde; mensagem e anexo. **`#/suporte/<id>`:** conversa, responder, "Encerrar chamado"; fechado
  mostra "Este chamado foi encerrado" e "Abrir novo chamado sobre isso" (mesmo assunto e pedido).
- **Admin:** aba "Suporte" (`#/admin/suporte`, `#/admin/chamado.<id>`), filtros por status e assunto, conversa com o contexto acima
  (no celular) ou ao lado; Responder, Encerrar, Reabrir. Detalhe do usuário: "Excluir conta" em duas etapas.

## Política de privacidade `2026-11-16-2`

Acrescenta o 2.6 (mensagens e imagens dos chamados), a linha dos anexos no item 6 e, no 7, os pedidos pelo suporte (assunto Conta e dados).

## Análise de segurança

| Risco | Barreira |
|---|---|
| Ler, responder ou encerrar chamado de outra conta (id adivinhado) | `where email = u.email` em toda instrução do aluno; id com 96 bits aleatórios |
| HTML/script no texto (o admin lê) | `esc()` sempre; nenhum `innerHTML` com texto cru; CSP sem `unsafe-inline` em scripts |
| Anexo que não é imagem (SVG, HTML, `javascript:`) | só `data:image/jpeg;base64,` com assinatura JPEG; mostrado só como `<img src>` |
| Encher o banco ou o painel | 3 chamados abertos, 10 mensagens por hora, 2000 caracteres, ~300 KB por anexo |
| Anexo com dado pessoal visto sem rastro | `suporte_anexo_ver` no `admin_log` |
| Exclusão por engano | duas etapas (digitar o email) conferidas também no servidor; recusa com pedido pago ou gerando; nunca a própria conta |
| Exclusão deixar o email no log | o registro da exclusão guarda só o SHA-256 |

## Testes

Repositório (banco simulado): validação, limites e posse no SQL; anexo inválido; status e log das ops do admin; exclusão (confirmação,
própria conta, hash sem o email). PGlite e jsdom (fora do repositório, sem dependência nova): outra conta não lê/responde/encerra;
limites reais; resposta do admin acende o aviso; 7 dias fecha; 90 dias apaga anexo; exclusão em cascata; fluxo das telas.

## Perguntas em aberto

- **S1.** Ao excluir uma conta, apagar também o `alvo_email` dos registros antigos do `admin_log` (trocar pelo hash)? Hoje ficam.
