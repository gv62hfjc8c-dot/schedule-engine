# Arquitetura

## Estado atual

O Schedule Engine tem agora duas fundações independentes do algoritmo de geração:

1. calendário operacional contínuo;
2. pessoas que podem participar em horários.

### Calendário operacional

`src/types.ts` contém:

- `OperatingInterval`
- `WeeklyOperatingHours`
- `OperatingHoursException`
- `OperatingCalendarConfiguration`

`src/utils/operatingCalendar.ts` resolve o horário efetivo de qualquer data a partir do padrão semanal e das exceções.

Não existe um período global de planeamento.

### Pessoas

O modelo mínimo é:

```ts
interface Person {
  id: string;
  name: string;
  active: boolean;
}
```

`src/utils/people.ts` contém operações puras para:

- normalizar o nome;
- criar uma pessoa;
- alterar o nome;
- arquivar/reativar;
- obter apenas pessoas ativas.

Uma pessoa arquivada continua a existir no domínio. Apenas deixa de ser considerada para horários futuros.

### Interface

`src/App.tsx` é uma ferramenta visual para configurar estes conceitos.

A UI não define o domínio e não deve introduzir regras de scheduling.

## Limites

Ainda não existem:

- disponibilidade;
- cobertura;
- turnos;
- contratos;
- horas de trabalho;
- geração de horários.

Autenticação, permissões e persistência continuam fora do núcleo.

## Regra arquitetural

Introduzir um conceito de cada vez e validar o seu contrato antes de construir o seguinte.
