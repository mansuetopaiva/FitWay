# Auditoria FitWay — novembro de 2026 (Fase 1: só leitura e medição)

Feita sobre o projeto inteiro (commit `6932460`, ainda não publicado). Fontes: 4 agentes em paralelo (code-reviewer, security-auditor,
test-engineer, web-performance-auditor), leitura do código e prints reais no Chromium (Playwright) com o backend sobre PGlite.
Nenhum acesso ao banco de produção. `npm test` 174/174 e `npm run test:integracao` 64/64, os dois com código de saída 0 (um teste de integração é instável: ver G).

Gravidades: **crítico** (perde dinheiro/dados ou tira a conta de alguém), **alto** (quebra um fluxo principal ou abre ataque real),
**médio** (erro de lógica com caminho plausível, prazo da LGPD, lentidão perceptível), **baixo** (raro, cosmético ou dívida).

## Status em 22/11/2026 (depois das Fases 2 e 3 e da revisão por 4 agentes)

Sem push ainda. `npm test` 196, `npm run test:integracao` e `npm run test:layout` verdes (números no fim da entrega). Revisão final por code-reviewer, security-auditor, test-engineer e web-performance-auditor sobre `6932460..HEAD`.

**Corrigido**

| # (tabela abaixo) | O que | Como |
|---|---|---|
| 1 | Login sem limite | Tabela `login_tentativas`; por conta (5/8/10 → 1/5/15 min), por IP (20/30/40) e admin (5 → 15 min); resposta única; a tentativa é **reservada atomicamente antes** de conferir a senha (a revisão achou a corrida: rajada de 60 em paralelo contava 60, agora conta 5) |
| 2 | 409 recarregava o app | 409 só com `trocaConta`; email repetido e grupo cheio são 400; teste da troca real |
| 3 | Objetivo não lido | já estava (`6932460`) |
| 4 | Prazos da LGPD sem cron | `/api/cron` diário (06:00 UTC) com `CRON_SECRET`; fotos de pedidos travados >7 dias; limpeza de `login_tentativas`; resumo só com números no `admin_log`; o cron cria o schema se for o primeiro a falar com o banco |
| 5 | `reps`/`semanas` derrubavam o plano pago | cortados como os outros textos |
| 6 | Termo mudou com o formulário aberto | `termoMudou`: recarrega o termo e pede o aceite sem perder respostas |
| 7 | Sessão de treino com plano trocado | `trocouPlano()`; mesma classe: Resumo (`irPara`), foto e anexo lidos devagar |
| 8 | Check-in futuro | servidor descarta datas depois de hoje em Brasília; ranking, admin e contagem ignoram as já gravadas; o app reflete a resposta |
| 9 | Cadastro revelava admin/conta | mesma recusa (400, mesmo texto) e hash calculado antes de qualquer recusa |
| 10 | Partida a frio e desempenho | schema só quando a versão (hash de `aplicarSchema`) muda; nodemailer e hash falso sob demanda; logo WebP 55 KB; fotos dos exercícios próprias (miniatura 96 px); Perfil sem consulta repetida; consulta de 8 s do suporte sem gravar |
| G | Testes do dinheiro | `dinheiro_sql.test.mjs` no PGlite (os dois defeitos plantados são pegos); teste instável do suporte corrigido; testes de UI de login/Sair, checkout, ranking, treino, PAR-Q e rascunho |
| D/E | Layout e acessibilidade | alvos de 44 px (319 falhas → 0), admin em 320 px, erros ligados ao campo, foco visível e movido, contraste calculado (mín. 5,38:1), `npm run test:layout` |
| — | Foto de perfil | recorte 512×512 JPEG 0,85 com EXIF, zoom/pinça/teclado; servidor valida o JPEG e remove metadados; a foto saiu do select de toda requisição |
| B | IP do login | `x-vercel-forwarded-for` (o cliente não forja) |

