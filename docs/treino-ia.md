# Spec: Treino com IA, pedidos e cobrança

## Objetivo

A pessoa pede um treino personalizado. Preenche um formulário em etapas, o pedido fica "aguardando pagamento", o admin confirma o pagamento e a IA monta um plano de 8 semanas com fases.

- **Pedido inicial:** R$ 9,99; dá 30 dias de acesso.
- **Mensalidade:** R$ 9,99 por mês; mantém o treino visível.
- **Novo treino:** R$ 4,99, depois de 8 semanas com o plano atual e com acesso ativo.
- **Acesso vencido:** o treino da IA some da aba Treinos, mas continua guardado. Check-ins, ranking e cargas seguem normais.

**Chave de liga/desliga:** `TREINO_IA_ATIVO` só liga com o valor exato `"1"`. Desligado, usuário comum não vê o pedido inicial, o novo treino nem o formulário, e `pedido_criar` responde "Em breve."; admin continua vendo e podendo pedir. Renovar e ver um treino de IA existente funcionam sempre. Sem `ANTHROPIC_API_KEY`, "Marcar como pago" (e "Gerar de novo") de um pedido que gera treino responde "Chave da IA não configurada." sem mudar o status.

**Fora do escopo:** qualquer meio de pagamento (Pix, cartão, InfinitePay). Todo pedido nasce `aguardando_pagamento` e o admin marca como pago.

## Stack e comandos

O stack não muda. Nenhuma dependência nova: a IA é chamada por `fetch`, como você pediu.

```
npm test
node --check api/*.js js/*.js
vercel dev      # precisa de ANTHROPIC_API_KEY e, opcional, IA_MODELO no .env.local
```

## Estrutura

```
api/_precos.js         NOVO  PRECOS, podePedir, efeitoDoPagamento, acessoAtivo, planoVisivel (puro)
api/_pedido.js         NOVO  PARQ, OPCOES, limparRespostas, limparFotos, criarPedido(sql, u, b, headers, agora)
api/_ia.js             NOVO  SCHEMA, montarRequisicao, chamarIA (fetch), lerResposta, validarPlanoIA, gerarSeDevido(sql, id, {ia})
                             (gerarSeDevido fica aqui, não em _pedido.js, para não haver import circular com _prompt.js)
api/_termo.js          NOVO  TERMOS (atual + antigas), TERMO, termoDaVersao, registrarAceite
api/_prompt.js         NOVO  PROMPT, montarPrompt(respostas, contexto)
api/_material_apoio.md NOVO  material de apoio
api/_dados.js          limpar() e validarPlano() aceitam plano.guia
api/_admin.js          ops de pedidos, resumo novo
api/app.js             tabela pedidos, ações pedido_criar e pedido_status; publico() esconde o plano de IA vencido
js/pedido.js           NOVO  formulário em etapas (baixado só ao abrir o formulário)
js/app.js              Perfil (estado do acesso e do pedido), cartão "Como funciona seu plano"
js/admin.js            aba Pedidos
vercel.json            maxDuration 60
test/precos.test.js, test/pedido.test.js, test/ia.test.js   NOVOS
```

## Contrato

### Preços e regras (`api/_precos.js`)

- `PRECOS = { inicial: 999, mensalidade: 999, novo_treino: 499 }` (centavos).
- `podePedir(tipo, u, agora, pedidoAberto)` devolve `{ ok }` ou `{ erro }`.
  - **inicial:** a conta não tem plano de IA.
  - **mensalidade:** a conta tem plano de IA, ativo ou vencido.
  - **novo_treino:** plano de IA com `agora - plano.criado >= 56 dias` e `acesso_ate > agora`.
  - **Sempre:** recusa se existe pedido aberto (`aguardando_pagamento`, `pago` ou `gerando`).
- `efeitoDoPagamento(tipo)`:
  - inicial: `{ dias: 30, gerar: true }`;
  - mensalidade: `{ dias: 30, gerar: false }`;
  - novo_treino: `{ dias: 0, gerar: true }`.
  - Os dias somam a partir de `greatest(now(), acesso_ate)`.
