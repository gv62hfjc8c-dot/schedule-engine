# Arquitetura

## Estado atual

O Schedule Engine está deliberadamente numa arquitetura mínima.

### Domínio

`src/types.ts` contém os tipos do núcleo:

- `Pessoa`
- `Shift`
- `ScheduleCell`
- `Schedule`
- `ValidationResult`

### Catálogo de turnos

`src/utils/shifts.ts` define os turnos disponíveis no V0.

### Gerador

`src/utils/generateSchedule.ts` é uma função pura que recebe pessoas e a data inicial da semana e devolve um horário.

O algoritmo V0 é determinístico e simples: usa uma rotação A/B/C e procura o primeiro turno elegível a partir da posição base de cada pessoa.

### Validador

`src/utils/validateSchedule.ts` valida o resultado independentemente do gerador.

Esta separação é intencional: um horário só é considerado válido porque satisfaz as constraints verificadas pelo validador, e não simplesmente porque foi produzido pelo gerador.

### Interface

`src/App.tsx` é um cliente de demonstração. React não faz parte do domínio do motor.

## Fronteiras arquiteturais

O motor não deve depender de:

- React;
- browser;
- localStorage;
- uma empresa ou equipa específica;
- backend/API;
- base de dados.

Essas integrações poderão existir em camadas externas.

## Próxima evolução

Antes de introduzir um solver ou algoritmo de otimização, o domínio deve ganhar conceitos explícitos para:

1. período/dia;
2. disponibilidade;
3. necessidade de cobertura;
4. constraints identificáveis;
5. violações estruturadas;
6. qualidade/score para soft constraints.

A prioridade é correção e explicabilidade, não sofisticação algorítmica.