**Continua aberto (decisão ou custo maior), com o motivo**

- **Bloqueio por conta pode ser provocado por terceiros** (5 erros no admin = 15 min; renovável a cada 15 min). É o desenho pedido; o admin não tem "Esqueci a senha". Saídas: chave (conta, IP), deixar a senha certa passar fora de IP bloqueado, ou 2º fator para o admin. *Decisão do dono.*
- **IP compartilhado (CGNAT) bloqueia todos**, e só vale com a Vercel direta na frente (outro proxy faria todos compartilharem o IP).
- **Cadastro sem limite por IP e sem confirmação de email**; enumeração de emails continua possível (só some a diferença do admin). Código do grupo sem limite de tentativas.
- **Check-in por fuso**: quem está à frente de Brasília (Noronha, Europa) perde o check-in da última hora/noite; o servidor é estrito por pedido.
- **Hash falso do login é calculado na primeira vez** (custo de partida × risco de tempo na 1ª tentativa de cada instância).
- **`grupoIp` com `::` nos 4 primeiros blocos** agrupa errado o /64 IPv6 (raro).
- **Chave da conta sem `HASH_SEGREDO`** cai para SHA-256 puro.
- **Desempenho**: `pedido_status` ainda faz 5–6 consultas (e roda a limpeza) a cada chamada e o poll de 4 s devolve o plano inteiro; JS/CSS sem cache longo nem nome com hash (precisa de um passo de build); imports estáticos de `_admin`, `_treino`, etc. na partida; `eu` em 3 consultas em série; ranking varre o jsonb duas vezes e `usuarios(grupo)` sem índice; Perfil repinta a foto em data URL a cada repintura; sem service worker.
- **Segurança menor**: `console.error(e)` pode registrar mensagem do driver; HSTS/Permissions-Policy não definidos no `vercel.json`; sem `no-store` em `/api/app`.
- **Testes**: esperas de tempo real em dezenas de testes de UI; suíte de integração lenta (~3,5 min, um PGlite por arquivo); fixtures de conta/plano duplicadas; o recorte no jsdom simula canvas (o JPEG real do Chromium → servidor não é exercitado de ponta a ponta); gesto de arrastar só em jsdom; faltam testes de ordem de Tab e de erro vindo do servidor ligado ao campo.
- **Itens de menor gravidade da tabela original** (código morto, `reais()` repetido, termo com preços escritos à mão, faixas numéricas duplicadas no cliente, etc.) não foram tratados.

## Os 10 mais importantes

| # | Gravidade | Problema | Onde |
|---|---|---|---|
| 1 | alto | Login sem limite de tentativas, inclusive para contas de admin (senha de 6 caracteres, um fator só) | api/app.js:192-212 |
| 2 | alto | Qualquer 409 recarrega o app: "Já existe uma conta com este email" e "grupo cheio" somem em 1 s e o formulário volta vazio | js/app.js:52, api/app.js:204, :351 |
| 3 | alto | (já corrigido em `6932460`, falta o push) Objetivo não era lido no formulário; o Resumo quebrava e a etapa 5 mostrava o erro do termo | js/pedido.js:115 |
| 4 | médio | Prazos da LGPD (fotos 90 dias, anexos 90 dias, pedido não pago 30 dias) só rodam quando alguém abre uma tela; sem cron. Fotos de pedido travado em pago/gerando nunca saem | api/_pedido.js:315, api/_suporte.js:37, api/_admin.js:61 |
| 5 | médio | `reps` acima de 12 caracteres ou `semanas` acima de 10 recusam o plano pago inteiro (mesma classe do bug do resumo de 600) | api/_ia.js:88, :98 |
| 6 | médio | Termo atualizado no meio do formulário: o envio falha para sempre com o mesmo hash até recarregar | js/pedido.js:23, :172 |
| 7 | médio | Treino em andamento + plano trocado pela IA/renovação: `sessao` antiga aponta para treino que não existe → TypeError e tela parada | js/app.js:604, :562, :932 |
| 8 | médio | Ranking aceita check-ins com data futura: qualquer membro lidera o grupo | api/_dados.js:192, api/app.js:357 |
| 9 | médio | Cadastro revela quais emails têm conta (409) e quais são admin (403) — combinado com o item 1, mostra qual conta atacar | api/app.js:201, :204 |
| 10 | alto (desempenho) | Partida a frio: 31 comandos de schema em sequência + nodemailer + scrypt no import (~1-2 s a mais na primeira tela); logo PNG de 374 KB inserido pelo JS | api/app.js:24-153, img/fitway-logo.png |

