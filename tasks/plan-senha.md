# Plano: esqueci a senha (spec: docs/senha.md)

- [ ] P1. nodemailer 10.3.1 e `api/_email.js` (TDD com transporte falso).
- [ ] P2. Banco: `senha_tokens` e `senha_pedidos`; `senhaHash`/`confere` movidos para `api/_senha.js` (mesmo scrypt).
- [ ] P3. `senha_pedir` e `senha_disponivel` (TDD): mensagem única, piso de tempo, limites, token com hash.
- [ ] P4. `senha_nova` (TDD): uso único, 30 min, apaga sessões, log, aviso.
- [ ] P5. `senha_alterar` no Perfil (TDD).
- [ ] P6. Telas: "Esqueci a senha", `#/nova-senha/<token>` (limpa o endereço), "Trocar senha" no Perfil.
- [ ] P7. Política `2026-11-16-3`, README (variáveis), PGlite + jsdom.
- [ ] P8. 4 agentes (segurança focada em roubo de conta), correções, push.
