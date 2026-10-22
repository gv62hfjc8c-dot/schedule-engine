# Changelog

## 2026-10-22 — Auditoria e hardening do V0

- alinhada a documentação com o código após o reset do core;
- corrigido o gerador para não atribuir turnos inelegíveis quando uma pessoa tem zero turnos elegíveis;
- atualizado o teste do validador para o comportamento de cenário inviável;
- adicionado teste específico de regressão no gerador;
- reparado `scripts/verificar-motor.mts`, que ainda dependia de módulos removidos no reset;
- adicionados comandos `typecheck`, `test`, `test:validator` e `verify:engine`;
- registadas decisões arquiteturais e roadmap do motor.