Fora da lista, mas urgente para a Fase 2: o SQL que dá os dias de acesso e o que grava o plano gerado no aluno não rodam em Postgres em nenhum teste (uma renovação com o dobro de dias e um plano gravado na chave errada passaram nas duas suítes). Ver G.

## A. Fluxos de ponta a ponta

### O bug da etapa 5 (exemplo pedido)

**Causa:** não era o termo que deixava de carregar nem uma validação de etapa trocada. No commit `0bd1d91` (objetivo com mais de uma
escolha), a linha de `ler()` que lê as caixas do objetivo não entrou (uma substituição que não casou e passou sem aviso). O objetivo
ficava como texto; na etapa 5 → 6, `etapa++` acontecia **antes** de `pintar()`, e o Resumo lançava `f.objetivo.join is not a function`.
A tela da etapa 5 ficava parada com `etapa = 5` na memória; o próximo "Continuar" rodava a validação da etapa 6 e mostrava "Para
enviar, leia e aceite o Termo…" sobre a etapa 5. Corrigido em `6932460`, com teste de ponta a ponta (`test-integracao/pedido_ui.test.mjs`).

**Classe do problema:** estado mudado antes de um desenho que pode falhar. Mesmo padrão encontrado em: item 7 (sessão de treino com
plano trocado), `lerFoto` assíncrona que grava depois da etapa mudar, anexo do suporte que aparece em outra conversa.

