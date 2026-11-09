# Arquitetura

## Estado consolidado e evolução em revisão

**Produção de referência:** a `main` mantém a versão aprovada do PR #46.
Os checkpoints A–E do PR #47 estão **em revisão**, isolados na branch
`audit/pr47-consistency-hardening`; a aprovação de merge depende da
auditoria e dos testes funcionais finais.

### Fluxo ativo

```text
React: calendário, gestão diária e gerador condicionado
  ↓
Application: configuração autenticada e arquivo de propostas
  ↓
Scheduling core: geração, hard/soft constraints e certificação final
  ↓
Persistence ports: configuração e snapshots imutáveis
  ↓
Supabase: Auth, RLS, configuração com histórico e propostas append-only
```

O **núcleo de scheduling** não conhece React, Supabase, `localStorage`,
transportes HTTP ou a empresa consumidora. Os adaptadores continuam a ser
responsabilidade da aplicação.

A interface ativa contém calendário mensal, painel lateral resumido e página
de gestão diária; o núcleo de geração condicionada cobre **1–28 dias**
na branch PR47, com a interface desbloqueada após aplicação e confirmação
do CHECK de 28 dias na base de dados. A geração de um horário
válido e o seu arquivo **não equivalem à aprovação oficial**.

No PR #47, foram acrescentados: certificação independente após otimizações,
limites individuais semanais (hard), objetivos semanais (soft), datas
obrigatórias explícitas, fuso IANA operacional e **ciclos contabilísticos de
28 dias**. O calendário pode fixar o snapshot de uma única proposta, porque
um panorama que reúna propostas diferentes **não** é um horário mensal
conjuntamente validado. O motor **já gera e certifica** um período
de 28 dias no mesmo cálculo; o CHECK de 28 dias foi aplicado na instância
em 08/11/2026. A geração e recuperação no Safari foram confirmadas em 09/11/2026; os limites do ciclo seguinte também foram exercitados automaticamente no WebKit.

O estado de configuração mantém `version: 4`, com campos opcionais
retrocompatíveis; o arquivo de propostas usa payload e contrato separados.
O Supabase já é a fonte principal de configuração e propostas. O
`localStorage` serve para migração histórica controlada e preferências da
interface, não para aprovar horários.

O código de domínio de aprovação e os testes permanecem isolados da UI:
o frontend consulta a API autenticada `official-schedules-v2`, que valida
a prontidão e aplica aprovações/revisões com RPC privilegiada, bloqueando
aprovações sem histórico externo verificado. Os laboratórios React que não
eram renderizados foram retirados da branch do PR #47. Um teste do grafo de dependências impede importações acidentais de
aprovações no frontend atual.

**Referências:** `docs/audit-pr47.md` (23 observações),
`docs/supabase-deployment-baseline-pr47.md` (infraestrutura e recuperação),
`docs/roadmap.md` (histórico de implementação). As secções abaixo documentam
as fundações originais e não devem ser interpretadas como estado operacional
atual.



## Fundação histórica — etapas 1 a 5

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

A implementação inicial usava `localStorage` através de `localStorageStateRepository.ts`. A implementação atual usa `supabaseStateRepository.ts`: PostgreSQL é a fonte de verdade, com API REST autenticada, RLS e RPC de escrita atómica com revisão. O armazenamento local antigo é lido apenas para importação inicial com consentimento de titularidade e nunca sobrepõe um estado cloud existente. Preferências de UI continuam a poder ser locais. Consultar `docs/supabase-setup.md`.

O estado persistido inclui:

- horário semanal;
- exceções de calendário;
- pessoas;
- disponibilidades;
- regras de trabalho;
- requisitos mínimos de presença.

O formato é versionado. A versão 4 introduz requisitos de presença e migra automaticamente estados v3 sem inventar mínimos. As migrações v1 e v2 continuam suportadas.

A persistência remota já implementa este contrato; propostas arquivadas usam um contrato de armazenamento separado, sem dependências de Supabase no motor.

### Interface

`src/App.tsx` é uma ferramenta visual para configurar estes conceitos.

A UI não define o domínio e não deve introduzir regras de scheduling.

## Limites

Ainda não existem no fluxo ativo:

- aprovação e revisões oficiais de escalas;
- contratos e objetivos de horas individualizados;
- habilitação do arquivo e geração de 28 dias em produção após migração
  aditiva e teste de recuperação; geração condicionada em 28 dias já
  testada no CI do PR #47.

O motor já valida limites de horas diárias e semanais.

Autenticação, permissões e persistência continuam fora do núcleo. A fonte principal da configuração e das propostas é o Supabase; o armazenamento local é apenas origem controlada de importação histórica.

## Regra arquitetural

Introduzir um conceito de cada vez e validar o seu contrato antes de construir o seguinte.
