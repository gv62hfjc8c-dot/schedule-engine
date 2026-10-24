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

O Ponto 5 introduz `PresenceRequirement` com três mínimos inteiros e não negativos: abertura, durante a operação e fecho. Abertura e fecho não podem exigir menos do que o mínimo durante a operação.

Os requisitos não determinam o número exato de colaboradores, nem codificam picos de procura. São hard constraints.

`WeeklyPresenceRequirements` guarda uma regra ou `null` para cada dia; `null` significa por configurar e não é equivalente a uma regra com três zeros. `PresenceException` substitui a regra semanal numa data específica. Datas fechadas não exigem presença. Exceções duplicadas são inválidas.

`src/utils/presence.ts` resolve os requisitos efetivos de uma data e valida a presença simultânea num conjunto de atribuições contínuas já proposto.

Na verificação das atribuições, os intervalos são semiabertos `[início, fim)`. A abertura corresponde ao início do primeiro intervalo operacional; o fecho ao instante imediatamente anterior ao fim do último. Durante interrupções operacionais não é exigida presença. Cada pessoa pode ter apenas uma atribuição diária; uma mesma pessoa pode cumprir ambos os extremos num dia curto.

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

A implementação principal usa `src/persistence/databaseStateRepository.ts`, que comunica por HTTP (mesma origem `/api/state`) com o plugin `server/viteDatabasePlugin.mjs` instalado no próprio Vite. O plugin utiliza `server/sqliteStateDatabase.mjs` para guardar o estado em SQLite, no caminho `.schedule-engine-data/state.sqlite`, fora do Git.

A escrita é transacional e exige a revisão anterior (optimistic concurrency). A tabela `state_history` mantém uma cópia de cada revisão, permitindo diagnosticar alterações. Os dados sobrevivem ao reinício do servidor e do navegador.

O `localStorage` permanece apenas como origem de migração inicial quando a SQLite está vazia. Nesse primeiro carregamento, os dados do navegador são copiados e mantidos, sem eliminar o original. Quando a SQLite já existe, não voltamos a importar do navegador. Se a API ou leitura falhar, a aplicação bloqueia gravações.

A persistência continua isolada do núcleo de scheduling pelo contrato `StateRepository`. O endpoint atual é uma infraestrutura de desenvolvimento local, acessível apenas do próprio computador, não um backend de produção autenticado.

O estado persistido inclui:

- horário semanal;
- exceções de calendário;
- pessoas;
- disponibilidades;
- regras de trabalho;
- requisitos mínimos de presença.

O formato é versionado. A versão 4 introduz requisitos de presença e migra automaticamente estados v3 sem inventar mínimos. As migrações v1 e v2 continuam suportadas.

A persistência SQLite e a API são adaptadores de infraestrutura: não existe dependência de storage no domínio. Para produção serão necessários autenticação, permissões, configuração de alojamento e backups independentes.

### Interface

`src/App.tsx` é uma ferramenta visual para configurar estes conceitos.

A UI não define o domínio e não deve introduzir regras de scheduling.

## Limites

Ainda não existem:

- gerador de horários e otimização;
- contratos;
- horas semanais.

Autenticação, permissões e persistência continuam fora do núcleo. A persistência SQLite local atual pertence apenas à aplicação e ao Vite de desenvolvimento.

## Regra arquitetural

Introduzir um conceito de cada vez e validar o seu contrato antes de construir o seguinte.