| Gravidade | Onde | O que acontece | Como reproduzir | Correção proposta |
|---|---|---|---|---|
| alto | js/app.js:52, api/app.js:204, :351 | `api()` recarrega em qualquer 409; cadastro duplicado e grupo cheio usam 409 (a spec diz que 409 é só "outra conta entrou") | Criar conta com email existente | 400 nas duas respostas; sinal explícito `trocaConta` no corpo; teste de UI do cadastro duplicado |
| alto | js/pedido.js:115 | (corrigido) objetivo não lido → Resumo quebra | ver acima | `6932460` |
| médio | js/pedido.js:23, :172; api/_termo.js:205 | Termo lido uma vez; se mudar, o envio recusa sempre com o mesmo hash | Mudar `TERMO_FORO` com o Resumo aberto e enviar | No erro do termo, buscar o termo de novo, desmarcar a caixa e redesenhar |
| médio | js/app.js:604, :562, :932 | `atualizarIA` troca `data.plano` sem zerar `sessao` → TypeError ou séries marcadas no exercício errado | Iniciar treino, plano novo fica pronto, abrir outro treino | Uma `trocouPlano()` única (para cronômetro, zera sessão, acerta `proximo`) usada por todos |
| médio | api/_dados.js:192, api/app.js:357 | Check-in com data futura é aceito e conta no ranking | `salvar` com 365 datas de 2027 | Recusar datas acima de hoje+1; contar só dentro da semana/mês |
| médio | api/_ia.js:88, :98 | `reps` > 12 e `semanas` > 10 derrubam o plano pago | `validarPlanoIA` com `reps: "10-12 cada lado"` | Cortar como os textos livres, ou subir os limites |
| médio | js/pagamento.js:250, api/app.js:317 | A geração só começa quando o Perfil consulta; "Pagamento confirmado" não dispara nada e quem vai ao Início não recebe o treino | Pagar, voltar e ir para Início | Botão "Ver meu treino" (vai ao Perfil) ou um `pedido_status` ao confirmar |
| baixo | js/pedido.js:186-201 | `lerFoto` assíncrona: foto entra depois de "Continuar", sem consentimento; `focus()` em null | Foto grande + Continuar logo | Guardar etapa/hash antes do await e sair se mudaram |
| baixo | js/pedido.js:30, :149 | `parq` do rascunho com tamanho antigo passa na etapa 3 e falha no envio | Mudar o tamanho do PAR-Q com rascunho salvo | Refazer `parq` com o tamanho atual |
| baixo | js/pedido.js:177 | Recusa do servidor aparece no Resumo sem dizer a etapa | Rascunho antigo com valor inválido | Rodar `erroDaEtapa` de todas antes de enviar e pular para a etapa |
| baixo | js/app.js:150, :288 | Login e Sair desenham duas vezes (hash + render) e repetem `pedido_status` | Entrar e contar chamadas | Só chamar `render()` se o hash não mudou |
| baixo | js/app.js:1077-1090 | Volta do checkout com sessão vencida perde a rota `#/pagamento/<id>` | Pagar depois de sair | Preservar a rota depois do login |
| baixo | api/_dados.js:186 | Com 300 cargas, as novas são descartadas e o toast diz "Carga salva" | Conta com 300 cargas | Cortar as mais antigas ou avisar |
| baixo | js/admin.js:248 | Confirmação de exclusão diz que apaga "pedidos"; os pagos ficam anonimizados | Abrir "Excluir conta" | Ajustar o texto |
| baixo | api/_admin.js:172 | "Gerar de novo" num pronto reinicia a contagem das 8 semanas | Gerar de novo na semana 6 | Decidir e documentar |
| baixo | api/_suporte.js:135 | Recusa de mensagem com anexo cita os dois limites mesmo quando só um estourou | 10 mensagens/h com anexo | Dizer qual limite |
| baixo | js/suporte.js:90-99 | Anexo lido de forma assíncrona aparece em outra conversa se trocar no meio | Anexar foto grande e trocar de chamado | Conferir `geracao` depois do await |
| baixo | js/app.js:785 | Falha em "Trocar PDF" volta o botão como "Enviar PDF" | Erro no envio com plano | Recompor pelo `data.plano` |
| baixo | js/pedido.js:86 | Resumo ainda diz "você escolhe como pagar (Pix ou cartão)" como se fosse aqui; com preço único a escolha é na InfinitePay | Abrir o Resumo | "Na página segura da InfinitePay você escolhe Pix ou cartão" |
| baixo | docs/treino-ia.md:12 | Cita "Marcar como pago", que não existe mais | — | Atualizar |

## B. Segurança

Sem nada crítico. Conferido e correto: controle de acesso (toda op de admin passa por `ehAdmin`; todo SQL do aluno filtra pelo próprio
email; sem IDOR), SQL só parametrizado, todo `innerHTML` com `esc()`, CSP `script-src 'self'`, CSRF (POST JSON + `SameSite=Strict`),
cookie `HttpOnly; Secure`, só o hash do token de sessão no banco, troca de senha (token no `#`, hash, 30 min, uso único, apaga sessões),
pagamento só pelo `payment_check` com UPDATE condicional e índices únicos, saída da IA tratada como hostil, nenhum segredo no código
nem nos 85 commits do histórico, `npm audit` sem vulnerabilidades.

