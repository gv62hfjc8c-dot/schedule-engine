# Arquitetura

## Estado atual

O Schedule Engine tem agora quatro fundações independentes do algoritmo de geração:

1. calendário operacional contínuo;
2. pessoas que podem participar em horários;
3. disponibilidade temporal de cada pessoa;
4. cobertura mínima necessária da operação.

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

### Cobertura necessária

A cobertura define quantas pessoas são necessárias em cada período operacional:

```ts
interface CoverageRequirement extends TimeInterval {
  minimumPeople: number;
}

type WeeklyCoverage = Record<
  Weekday,
  CoverageRequirement[]
>;

interface CoverageException {
  date: string;
  requirements: CoverageRequirement[];
}
```

A cobertura semanal pode ter vários períodos no mesmo dia.

Cobertura ausente não significa zero pessoas. `minimumPeople: 0` é uma decisão explícita; ausência de requisito durante um período operacional significa configuração incompleta.

Os requisitos devem estar integralmente dentro do calendário operacional e não se devem sobrepor.

`src/utils/coverage.ts` permite:

- resolver requisitos por data;
- consultar o mínimo de pessoas numa hora;
- impedir cobertura efetiva quando a operação está fechada;
- detetar sobreposições;
- detetar períodos operacionais sem cobertura.

As exceções por data substituem a cobertura semanal nessa data.

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
- cobertura semanal;
- exceções de cobertura.

O formato é versionado. A versão 3 introduz cobertura e migra automaticamente estados v2; a migração v1 continua suportada. A aplicação carrega automaticamente no arranque e grava automaticamente quando estes dados mudam.

Uma futura persistência por API/base de dados deverá implementar o mesmo contrato, sem introduzir dependências de storage no domínio.

### Interface

`src/App.tsx` é uma ferramenta visual para configurar estes conceitos.

A UI não define o domínio e não deve introduzir regras de scheduling.

## Limites

Ainda não existem:

- turnos;
- contratos;
- horas de trabalho;
- geração de horários.

Autenticação, permissões e persistência continuam fora do núcleo. A persistência local atual pertence apenas à aplicação.

## Regra arquitetural

Introduzir um conceito de cada vez e validar o seu contrato antes de construir o seguinte.