- `planoVisivel(u, agora)`: um plano com `origem: "ia"` só é devolvido com `acesso_ate > agora`. PDF e admin aparecem sempre.

### Banco (em `schema()`)

```sql
create table if not exists pedidos (
  id text primary key, email text not null references usuarios on delete cascade,
  tipo text not null check (tipo in ('inicial','mensalidade','novo_treino')),
  status text not null check (status in ('aguardando_pagamento','pago','gerando','pronto','erro','cancelado')),
  valor int not null, metodo text, respostas jsonb, fotos jsonb, aceite jsonb, plano_gerado jsonb, modelo text, erro text,
  tentativas int not null default 0,                    -- ver decisão D3
  criado timestamptz not null default now(), pago_em timestamptz, gerado_em timestamptz, atualizado timestamptz
);
create index if not exists pedidos_email_criado on pedidos (email, criado desc);
create index if not exists pedidos_status on pedidos (status);
-- no máximo 1 pedido aberto por usuário, garantido também pelo banco (corrida de dois cliques):
create unique index if not exists pedidos_um_aberto on pedidos (email) where status in ('aguardando_pagamento','pago','gerando');
```

### Ações do usuário

- **`pedido_criar { tipo, respostas?, fotos? }`:**
  - roda `podePedir` no servidor;
  - em `inicial` e `novo_treino`, roda `limparRespostas` e `limparFotos`;
  - grava `valor = PRECOS[tipo]` e status `aguardando_pagamento`;
  - devolve o pedido sem as fotos.
- **`pedido_status`:**
  - devolve o pedido mais recente (sem fotos), `acessoAte` e o que o Perfil precisa decidir: `temPlanoIA`, `podeRenovar`, `podeNovoTreino`;
  - antes de responder, chama `gerarSeDevido`.

### Geração (`gerarSeDevido`)

1. **Pegar o pedido:** um único `UPDATE pedidos SET status='gerando', tentativas=tentativas+1, atualizado=now() WHERE id=$1 AND (status='pago' OR (status='gerando' AND atualizado < now() - interval '3 minutes')) RETURNING *`. Só quem recebe a linha gera; as outras chamadas seguem sem gerar.
2. **Chamar a IA e validar** a resposta com `validarPlanoIA`.
3. **Se der certo:** numa instrução só, grava `usuarios.dados.plano` (`origem:"ia"`, `criado`, `semanas: 8`, `pedido: id`, `guia`) e o pedido como `pronto` com `plano_gerado`.
4. **Se falhar:**
   - com `tentativas < 2`, o pedido volta para `pago` e a próxima consulta tenta de novo;
   - com 2 tentativas, vira `erro` com a mensagem.
5. **Mensalidade:** quando paga, vai direto para `pronto`.

### Formulário

Etapas: Você, Rotina, Saúde, Fotos, Observações e Resumo. Os limites e opções são os do pedido. Detalhes:

- **Idade:** de 18 a 90 anos (sem caixa de responsável).
- **PAR-Q:** qualquer "Sim" (perguntas 1 a 7) exige a caixa de liberação médica, e o servidor recusa sem ela, mesmo que o navegador mande assim.
- **Fotos:**
  - frente, costas, perfil direito e perfil esquerdo;
  - reduzidas no aparelho a JPEG com lado maior de até 768 px e qualidade 0,8;
  - o servidor aceita só `data:image/jpeg;base64`, as 4 chaves e até 300 KB por foto (cerca de 1,2 MB no total, abaixo dos 4,5 MB da Vercel).