| Gravidade | Onde | O que acontece | Como reproduzir | Correção proposta |
|---|---|---|---|---|
| alto | api/app.js:192-212 | Login sem limite por IP nem por conta; admin com um fator só | `entrar` em loop: nunca 429 | Contar falhas por email e por IP (/64) como em `senha_pedidos`: 5/conta e 20/IP em 15 min, 429 com a mesma mensagem; admin com limite menor |
| médio | api/app.js:201, :204 | Cadastro diz se o email tem conta (409) e se é admin (403) | `criar` com o email alvo | No mínimo, o mesmo 400 para admin e conta existente; limite por IP no `criar` |
| médio | api/_pedido.js:315, api/_suporte.js:37, api/_admin.js:61 | Prazos da política (fotos 90 dias, anexos 90 dias) dependem de alguém abrir uma tela; pedidos travados nunca limpam as fotos | Pedido com fotos e ninguém abre o app nem o admin | Vercel Cron diário protegido por `CRON_SECRET` chamando as limpezas; incluir pedidos travados há mais de 90 dias |
| baixo | api/app.js:197 | Cadastro sem limite e sem confirmação de email | `criar` em loop | Limite por IP |
| baixo | api/app.js:347 | Código do grupo sem limite de tentativas | `ranking op=entrar` em loop | 10 erros por conta por hora |
| baixo | api/_senha.js:124 | Teto global de 100 links/h pode ser esgotado de propósito | ~34 contas e IPs variados | Avisar o admin quando o teto bater |
| baixo (provável) | api/_pagamento.js:85 | `payment_check` aceito sem conferir `order_nsu` (pendência P8; mitigado por índices únicos e valor) | Exige o par nsu/slug de outra pessoa | Exigir `order_nsu` igual quando a API devolver; documentar |
| baixo | api/_senha.js:114 | `senha_pedidos` guarda SHA-256 sem sal do email | Dicionário de emails num vazamento | Usar `hmacEmail()` |
| baixo | api/app.js:157, :165 | Sessão de 30 dias fixos, sem "sair de todos os aparelhos" | Cookie roubado vale 30 dias | Renovar por uso com prazo menor; botão "Sair de todos" |
| baixo | vercel.json, index.html:5 | CSP só na `<meta>`; sem HSTS explícito nem `Permissions-Policy` | Ver cabeçalhos | CSP e os dois cabeçalhos no vercel.json |

## C. Arquitetura e código

Tamanhos: js/app.js 1092 linhas (67,8 KB), js/admin.js 940 (61,7 KB), api/app.js ~360, demais módulos abaixo de 330.

| Gravidade | Onde | O que acontece | Correção proposta (só onde reduz risco) |
|---|---|---|---|
| médio | js/app.js:52 | 409 é um sinal implícito de "outra conta entrou" e já causou o item 2 | Campo explícito no corpo, ou teste que garante que só um ponto responde 409 |
| médio | api/_termo.js:170-183 | Preços escritos à mão no termo; mudar `PRECOS` deixa o termo aceito mentindo | Montar pelo `PRECOS` ou teste que compare |
| médio | js/pedido.js:43-52, :133-147 | Faixas numéricas do formulário duplicadas no cliente (opções e textos já vêm do servidor) | Mandar `NUMEROS` no `form` |
| médio | js/app.js:874, pagamento.js:214, suporte.js:15, admin.js:472, pedido.js:26 | Nomes de tipos/status e a lista `ABERTOS` copiados em 5+ lugares | Uma fonte só em `window.FitWay` ou vinda do servidor |
| baixo | 5 arquivos | `reais()` 5 vezes, `store` 3 vezes, "Sem conexão com o servidor" ~15 vezes | Expor no `window.FitWay` |
| baixo | js/app.js | Um IIFE só com estado global (`sessao`, `data`, `ia`) mexido de muitos lugares | `trocouPlano()` única; conta/senha em `js/conta.js` sob demanda |
| baixo | js/admin.js | Usuários, pedidos e suporte num arquivo; listeners presos em `#app` para sempre | Separar pedidos e suporte, carregados sob demanda |
| baixo | api/app.js:24-154 | Schema ocupa um terço do dispatcher | `api/_schema.js` com versão gravada (ver F) |
| baixo | api/app.js:323 vs api/_pedido.js:104 | Regra "ligada ou admin com termo" em dois lugares | `pedidoLiberado()` em `_precos.js` |
| baixo | api/_admin.js:214, js/app.js:479, :534 | Código morto e comentários contraditórios | Apagar |
| baixo | api/app.js:160 vs api/_termo.js:207 | Leitura do IP duplicada | Exportar `ipDe` |

