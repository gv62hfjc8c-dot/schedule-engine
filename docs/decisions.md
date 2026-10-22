# Decisões

## D001 — Schedule Engine é independente da aplicação Borja Reis

**Estado:** aceite

O motor é um sistema reutilizável. Regras específicas de uma organização devem entrar como configuração/dados, não como dependências do núcleo.

## D002 — Gerador e validador são componentes distintos

**Estado:** aceite

O gerador propõe uma solução. O validador determina se essa solução cumpre as hard constraints.

Não se assume que um horário é válido apenas por ter sido gerado internamente.

## D003 — Hard constraints não são negociáveis

**Estado:** aceite

Quando o gerador sabe que uma atribuição viola uma hard constraint, não deve fazê-la para preencher artificialmente o horário.

Exemplo V0: `eligibleShiftIds: []` significa que não existe qualquer turno elegível. A pessoa fica sem atribuição e o validador reporta a incompletude.

## D004 — Manter o V0 simples antes de escolher um solver

**Estado:** aceite

Não introduzir CP-SAT, programação inteira ou outro solver antes de existir um modelo de domínio e um conjunto de constraints suficientemente claros e testados.

O algoritmo atual pode ser simples enquanto permitir validar o contrato do motor.

## D005 — React é um consumidor do motor

**Estado:** aceite

A interface atual não define a arquitetura final. A lógica de scheduling deve continuar em funções independentes da UI.
