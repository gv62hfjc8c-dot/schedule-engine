# Schedule Engine

Projeto dedicado à construção de um motor de horários reutilizável e independente de qualquer empresa específica.

## Estado atual

Estamos a reconstruir o motor desde a base.

Neste momento o projeto contém apenas o calendário operacional contínuo:

1. **horário semanal de funcionamento**;
2. **dias fechados**;
3. **exceções por data**.

Ainda não existem pessoas, turnos de trabalho, cobertura, disponibilidade, folgas ou geração automática de horários. Esses conceitos serão introduzidos um a um.

## Princípio

O motor não está preso a uma janela temporal de planeamento.

A empresa define um padrão semanal contínuo e pode acrescentar exceções em datas específicas. Quando, no futuro, outro componente pedir um horário para uma semana, mês ou qualquer intervalo, essa janela será apenas uma consulta sobre esta configuração contínua.

O motor não assume:

- segunda a sexta;
- horários fixos;
- dias úteis específicos;
- uma duração padrão de semana;
- uma data inicial ou final global.

## Modelo atual

```ts
interface OperatingInterval {
  start: string;
  end: string;
}

type WeeklyOperatingHours = Record<
  Weekday,
  OperatingInterval[]
>;

interface OperatingHoursException {
  date: string;
  intervals: OperatingInterval[];
}

interface OperatingCalendarConfiguration {
  weeklyOperatingHours: WeeklyOperatingHours;
  exceptions: OperatingHoursException[];
}
```

Um array vazio de intervalos significa que o dia está fechado.

## Autorização

Quem pode editar esta configuração pertence à aplicação que utiliza o motor.

O Schedule Engine apenas recebe e utiliza os dados.

## Executar

```bash
npm install
npm run dev
```

## Verificar

```bash
npm run typecheck
npm test
npm run build
```

## Próximo passo

Só depois de validarmos esta fundação na aplicação decidiremos o próximo conceito do domínio.
