# Decisões

## D001 — Schedule Engine é independente de qualquer empresa

**Estado:** aceite

Horários de funcionamento e regras específicas entram como dados/configuração.

## D002 — O calendário operacional é contínuo

**Estado:** aceite

Não existe uma janela global de planeamento no núcleo.

O padrão semanal e as exceções existem ao longo do tempo. Quando for necessário gerar ou consultar um horário para um intervalo específico, essa janela será fornecida pela operação que fizer o pedido.

## D003 — O horário de funcionamento é configuração

**Estado:** aceite

Cada dia da semana pode ter zero ou mais intervalos de funcionamento.

Zero intervalos significa dia fechado.

## D004 — Exceções por data substituem o padrão semanal

**Estado:** aceite

Uma data específica pode ter um horário diferente ou estar fechada, independentemente do padrão semanal.

## D005 — Autorização não pertence ao motor

**Estado:** aceite

Quem pode alterar o horário de funcionamento é uma decisão da aplicação consumidora.

O Schedule Engine recebe a configuração e trabalha com ela.

## D006 — Construção incremental

**Estado:** aceite

Só introduzir novos conceitos quando o anterior estiver implementado e compreendido.

## D007 — Pessoa começa com um modelo mínimo

**Estado:** aceite

Uma pessoa contém apenas `id`, `name` e `active`.

Função, contrato, disponibilidade e restantes atributos não entram no modelo antes de existir uma necessidade concreta do motor.

## D008 — Pessoas são arquivadas, não eliminadas como fluxo normal

**Estado:** aceite

Uma pessoa que deixe de participar em horários futuros permanece identificável no sistema.

`active: false` retira-a de novas escalas sem destruir a entidade.

Datas de entrada/saída poderão substituir este booleano no futuro se o histórico exigir maior precisão.

## D009 — Persistência é uma porta da aplicação

**Estado:** aceite

O Schedule Engine não lê nem escreve diretamente em `localStorage`, bases de dados ou APIs.

A aplicação depende de um contrato assíncrono de persistência.

A implementação inicial usa `localStorage`, mas pode ser substituída por uma implementação remota sem alterar o domínio.

O estado persistido é versionado para permitir evolução controlada do formato.

## D010 — Disponibilidade é uma hard constraint

**Estado:** aceite

Uma pessoa não poderá ser escalada fora dos intervalos em que está disponível.

Zero intervalos num dia significa indisponível nesse dia.

## D011 — Disponibilidade segue padrão semanal com exceções

**Estado:** aceite

Cada pessoa pode ter um padrão semanal recorrente.

Uma exceção por data substitui integralmente o padrão semanal nessa data.

## D012 — Intervalos temporais são um conceito genérico

**Estado:** aceite

`TimeInterval` representa um intervalo temporal reutilizável.

Calendário operacional e disponibilidade usam o mesmo conceito base, evitando duplicação de modelos equivalentes.

## D013 — Evolução de persistência exige migração

**Estado:** aceite

A introdução de novos dados persistidos não deve fazer desaparecer dados existentes.

A versão 2 do estado adiciona disponibilidades e migra automaticamente o formato v1.

## D014 — Disponibilidade é limitada pelo calendário operacional

**Estado:** aceite

Disponibilidade da pessoa e funcionamento da operação são hard constraints independentes.

O intervalo efetivamente escalável é a interseção entre ambos.

Uma pessoa nunca pode ser escalada num dia em que a operação está fechada, nem fora do horário operacional.

A UI impede configurações obviamente impossíveis, mas o núcleo também aplica a interseção para garantir correção perante dados antigos ou incoerentes.

## D015 — Um turno diário é contínuo

**Estado:** aceite

Uma atribuição de trabalho de uma pessoa num dia é representada por um único intervalo contínuo.

Turnos repartidos não fazem parte do modelo atual. Se forem necessários no futuro, terão de ser introduzidos explicitamente como nova capacidade.

