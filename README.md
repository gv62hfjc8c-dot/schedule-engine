# Schedule Engine

Motor de geração e validação de horários, desenvolvido como sistema independente e reutilizável.

A interface React existente serve apenas para demonstrar e exercitar o núcleo. O objetivo do projeto é evoluir o motor de scheduling sem o acoplar a uma empresa, interface, backend ou tecnologia de persistência específica.

## Estado atual — V0

O `main` atual é um reset deliberado para um núcleo pequeno e verificável.

O V0 suporta:

- pessoas com identificador e nome;
- três turnos fixos (`A`, `B`, `C`);
- elegibilidade opcional de cada pessoa por turno;
- geração determinística de segunda a sexta;
- 8 horas efetivas por dia;
- 40 horas efetivas por semana;
- manutenção do mesmo turno durante toda a semana;
- validação independente do gerador.

Ainda **não** suporta cobertura, equipas, disponibilidades, folgas, férias, fins de semana, preferências, fairness, histórico ou otimização. Essas capacidades existiram no protótipo anterior, mas não fazem parte do núcleo V0 atual.

## Hard constraints V0

O validador verifica atualmente:

1. existência de uma célula por pessoa e dia útil;
2. existência do turno atribuído;
3. elegibilidade da pessoa para o turno;
4. 480 minutos efetivos por turno/dia;
5. consistência do turno durante a semana;
6. 2400 minutos efetivos por semana.

O gerador não deve produzir deliberadamente uma atribuição que viole uma hard constraint. Se uma pessoa tiver uma lista explícita de turnos elegíveis vazia, não é atribuída a nenhum turno; o validador independente identifica então o horário como incompleto.

## Executar

```bash
npm install
npm run dev
```

## Verificações

```bash
npm run typecheck
npm test
npm run verify:engine
npm run build
```

- `npm test` executa os testes do gerador e do validador.
- `npm run verify:engine` executa um cenário integrado simples sem abrir o browser.
- `npm run build` confirma também a integração com a aplicação React/Vite.

## Estrutura principal

```
src/
  types.ts
  utils/
    shifts.ts
    generateSchedule.ts
    validateSchedule.ts
  generatorTest.ts
  validatorTest.ts
  App.tsx
docs/
  architecture.md
  conventions.md
  decisions.md
  roadmap.md
  changelog.md
```

## Direção

A prioridade é manter o ciclo:

**decisão → implementação → teste → validação → próxima decisão**

O próximo passo do motor não é reconstruir de imediato todas as funcionalidades do protótipo anterior. Primeiro deve ser formalizado um modelo mínimo de disponibilidade e necessidade de cobertura, distinguindo hard constraints de soft constraints e mantendo o validador independente do algoritmo de geração.
