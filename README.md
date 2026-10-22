# Schedule Engine

Projeto dedicado à construção de um motor de horários reutilizável e independente de qualquer empresa específica.

## Estado atual

Estamos a reconstruir o motor desde a base.

Neste momento o projeto contém apenas a fundação temporal necessária para qualquer sistema de horários:

1. **período de planeamento**;
2. **horário semanal de funcionamento**;
3. **exceções por data**;
4. **calendário operacional resultante**.

Ainda não existem pessoas, turnos de trabalho, cobertura, disponibilidade, folgas ou geração automática de horários. Esses conceitos serão introduzidos um a um.

## Princípio

O motor não assume horários fixos nem dias úteis específicos.

Uma empresa pode funcionar:

- segunda a sexta;
- sete dias por semana;
- apenas alguns dias;
- com horários diferentes por dia;
- com dias fechados;
- com exceções pontuais.

A autorização para editar esta configuração pertence à aplicação que utilizar o motor. O núcleo apenas recebe os dados.

## Modelo atual

```ts
interface SchedulePeriod {
  startDate: string;
  endDate: string;
}

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
```

Um array vazio de intervalos significa que o dia está fechado.

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

Só depois de fecharmos esta base temporal avançaremos para o próximo conceito do domínio.