## D016 — A duração padrão de turno é configuração explícita

**Estado:** aceite

O motor não assume uma duração diária por defeito.

Enquanto a duração padrão não estiver configurada, operações que dependam dela devem considerar a configuração incompleta.

A duração padrão representa a duração normal pretendida, não uma duração mínima obrigatória. Se um período operacional contínuo for mais curto, o turno ajusta-se à duração disponível desse período.

## D017 — Abertura e fecho são posições ancoradas ao calendário operacional

**Estado:** aceite

Um turno de abertura começa no início do primeiro período operacional e prolonga-se pela duração configurada.

Um turno de fecho termina no fim do último período operacional e recua pela duração configurada.

Se o período contínuo de funcionamento for mais curto do que a duração padrão, o turno usa todo esse período sem atravessar um fecho operacional.

## D018 — Turnos respeitam operação e disponibilidade

**Estado:** aceite

Um turno só é elegível para uma pessoa se estiver integralmente dentro do calendário operacional e da disponibilidade efetiva dessa pessoa.

## D019 — Persistência v3 adiciona regras de trabalho

**Estado:** aceite

A versão 3 do estado persistido adiciona `WorkRulesConfiguration`.

Estados v2 são migrados preservando calendário, pessoas e disponibilidades, com duração de turno não configurada.

## D020 — Presença usa três mínimos independentes

**Estado:** aceite para o Ponto 5

Abertura, período central e fecho são mínimos obrigatórios, não objetivos exatos. Os três valores são independentes. A duração das janelas é definida na D027; deixa de vigorar a regra anterior que impedia abertura ou fecho inferiores ao mínimo central.

## D021 — Requisitos seguem padrão semanal e exceções

**Estado:** aceite para o Ponto 5

Uma exceção por data substitui totalmente o padrão semanal. Num dia fechado não existe exigência de presença. Exceções duplicadas para a mesma data são inválidas.

## D022 — Não configurado não equivale a zero

**Estado:** aceite para o Ponto 5

`null` significa que os requisitos não estão configurados. Uma regra com mínimos zero é explícita e tecnicamente válida, mas não exige presença.

## D023 — Presença e viabilidade global são conceitos distintos

**Estado:** aceite para o Ponto 5

O validador de presença pode identificar falta de pessoas na abertura, durante a operação e no fecho de atribuições propostas. Não certifica disponibilidade, descanso, contratos nem qualidade do horário.

Uma mesma pessoa pode cumprir abertura e fecho de um dia curto com um único turno contínuo.

## D024 — Sobreposição central fica para a otimização

**Estado:** adiado para geração

O motor deverá favorecer sobreposição apropriada durante a operação, sem exigir ao operador que defina curvas de afluência ou cobertura por hora. O objetivo só pode ser quantificado quando existirem regras de carga de trabalho e um gerador.

## D025 — Supabase como persistência remota (proposta em validação)

**Estado:** em validação

A aplicação React utiliza um adaptador `StateRepository` para guardar o estado
v4 em PostgreSQL via Supabase. O motor de scheduling permanece independente.
O projeto Supabase é separado de outros produtos.

O `localStorage` só pode originar a primeira migração, quando ainda não existe
um estado associado à conta autenticada. Dados guardados na cloud prevalecem
sempre sobre o navegador. As chaves históricas permanecem intactas.

Uma conta permanente autenticada é obrigatória. RLS isola os dados por
proprietário; não existe edição partilhada neste V0. A API usa apenas a chave
pública, nunca service_role.

## D026 — Revisões transacionais e histórico

**Estado:** em validação

Uma função SQL executa as escritas e valida a revisão anterior numa transação.
Revisões obsoletas não podem substituir uma versão mais recente. Alterações
bem-sucedidas entram na tabela de histórico. Eliminação acidental de todos os
colaboradores é bloqueada. Falhas de leitura interrompem autosave.

## D027 — Janelas de presença de 30 minutos

**Estado:** aceite; implementação em validação funcional