- **Consentimentos:** o de fotos é obrigatório se houver foto; o de dados de saúde é obrigatório sempre (consentimento específico da LGPD para dado sensível). Ficam em `respostas.consentimentos`, com a hora do servidor.
- **Termo de Responsabilidade e Uso** (`api/_termo.js`, `TERMO = { versao, texto }`, versões antigas na lista `TERMOS`):
  - o Resumo mostra o texto inteiro numa caixa com rolagem e a caixa obrigatória "Li e aceito…", que substitui a caixa sobre IA;
  - o app recebe o texto pela ação `termo` (`{ versao? }`, pública);
  - `pedido_criar` recusa sem aceite ou com versão diferente da atual; grava `pedidos.aceite = { versao, aceito_em (hora do servidor), ip (1º valor de x-forwarded-for), user_agent (até 200) }`;
  - mensalidade não precisa de aceite; novo_treino precisa;
  - o admin vê "Termo aceito: versão X em DD/MM/AAAA HH:MM" e abre o texto daquela versão; o Perfil tem o link para o texto atual.
- **Prazos (`limparPedidos`, no `pedido_status` do próprio usuário e no resumo do admin, sem cron):**
  - fotos apagadas 90 dias depois do pedido ficar `pronto`, `cancelado` ou `erro`; as respostas ficam;
  - pedido `aguardando_pagamento` há mais de 30 dias vira `cancelado` e perde as fotos (termo 2026-11-16, item 4.3).
- **Respostas de recusa:** 400 com a mensagem. O 409 fica só para "outra conta entrou neste navegador", porque o app recarrega a página em qualquer 409.
- **Rascunho:** as respostas, sem fotos, ficam no `localStorage` até o envio. No `novo_treino`, o formulário vem com as respostas do último pedido, sem as fotos.

### IA (conforme a documentação oficial; detalhes na seção "Decisões")

- **Requisição:** `POST https://api.anthropic.com/v1/messages` com os headers `x-api-key`, `anthropic-version: 2026-10-21` e `content-type: application/json`.
- **Modelo:** `process.env.IA_MODELO || "claude-sonnet-5-5"`, com `max_tokens: 8000` e `output_config: { effort: "medium" }`.
- **System, em dois blocos de texto:**
  1. as instruções fixas, o material de apoio e a lista de exercícios, com `cache_control: {type:"ephemeral"}` no fim;
  2. nada que varie por pedido.
- **Mensagem do usuário:** as regras que dependem do aluno (objetivo, dias, minutos, nível), o plano anterior (só no `novo_treino`), os dados do aluno entre `<dados_do_aluno>`, com `<` e `>` escapados, e as fotos como blocos `image` base64, cada uma precedida de "Foto: frente" etc.
- **Saída:** `output_config.format` com JSON Schema, no lugar de uma tool forçada (decisão D1).
  - O schema traz tipos, `enum` de `NOMES_FOTOS`, `required` e `additionalProperties: false`.
  - Tamanhos e faixas numéricas não são aceitos pelo schema e são conferidos em `validarPlanoIA`.
- **Recusa e erros:**
  - sem fallback por enquanto (decisão D5);
  - `stop_reason` `refusal` ou `max_tokens` conta como falha;
  - o modelo que gerou (`model` da resposta) fica em `pedidos.modelo`.
- **`validarPlanoIA(json)`:** confere todos os limites do pedido e converte para `{ nome, origem:"ia", criado, semanas: 8, pedido, guia: { resumo, avaliacao_fotos, fases, cardio, progressao, cuidados }, treinos: [{ id:"A", nome, exercicios: [[nome, foto(nome), series, reps, 0, descanso, obs]] }] }`.

### Admin

- **Aba Pedidos:**
  - filtros por status e por tipo;
  - lista com nome, tipo, valor, status (texto e cor) e data;
  - detalhe com as respostas por etapa, o PAR-Q destacado, as fotos (ampliar ao tocar) e o plano gerado.
- **Ações:**
  - `pedido_pago`: um UPDATE condicional `aguardando_pagamento → pago` (ou `pronto` na mensalidade); os dias de acesso e o `admin_log` na mesma instrução;
  - `pedido_gerar_de_novo`: de `erro` ou `pronto` para `pago`, com `tentativas = 0`;
  - `pedido_cancelar`: só de `aguardando_pagamento`, `pago` ou `erro`.
