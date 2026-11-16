# Plano: suporte por chamados (spec: docs/suporte.md)

- [x] S1. Banco: tabelas `chamados` e `chamado_mensagens` e índices no `schema()`.
- [x] S2. `api/_suporte.js` (TDD): validação de texto e anexo, ações do aluno com posse no SQL, limites, `limparChamados`.
- [x] S3. `app.js`: liga as ações; `suporteNaoLido` em `eu` e `pedido_status`; `limparChamados` junto do `limparPedidos`.
- [x] S4. Admin (TDD): `suporte_lista`, `suporte_chamado`, `suporte_responder`, `suporte_encerrar`, `suporte_reabrir`, `suporte_anexo`,
      `suporteAguardando` no resumo.
- [x] S5. Exclusão de conta (TDD): `usuario_excluir`.
- [x] S6. Tela do aluno (`js/suporte.js`, lazy): lista, abrir, conversa; card no Perfil e ponto na aba.
- [x] S7. Painel: aba Suporte, conversa com contexto, botões; "Excluir conta" no detalhe do usuário.
- [x] S8. Política de privacidade `2026-11-16-2`.
- [x] S9. README "Suporte"; PGlite + jsdom fora do repositório.
- [ ] S10. 4 agentes (código, segurança, testes, UI), correções, push.