A abertura é o intervalo dos primeiros 30 minutos de relógio após o início
do primeiro período operacional do dia. O fecho é o intervalo dos últimos
30 minutos anteriores ao fim do último período operacional. O resto
do tempo aberto pertence ao período central, mesmo quando a operação
tem interrupções; durante os encerramentos não há exigência de presença.

Exemplo: operação 09:00–18:00 e mínimos 1 / 2 / 1:
- 09:00–09:30: pelo menos 1 pessoa;
- 09:30–17:30: pelo menos 2 pessoas;
- 17:30–18:00: pelo menos 1 pessoa.

Em dias tão curtos que as duas janelas se sobrepõem, ambas as hard
constraints se aplicam simultaneamente: exige-se o máximo dos mínimos
de abertura e fecho. Não se considera um período central inexistente.
As fronteiras são semiabertas [início, fim).

As janelas são ancoradas apenas na primeira abertura e no último fecho
do dia, não são reiniciadas a cada reabertura de uma operação partida.
O requisito de 30 minutos é uma constante explícita do domínio V1,
não uma configuração arbitrária por dia.

Os validadores puros de atribuições e de capacidade têm de aplicar
exatamente os mesmos cortes, incluindo os casos em que nenhuma
disponibilidade muda nos minutos 30 de cada extremo. Esta verificação
continua a ser apenas necessária e não demonstra viabilidade integral
dos turnos.

Não há mudança ao formato persistido v4: os três campos já existentes
passam a ser avaliados nos novos períodos.

## D028 — Geração de vários dias não equivale a validação global

**Estado:** aceite para Ponto 6.2

Um horário de período V0 é a composição determinística de horários diários
individualmente validados. Não existe ainda qualquer hard constraint entre
dias; por isso o resultado usa explicitamente `validationScope: "daily_only"`
e nunca afirma ter verificado descanso entre dias, contratos, quotas semanais
ou equidade.

As datas civis são enumeradas sem dependência do fuso horário do navegador,
entre início e fim inclusivos, até 14 dias na primeira implementação.

Se um único dia falhar, a API devolve diagnósticos para **todos** os dias,
mas `assignments: []` para o período inteiro, para não apresentar uma solução
parcial como pronta a utilizar. Não encontrar solução na pesquisa discreta de
um dia não prova inviabilidade matemática fora do espaço pesquisado.

O núcleo continua sem dependências da UI, Supabase ou outro meio de persistência.

## D029 — Trabalho efetivo, refeição e descanso são conceitos distintos

**Estado:** aceite como modelo de regras Ponto 6.3; integração na geração pendente

O turno padrão (atualmente 8h) representa **trabalho efetivo**. Um turno
continua a ser uma atribuição diária única, com intervalo de presença total
e, quando aplicável, um intervalo de refeição interior. A refeição não conta
para as horas efetivas nem para a cobertura mínima. D015 mantém-se:
não se modelam múltiplos turnos independentes por pessoa/dia.

Política inicial, com parâmetros explícitos e configuráveis:
- refeição de 60 minutos consecutivos **obrigatória para mais de 360 min**
  de trabalho efetivo; 360 min exatos não a exigem;
- a refeição pode começar após 180 a 300 min de trabalho efetivo,
  incluindo exatamente os extremos. Quando há refeição facultativa,
  a mesma duração e janela aplicam-se;
- descanso mínimo de 660 min consecutivos entre turnos, contado do
  fim da presença total até ao início da presença seguinte; refeição interna
  não substitui descanso entre jornadas;
- máximo de 480 min de trabalho efetivo por pessoa e dia civil;
- máximo de 2400 min de trabalho efetivo por pessoa na semana de
  **segunda-feira a domingo**, sem reiniciar as horas no início de um
  intervalo arbitrário de geração.

Todos são **hard constraints**. O V0 não admite dispensas automáticas
nem exceções autorizadas de limite. As exceções ao calendário,
disponibilidade e cobertura existentes são separadas destas regras.
Cumprimento legal específico continua a cargo da integração/contexto.

