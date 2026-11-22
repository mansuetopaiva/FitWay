# Foto de perfil (recorte)

**Fluxo:** Perfil → Editar → Adicionar/Trocar foto → o arquivo escolhido abre o recorte (`js/recorte.js`, baixado só nessa hora) → Salvar envia ao servidor. Nada é gravado antes de Salvar; Cancelar/Esc mantém a foto anterior.

**Recorte (cliente):** moldura circular de pré-visualização sobre um quadrado; arrastar move; zoom por barra, botões + e −, roda do mouse e pinça (pointer events, sem biblioteca). O zoom mínimo é o que cobre o quadrado (nunca aparece fundo vazio); o máximo é 4x. Teclado: setas movem, + e − dão zoom, Enter salva, Esc cancela, Tab fica dentro do recorte; o foco volta ao botão "Trocar foto". O zoom é anunciado em `aria-live`.
Saída: 512x512, JPEG qualidade 0,85, desenhada em canvas — por isso os metadados da foto original (local, câmera) não vão junto. Se passar de 140 mil caracteres, baixa a qualidade (0,75, 0,65, 0,55).
Entrada aceita: JPEG, PNG, WebP, GIF, HEIC/HEIF até 12 MB e no mínimo 128 px de lado. Orientação EXIF: o navegador já gira; se não girou (EXIF de 90° e bitmap com o tamanho cru), o app gira antes do recorte (`transformacao`). *Limite:* a detecção só vale para as orientações de 90° (5 a 8); espelhamento e 180° dependem de o navegador aplicar o EXIF.

**Servidor (`api/_foto.js`):** trata a foto como entrada hostil. Aceita só `data:image/jpeg;base64,…` de até 150 mil caracteres, percorre os marcadores do JPEG, exige imagem quadrada de 64 a 1024 px terminando em EOI, e **remove** EXIF/GPS, XMP, IPTC e comentários (APP1..APP15 menos o perfil de cor, e COM) antes de gravar a versão limpa. `""` remove a foto.

**Fotos antigas (160x160):** continuam válidas e aparecem como antes; a coluna `usuarios.foto` não mudou e nada foi migrado.

**Desempenho:** a foto (até ~110 KB) não é mais lida em toda requisição autenticada: só no `eu` e no login.

**Testes:** `test/foto_perfil.test.js` (servidor), `test/recorte.test.js` (geometria e EXIF), `test-integracao/foto_perfil.test.mjs` (PGlite), `test-integracao/foto_recorte_ui.test.mjs` (tela no jsdom) e as telas `perfil-recorte*` do `npm run test:layout` (Chromium real, 320/375/768 px e altura de 360 px para o teclado do celular).
