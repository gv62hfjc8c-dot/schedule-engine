# Arquitetura

## Estado atual

O Schedule Engine tem agora cinco fundações independentes do algoritmo de geração:

1. calendário operacional contínuo;
2. pessoas que podem participar em horários;
3. disponibilidade temporal de cada pessoa;
4. regras mínimas para construir turnos contínuos;
5. requisitos mínimos de presença.

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

### Requisitos mínimos de presença

O Ponto 5 introduz `PresenceRequirement` com três mínimos independentes, inteiros e não negativos: abertura (primeiros 30 minutos de funcionamento), período central (entre as duas janelas exteriores) e fecho (últimos 30 minutos). Uma configuração 1 / 2 / 1 é válida; os mínimos não são máximos nem objetivos exatos.

Os requisitos não determinam o número exato de colaboradores, nem codificam picos de procura. São hard constraints.

`WeeklyPresenceRequirements` guarda uma regra ou `null` para cada dia; `null` significa por configurar e não é equivalente a uma regra com três zeros. `PresenceException` substitui a regra semanal numa data específica. Datas fechadas não exigem presença. Exceções duplicadas são inválidas.

`src/utils/presence.ts` resolve os requisitos efetivos de uma data e valida a presença simultânea num conjunto de atribuições contínuas já proposto.

Na verificação das atribuições, os intervalos são semiabertos `[início, fim)`. Para um dia 09:00–18:00, a abertura é 09:00–09:30, o período central 09:30–17:30 e o fecho 17:30–18:00. As janelas estão ancoradas na primeira abertura e no último fecho do dia. Em operações partidas, não se exige presença nos intervalos fechados; o tempo operacional interior pertence ao período central. Em dias com duração total inferior a 60 minutos, abertura e fecho podem sobrepor-se: o mínimo aplicável à sobreposição é o maior dos dois, sem inventar um período central. Cada pessoa conta uma única vez em cada intervalo e só pode ter uma atribuição contínua diária.

O validador de atribuições verifica **apenas presença**, não disponibilidade, contratos, carga horária ou viabilidade global.

`checkPresenceAvailabilityCapacity` faz também uma pré-verificação necessária: conta pessoas distintas disponíveis ao longo de todo o período operacional, incluindo as horas de abertura e fecho. Uma falta de pessoas disponíveis torna a cobertura impossível; a inexistência de faltas **não prova** que existam turnos contínuos viáveis.

### Persistência da aplicação

A persistência não pertence ao núcleo do Schedule Engine.

`src/persistence/stateRepository.ts` define uma porta assíncrona:

```ts
interface StateRepository {
  load(): Promise<PersistedAppState | null>;
  save(state: PersistedAppState): Promise<void>;
}
```

A implementação inicial usa `localStorage` através de `localStorageStateRepository.ts`. Na branch Supabase em validação, `supabaseStateRepository.ts` torna PostgreSQL a fonte de verdade, sem introduzir dependências de persistência no domínio. Usa a API REST autenticada do Supabase, políticas RLS e uma função SQL de escrita atómica com controlo de revisão. O `localStorage` só é lido na primeira migração e nunca sobrescreve dados que já existam na cloud. Consulta `docs/supabase-setup.md`.

O estado persistido inclui:

- horário semanal;
- exceções de calendário;
- pessoas;
- disponibilidades;
- regras de trabalho;
- requisitos mínimos de presença.

O formato é versionado. A versão 4 introduz requisitos de presença e migra automaticamente estados v3 sem inventar mínimos. As migrações v1 e v2 continuam suportadas.

Uma futura persistência por API/base de dados deverá implementar o mesmo contrato, sem introduzir dependências de storage no domínio.

### Interface

`src/App.tsx` é uma ferramenta visual para configurar estes conceitos.

A UI não define o domínio e não deve introduzir regras de scheduling.

## Limites

Ainda não existem:

- gerador de horários e otimização;
- contratos;
- horas semanais.

Autenticação, permissões e persistência continuam fora do núcleo. A persistência local atual pertence apenas à aplicação.

## Regra arquitetural

Introduzir um conceito de cada vez e validar o seu contrato antes de construir o seguinte.