Para preservar compatibilidade com os dados v4, o novo tipo
`DatedWorkShift` e a configuração `WorkConstraintConfiguration`
são **aditivos**. A atribuição antiga `PresenceAssignment` não é
automaticamente convertida numa atribuição com refeição. A geração
atual (P6.1/P6.2) continua **sem validar P6.3**; não pode ser
considerada uma certificação global até a migração/integração explícita.
O V0 não cobre turnos que atravessam a meia-noite.

## D030 — O contexto exterior ao período não pode ser presumido vazio

**Estado:** aceite para validador independente Ponto 6.3

Para afirmar que descanso e horas semanais são cumpridos, o validador
recebe um `targetPeriod` e um `knownSchedule` com todos os turnos e
ausências confirmados num intervalo de contexto. Exige declaração
explícita de que esse contexto está completo.

O contexto mínimo inclui:
- as semanas **inteiras**, segunda a domingo, tocadas pelo período;
- o dia imediatamente anterior e posterior ao período, para verificar
  descanso também nas fronteiras, incluindo a mudança de semana/ano.

Sem esse contexto confirmado, um conjunto de turnos aparentemente
conforme devolve `incomplete_context`, nunca `valid`. Violações
já demonstráveis continuam a ser reportadas. Um resultado `valid`
certifica apenas as regras de trabalho aqui definidas; não certifica
cobertura, disponibilidade, contratação ou equidade.

A implementação V0 é um validador puro com testes próprios. A camada
de cobertura existente ainda recebe turnos contínuos sem refeição e
deve ser evoluída antes de se poder publicar uma escala sob P6.3.

## D031 — O descanso é duração real num fuso horário explícito

**Estado:** aceite para validador independente Ponto 6.3

O descanso mínimo de 11h é medido em **minutos efetivamente decorridos**
entre dois instantes; a diferença entre horas de relógio locais pode
não ser a duração real durante mudanças da hora legal.

O validador exige um identificador de fuso horário **IANA** explícito
(`timeZone`, por exemplo `Atlantic/Azores`). Datas civis e horas locais
são convertidas em instantes efetivos para avaliar descanso, refeição e
limites de trabalho. Horas locais inexistentes (avanço de relógio)
ou ambíguas (recuo de relógio) são rejeitadas nesta primeira versão,
em vez de serem interpretadas silenciosamente.

O motor mantém-se independente da região/empresa. Não é adotado
automaticamente o fuso do navegador. A interface e os adaptadores
de dados terão de fornecer um fuso concreto quando estas regras
forem integradas no gerador. Não há migração de persistência nesta etapa.

## D032 — Cobertura utiliza segmentos efetivos, não presença total

**Estado:** implementado como validador independente do Ponto 6.3; geração pendente

Para turnos com uma pausa de refeição, o período de presença total
não equivale ao intervalo de cobertura. O motor remove a refeição
para obter até dois segmentos de trabalho efetivo de uma mesma
pessoa, mantendo **uma única atribuição diária**.

Os intervalos da mesma pessoa não podem sobrepor-se; o mesmo
colaborador nunca é contado duas vezes no mesmo instante.
Os segmentos são verificados com o **mesmo algoritmo P5** de
cobertura de abertura, período central e fecho, sem duplicar
os cortes de 30 minutos.

`checkPresenceForWorkShifts` valida apenas a **estrutura e cobertura**
de um dia. Uma resposta positiva não certifica a obrigatoriedade,
duração e posição da refeição, descanso, horas de trabalho,
disponibilidade ou contexto de semanas adjacentes. Essa validação
fica a cargo dos outros módulos; o gerador terá de compor
explicitamente todos os resultados antes de publicar uma escala.

A interface anterior continua a usar o gerador diário/multidiário
pré-P6.3 e não pode apresentar-se como validação dos novos requisitos.
