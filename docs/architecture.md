# Arquitetura

## Estado atual

O Schedule Engine tem agora quatro fundações independentes do algoritmo de geração:

1. calendário operacional contínuo;
2. pessoas que podem participar em horários;
3. disponibilidade temporal de cada pessoa;
4. regras mínimas para construir turnos contínuos.

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

### Disponibilidade

A disponibilidade usa o mesmo conceito genérico de intervalo temporal do calendário operacional:

```ts
interface TimeInterval {
  start: string;
  end: string;
}
```

Cada pessoa tem um padrão semanal e exceções por data:

```ts
interface PersonAvailability {
  personId: string;
  weeklyAvailability: Record<Weekday, TimeInterval[]>;
  exceptions: AvailabilityException[];
}
```

Zero intervalos num dia significa indisponível.

Uma exceção por data substitui o padrão semanal dessa pessoa.

`src/utils/availability.ts` resolve a disponibilidade efetiva e permite verificar se um intervalo pedido está totalmente contido num intervalo disponível.

Disponibilidade é uma hard constraint, mas não existe isoladamente do calendário operacional.

O tempo efetivamente escalável numa data é:

```text
calendário operacional ∩ disponibilidade da pessoa
```

Se a operação estiver fechada, ninguém é escalável nessa data, mesmo que existam dados de disponibilidade antigos ou incoerentes. Se a operação estiver aberta apenas num subintervalo, a disponibilidade efetiva é limitada a esse subintervalo.

A interface aplica a mesma regra: dias fechados ficam bloqueados e as horas selecionáveis ficam limitadas ao funcionamento da operação.

### Regras de trabalho

O Ponto 4 introduz uma duração padrão de turno:

```ts
interface WorkRulesConfiguration {
  standardShiftDurationMinutes: number | null;
}
```

`null` significa que a duração ainda não foi configurada. O motor não assume silenciosamente uma duração.

A duração configurada é a duração normal pretendida. Quando o período operacional contínuo de um dia é mais curto, o turno é reduzido ao tamanho desse período em vez de tornar o dia inválido.

Um turno diário é representado como um único `TimeInterval`, portanto é contínuo por construção. Turnos repartidos não fazem parte do modelo atual.

`src/utils/workRules.ts` permite:

- validar duração;
- calcular a duração de um intervalo;
- verificar se um turno cabe num período operacional;
- construir um turno de abertura ancorado ao início da operação;
- construir um turno de fecho ancorado ao fim da operação;
- validar se uma pessoa pode fazer esse turno considerando operação e disponibilidade.

Um turno contínuo não pode atravessar uma interrupção do calendário operacional. Em operações com vários períodos, abertura e fecho ajustam-se aos respetivos períodos extremos.

### Persistência da aplicação

A persistência não pertence ao núcleo do Schedule Engine.

`src/persistence/stateRepository.ts` define uma porta assíncrona:

```ts
interface StateRepository {
  load(): Promise<PersistedAppState | null>;
  save(state: PersistedAppState): Promise<void>;
}
```

A implementação atual usa `localStorage` através de `localStorageStateRepository.ts`.

O estado persistido inclui:

- horário semanal;
- exceções de calendário;
- pessoas;
- disponibilidades;
- regras de trabalho.

O formato é versionado. A versão 3 introduz regras de trabalho e migra automaticamente estados v2 sem inventar uma duração de turno. A migração v1 continua suportada.

Uma futura persistência por API/base de dados deverá implementar o mesmo contrato, sem introduzir dependências de storage no domínio.

### Interface

`src/App.tsx` é uma ferramenta visual para configurar estes conceitos.

A UI não define o domínio e não deve introduzir regras de scheduling.

## Limites

Ainda não existem:

- requisitos mínimos de presença;
- contratos;
- horas semanais;
- geração de horários.

Autenticação, permissões e persistência continuam fora do núcleo. A persistência local atual pertence apenas à aplicação.

## Regra arquitetural

Introduzir um conceito de cada vez e validar o seu contrato antes de construir o seguinte.