## D. Layout e responsividade

Prints de 25 telas × 6 larguras (320, 375, 414, 768, 1024, 1440) em `test-integracao/prints/` (fora do git), com medições automáticas
em `medicoes.json`. Gerados por `node --experimental-test-module-mocks test-integracao/prints.mjs` (site local + PGlite). O app é escuro
(`color-scheme: dark`); os prints são do jeito que ele é.

**Sem rolagem horizontal em nenhuma tela e largura.** Contraste do texto secundário (#9a9a9a) de 5,4 a 6,7:1 — passa no AA.

| Gravidade | Tela / largura | O que acontece | Correção proposta |
|---|---|---|---|
| médio | todas com abas (login, admin) / todas | Abas "Entrar / Criar conta" com 36 px de altura; abas do admin 36 px; Semanas/Meses do Início 25 px | `min-height: 44px` nos botões de aba e no `.seg` |
| médio | treino aberto, voltar, suporte, pagamento, pedido / todas | Botões de ícone (voltar, treino anterior/próximo, mostrar senha) e "Voltar"/"Perfil" com 40 px | 44 px |
| médio | perfil, perfil-editar / todas | "Remover treino" e "Cancelar" com 35 px | 44 px no `.tools button` |
| baixo | perfil, termo, login / todas | Links soltos ("Política de privacidade", "Termo de Responsabilidade e Uso") com 14 px de altura | `padding-block` para chegar a 44 px de área (fora de parágrafo) |
| médio | admin-usuario / 320 | "Liberar até esta data" quebra em 3 linhas espremido ao lado do campo de data | Botão abaixo do campo em telas estreitas |
| baixo | perfil (com pedido) / todas | Cartão repete "Treino personalizado" no título e na linha do pedido | Mostrar só "Aguardando pagamento — R$ 9,99" |
| baixo (a verificar) | pedido-etapa6 / 320 | O documento fica ~1300 px mais alto que o conteúdo (área vazia no fim do print) | Medir a altura no Resumo; provável sobra da etapa anterior |
| baixo | admin-pedidos, admin-suporte / todas | Filtros (`select`) com 40 px | 44 px |
| info | todas | Área segura do iPhone já tratada (`viewport-fit=cover` + 3 usos de `safe-area-inset`); nenhum botão ficou atrás da barra de baixo na medição | — |
| info | todas | Teclado cobrindo campo: não dá para medir no Chromium de mesa; precisa de teste no iPhone | Testar os formulários (login, pedido etapa 1 e 3, suporte) no aparelho |

Não aparece nos prints: o campo de data mostra `mm/dd/yyyy` porque o Chromium do teste está em inglês; no celular em português sai `dd/mm/aaaa`.

## E. Acessibilidade

| Gravidade | Onde | O que acontece | Correção proposta |
|---|---|---|---|
| médio | js/pedido.js, js/app.js (formulários) | Erros só num `role="alert"` geral; nenhum campo recebe `aria-invalid` nem `aria-describedby` para o erro (só 1 uso no admin) | Marcar o campo com erro e ligar à mensagem; focar o campo |
| médio | css/style.css:80, :198 | Foco de campo é só a borda verde (`outline: none`); com 1 px de borda a diferença é pequena | Borda de 2 px ou `outline` no `:focus-visible` |
| baixo | js/pagamento.js | Estado "Confirmando pagamento…" muda sem `aria-live` | `aria-live="polite"` no bloco de status |
| info | — | Rótulos de campo presentes (`label for`); aria-live no Perfil (cartão da IA) e no suporte; abas do admin com `role="tab"`; cor não é a única informação nos status (texto junto) | — |

## F. Desempenho

Enviado ao navegador (gzip): index.html 0,4 KB, style.css 6,0 KB, app.js 20,9 KB; sob demanda admin 17,0, pedido 5,8, suporte 5,3,
pagamento 2,4 KB. Imagens: logo 374 KB (1029×528, exibido a 300 px), favicon 98 KB (299×299). Fotos de exercício externas: 71-90 KB
cada, `max-age=300`. Nada medido em LCP/INP reais (sem Lighthouse).

| Gravidade | Onde | O que acontece | Correção proposta |
|---|---|---|---|
| alto | api/app.js:24-149 | 31 comandos de schema em sequência a cada partida a frio (~0,3-1,2 s); `ALTER TABLE` provavelmente pega lock | Versão do schema gravada numa tabela; pular quando igual |
| alto | api/_email.js:3, api/app.js:153 | nodemailer (~400 ms) e um scrypt (`HASH_FALSO`) no import, em toda partida a frio | `import()` do nodemailer só ao enviar; `HASH_FALSO` na primeira chamada |
| alto | img/fitway-logo.png | Logo de 374 KB inserido pelo JS (o navegador não consegue buscá-lo antes) | WebP de 600 px (~30 KB) com `preload` |
| alto | js/app.js:475-498, :645 | Miniatura de 46 px baixa o JPEG inteiro de 850 px (~600 KB por treino de 8 exercícios) | Copiar as fotos usadas para `img/ex/` em 96 e 480 px (o `shortcut:` da linha 474 já prevê) |
| alto | js/app.js:766, api/app.js:315 | Cada repintura do Perfil (Editar, Cancelar, Trocar senha) refaz `pedido_status`: 5-7 consultas, 2 UPDATEs de limpeza | Consultar só ao entrar na tela; limpeza no cron (item B) |
| médio | api/app.js:166 | Toda requisição autenticada lê `dados` inteiro (plano, check-ins), inclusive os polls de 8 e 30 s | Selecionar só o necessário na sessão |
| médio | js/suporte.js:185, api/_suporte.js:98 | Poll de 8 s grava `lido_aluno_em` toda vez, mesmo sem mensagem nova | Só gravar quando houver mensagem nova |
| médio | js/admin.js:774, api/_suporte.js:151 | Lista do admin a cada 30 s roda 2 UPDATEs globais de limpeza | Limpeza no cron |
| médio | api/_admin.js:61 | Resumo do admin varre tabelas inteiras e todos os check-ins | Cron + medir com EXPLAIN |
| médio | js/app.js:666 | Troca da foto a cada 900 ms continua com a aba escondida | Parar com `document.hidden` |
| médio | js/app.js:575-715 | Cada toque em "Concluir série" refaz a tela de treino inteira (8-16 imagens) | Refazer só o exercício tocado |
| médio | js/admin.js:641, :670 | Detalhe do pedido devolve 4 fotos + comprovante (~2 MB) e cada clique numa foto redesenha tudo | Ampliar num `<dialog>` à parte |
| médio | vercel.json | Sem cache para js/css/img; toda visita revalida tudo | Versão no nome + `immutable` |
| baixo | api/app.js:349 | Ranking filtra `grupo` sem índice | Índice parcial em `usuarios(grupo)` |
| baixo | api/app.js:200 | Limpeza de sessões em todo login, sem índice em `expira`/`email` | Índice `sessoes(email)`; limpeza no cron |
| baixo | img/fitway-favicon.png | Favicon de 98 KB | 32 px e 180 px separados |

## G. Testes

`npm test` 174/174 (saída 0). `npm run test:integracao`: 1 falha em 4 execuções (`suporte_auto.test.mjs:75`, instável), as outras 3
com 64/64. Mutações feitas numa cópia do repositório (o repositório não foi mexido):

| Mutação | Pega? |
|---|---|
| Tirar a checagem de PAR-Q "Sim" sem liberação no formulário | não |
| Tirar a checagem da autorização de dados (`cdados`) | não |
| Tirar o limite da etapa do rascunho | não |
| `sair()` deixa de apagar o rascunho `fw_pedido_*` (dados de saúde) | não |
| Renovação dá o dobro de dias | **não** |
| Plano gerado gravado na chave errada (aluno nunca recebe o treino) | **não** |
| "Gerar de novo" sem a trava de outro pedido aberto | não |
| Tirar a guarda de `transaction_nsu` | sim |
| Expiração do pedido em 300 dias | sim |

| Gravidade | Onde | O que falta ou está fraco | Teste proposto |
|---|---|---|---|
| alto | api/_pagamento.js:22-33 | O SQL que dá os dias de acesso só é conferido por regex; renovação com o dobro de dias passa | PGlite: inicial e mensalidade somam 30 dias a `greatest(now(), acesso_ate)`; novo_treino 0; webhook repetido não soma |
| alto | api/_ia.js:135-137 | O banco falso ignora a gravação do plano no aluno; plano na chave errada passa | PGlite: `gerarSeDevido` com IA falsa → `dados.plano.pedido = id`, `proximo = "A"` |
| alto | test/geracao.test.js:113 | A "corrida" da geração só prova o JavaScript do banco falso | PGlite: duas chamadas em paralelo → IA 1 vez; retomada após 3 min; 2 tentativas → erro |
| alto | test-integracao/suporte_auto.test.mjs:75 | Instável: mede o recuo pelo relógio real com margem apertada (falhou com 328 < 328,5) | Conferir os `ms` passados ao `setTimeout` (160, 320, 600) |
| alto | api/_admin.js:172 | "Gerar de novo" sem teste da trava de outro pedido aberto | PGlite: pedido erro + outro aguardando → 400 |
| alto | js/pedido.js | Sem teste de UI: PAR-Q "Sim", erro de cada etapa, rascunho restaurado, novo treino com `ultimas` antigas (objetivo como texto) | Testes em tabela no jsdom |
| alto | js/app.js:280 | Sair não é testado (rascunho de saúde e sessão) | UI: sair → sem `fw_pedido_*`, `eu` dá 401 |
| alto | js/app.js:132 | Login pela tela sem teste (erro e sucesso) | UI |
| alto | js/app.js:1076, js/pagamento.js | Volta do checkout, confirmação automática, "Já paguei" e "temporário" sem teste | UI com `payment_check` falso |
| alto | js/app.js:875-944 | Estados do cartão da IA no Perfil (gerando, erro, pronto, ativo, renovar, novo treino) sem teste | Um teste por status |
| alto | ranking e grupos | Nenhum teste (janela de datas, 50 membros, código errado, sem email dos membros) | PGlite + UI |
| alto | check-in, treino, cargas | Iniciar, concluir série, finalizar, editar carga: zero testes | UI com plano de PDF |
| médio | test/dados.test.js:13 | O teste "não perde" fixa que um aparelho desatualizado sobrescreve a carga mais nova | Decidir a regra e testar |
| médio | PDF, limpezas de prazo, cancelar, webhook ponta a ponta, renovação e novo treino | Só com banco falso ou sem teste | PGlite |
| médio | js/admin.js | Lista, busca, editor de plano, acesso, filtros, Verificar, Gerar de novo e Cancelar sem teste de UI | UI admin com efeito no banco |
| baixo | suporte_auto.test.mjs:43, senha.test.js:121, pagamento.test.js:50 | Asserção condicional, texto procurado no código-fonte em vez do comportamento, regex de SQL | Trocar por comportamento |
| baixo | — | Aluno não pode excluir a própria conta (só o admin, pelo suporte) | Confirmar se é intencional |
