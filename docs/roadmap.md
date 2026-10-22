# Roadmap

## Fase 0 — Baseline verificável

Estado: **em curso**

- [x] núcleo independente de React;
- [x] catálogo explícito de turnos;
- [x] geração determinística;
- [x] elegibilidade por turno;
- [x] validador independente;
- [x] testes básicos de hard constraints;
- [x] gerador não viola deliberadamente elegibilidade impossível;
- [x] comandos únicos para testes e verificação;
- [ ] validação estruturada por códigos de constraint;
- [ ] validação de inputs do problema.

## Fase 1 — Modelo mínimo de scheduling

- [ ] período/dias explícitos em vez de semana fixa de 5 dias;
- [ ] disponibilidades por pessoa/período;
- [ ] necessidades de cobertura;
- [ ] distinção formal entre hard e soft constraints;
- [ ] resultado de geração com estado: válido / inviável / parcial;
- [ ] conflitos explicáveis.

## Fase 2 — Geração baseada em constraints

- [ ] satisfazer cobertura obrigatória;
- [ ] respeitar indisponibilidades;
- [ ] limites de horas;
- [ ] descanso e regras entre turnos quando aplicável;
- [ ] cenários inviáveis com diagnóstico;
- [ ] suite de casos reais e regressões.

## Fase 3 — Qualidade da solução

- [ ] fairness/distribuição;
- [ ] preferências;
- [ ] continuidade/histórico;
- [ ] função de score;
- [ ] comparação objetiva entre soluções.

## Só depois

Avaliar se o problema justifica um solver especializado (por exemplo CP-SAT) e em que camada deve executar. A decisão deve ser baseada em constraints reais, volume e performance medidos.