- **Log:** abrir um pedido com dados de saúde ou fotos grava uma linha no `admin_log`.
- **Resumo:** pedidos aguardando pagamento, receita do mês (soma de `valor` dos pedidos com `pago_em` no mês corrente, em America/Sao_Paulo) e acessos que vencem nos próximos 7 dias.

### Perfil e aba Treinos

São os estados do pedido (seção 4) e o cartão "Como funciona seu plano". A fase atual sai de `floor((agora - plano.criado) / 7 dias) + 1`.

## Testes

São os do item 8 do pedido. Datas sempre com um "agora" fixo, e `sql` e `fetch` simulados.

## Limites

- **Sempre:**
  - decidir preço, permissão e acesso no servidor;
  - toda entrada do navegador é hostil, inclusive contra prompt injection: o texto livre vai delimitado e escapado e nunca entra no system;
  - toda escrita do admin vai para o log.
- **Perguntar antes:** dependência nova; mudar o formato de algo já gravado; push.
- **Nunca:**
  - chave da API no navegador ou no git;
  - gerar treino sem pedido pago;
  - devolver fotos em listas;
  - tratar a saída da IA como confiável sem `validarPlanoIA`.

## Decisões (resultado da revisão das regras e da documentação oficial)

- **D1. `tool_choice` forçado não existe no `claude-sonnet-5-5`** (a API devolve 400). A tool `salvar_treino` é trocada por `output_config.format` com JSON Schema, que garante o formato. O schema não aceita `maxLength`, `minimum` nem `maxItems`, então esses limites ficam em `validarPlanoIA`, como você já pediu.
- **D2. Ordem do prompt e cache.** O cache só aproveita um começo de requisição idêntico (tools → system → messages). No texto do PROMPT, as regras com `{{objetivo}}`, `{{dias}}` etc. vêm **antes** do material de apoio, então o cache nunca acertaria. A troca: o system fica só com o que é igual em todo pedido (papel, regras fixas, material, exercícios permitidos), com `cache_control`; as regras que dependem do aluno, o plano anterior e os dados do aluno vão na mensagem do usuário. O texto do PROMPT continua o seu, só dividido em duas partes. A separação também ajuda contra prompt injection, porque nada do aluno entra no system.
- **D3. "Falhar 2 vezes" dentro de 60 s.** Uma geração com fotos e saída de cerca de 5 mil tokens pode levar de 30 a 50 s, e duas tentativas na mesma chamada não cabem em 60 s. Proposta: uma tentativa por chamada, com a coluna `tentativas`; a segunda falha vira `erro`. Uso `effort: "medium"` para reduzir o tempo.
- **D4. Admin editando um plano de IA** (`plano_salvar`): hoje o plano viraria origem "admin" e ficaria visível sem pagar, além de zerar a contagem das 8 semanas. Proposta: ao editar um plano de IA, manter `origem`, `criado`, `semanas`, `pedido` e `guia`.
- **D5. Fallback em caso de recusa: desligado.** No `claude-sonnet-5-5`, o `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) só refaz no `claude-sonnet-5` as recusas das categorias `cyber` e `frontier_llm`, que um treino de musculação não aciona; as de `bio`, `reasoning_extraction` e `general_harms` não são refeitas. Ligar só acrescentaria um header beta. O modelo que respondeu fica gravado em `pedidos.modelo` de qualquer forma.
- **D6. Versão da API `2026-10-21`**, a atual na página oficial de versões (https://platform.claude.com/docs/en/api/versioning). Ela recusa `temperature`, `top_p` e `top_k`, que não são usados.

## Decisões do dono do produto (15/11/2026)

1. PDF por cima do treino de IA: permitido com aviso, para o usuário e para o admin.
2. PAR-Q: qualquer "Sim" (1 a 7) exige liberação médica.
3. Idade mínima 18 anos.
4. Fotos apagadas 90 dias depois do pedido pronto; as respostas ficam.
5. Cancelar pedido pago: os dias de acesso já dados continuam valendo.
