# Schedule Engine — V2: base visual do produto

A V2 é uma reconstrução independente do código V0/V1. A identidade visual da aplicação foi mantida, mas as páginas estão a ser desenvolvidas como ecrãs de produto final, sem etiquetas de protótipo, desenvolvimento ou demonstração.

## Rotas

- `/` — página de acesso com formulário de início de sessão e identidade visual em dois painéis.
- `/horarios` — calendário mensal com geração real de propostas, verificação automática, consulta dos turnos por dia e gravação local por mês.
- `/configuracao` — consulta de dados guardados da organização.
- `/configuracao/inicial` — nome da empresa com validação e gravação local.
- `/configuracao/funcionamento` — dias e horários semanais de funcionamento com validação e gravação local.
- `/configuracao/equipa` — adicionar e editar colaboradores, com estado ativo/inativo.
- `/horarios/gerar` — rota da versão anterior: regressa à página inicial.

## Regra obrigatória de UI

Qualquer conteúdo visível deve fazer sentido para o utilizador final. Mensagens sobre versões, branches, testes, demos, PRs ou funcionalidades futuras pertencem apenas à documentação técnica, nunca ao produto.

O layout tem de se adaptar a desktop, tablet e smartphone, incluindo ecrãs com largura de 320px. O design preserva o estilo azul-escuro e teal, navegação acessível, foco visível e redução de animações quando o sistema pede.

## Estado funcional real

O formulário de acesso **ainda não tem provedor de autenticação**. Submeter o formulário não grava, envia ou autentica credenciais e apenas apresenta uma indisponibilidade de sessão. Não se simula autenticação. A navegação direta para `/horarios` está aberta apenas enquanto não existe backend nem dados privados. Os horários guardados são rascunhos locais e não devem ser utilizados como registos oficiais.

A V2 já contém um **gerador experimental puro** de atribuições e um **certificador independente**, mas ainda não existe ligação funcional à interface, aprovações, Supabase, autenticação real nem persistência dos turnos gerados. Os dados de empresa, funcionamento e equipa podem ser guardados apenas neste dispositivo. Os ecrãs não devem inventar resultados. Um dia sem turno nunca é automaticamente marcado como folga.

## Verificação

```bash
npm ci
npm test
npm run build
npm run dev
```

Testar os percursos no Safari e, antes de integrar o PR, verificar visualmente as resoluções 320px, 375px, 768px, 1024px e desktop largo. Os testes automáticos verificam a lógica do calendário, as rotas e contratos estáticos de linguagem e CSS, mas não substituem a inspeção visual nos dispositivos.

A fundação V2 foi integrada na `main` através do PR71. A versão anterior mantém-se acessível no histórico Git e na branch do PR70. O PR72 foi integrado na `main`. O PR73 foi integrado na `main`. O PR74 remove a etapa de disponibilidades individuais e alinha a progressão do onboarding com a configuração necessária.

## Encaminhamento após autenticação

A lógica independente em `src/entryRouting.ts` prepara a entrada na conta sem criar uma sessão fictícia:

- Não autenticado: `/`.
- Autenticado, configuração conhecida e vazia: `/configuracao/inicial` — primeiro acesso.
- Autenticado, configuração parcialmente validada: retomar na rota correspondente à primeira secção ainda não validada (empresa, funcionamento ou equipa).
- Autenticado, todas as secções obrigatórias validadas: `/horarios`.
- Autenticado, estado de configuração desconhecido ou inválido: sem encaminhamento, até se conseguir verificar.

As secções previstas nesta fase são empresa, funcionamento, equipa e regras gerais. Não existe etapa nem requisito de cobertura mínima. O campo `checks` representa resultados de validação das secções, **não** visualizações de páginas, cliques ou confirmações do utilizador.

**Não existe um passo de disponibilidades.** Cada colaborador ativo é automaticamente elegível para receber turnos durante as janelas semanais de abertura da empresa, independentemente de quais sejam. Um colaborador inativo não é elegível para novos turnos. Não há campos, armazenamento nem preferências/restrições individuais de disponibilidade. O módulo puro `src/eligibleOpeningWindows.ts` deriva estas janelas do estado ativo e do funcionamento validado da organização; não atribui turnos nem horas de trabalho. O motor futuro continuará obrigado a validar a carga horária fixa de 40 horas semanais e os descansos aplicáveis, mas não terá cobertura mínima obrigatória nesta fase.

Se a próxima secção for `rules`, a navegação aponta provisoriamente para `/configuracao` (e nunca volta a enviar o utilizador à identificação da empresa). Estas secções ainda não têm formulário, e a configuração não é declarada concluída até serem realmente validadas. A autenticação real continua desligada. Não usar uma flag genérica `setupComplete` como prova. A lista e a obrigatoriedade das secções devem ser revisitadas quando as validações reais forem implementadas.

As rotas `/configuracao/inicial`, `/configuracao/funcionamento` e `/configuracao/equipa` possuem formulários reais com armazenamento local limitado. A configuração das regras gerais ainda não está disponível no onboarding. A cobertura mínima está fora do âmbito desta fase. A função de decisão não está ligada ao formulário de login (que continua sem backend). Futuramente, o controlador autenticado deverá consultar os dados validados e autorizados da empresa antes de executar a decisão.

## Identificação da empresa — primeira etapa funcional

A página `/configuracao/inicial` permite introduzir e guardar o **nome da empresa**, com normalização e validação independente em `src/companyIdentity.ts` (entre 2 e 120 caracteres, sem caracteres de controlo). O mesmo nome pode ser consultado e editado em `/configuracao`.

A gravação é **exclusivamente local**, num registo versionado `schedule-engine:v2:company-identity:v1`. O adaptador fica isolado em `src/companyDraftRepository.ts`; dados inválidos ou indisponibilidade do armazenamento não podem ser interpretados como configuração concluída. Não há importação de dados anteriores, sincronização entre dispositivos, conta empresarial real ou armazenamento na cloud. A interface diz ao utilizador que os dados ficam no dispositivo.

O estado resultante pode alimentar a decisão de navegação: nome guardado e validado marca apenas a secção `company` como válida; `operatingHours`, `team` e `rules` continuam sem validação. A navegação após um **login real** não está ligada nesta etapa porque ainda não existe provedor de autenticação. Não declarar onboarding completo com base em localStorage.

Testes: `tests/companyIdentity.test.ts` verificam normalização, campos inválidos, gravação e leitura, dados corrompidos, indisponibilidade do armazenamento e evolução do estado da decisão de entrada. A verificação visual do novo formulário no Safari e em ecrãs móveis exige aceitação específica.

## Funcionamento semanal regular — PR72

O módulo de domínio `src/operatingHours.ts` valida uma semana completa, com os sete dias de segunda-feira a domingo. Cada dia tem uma lista de períodos de abertura; uma lista vazia significa **empresa encerrada nesse dia**, e nunca folga de um colaborador. O validador garante:

- identificação única dos sete dias;
- pelo menos um dia com funcionamento;
- horas locais no formato `HH:MM`, início anterior ao fim, sem períodos noturnos a atravessar a meia-noite;
- intervalos não sobrepostos, de modo a suportar vários períodos por dia numa etapa futura.

A **interface do PR72 permite atualmente apenas um intervalo contínuo por dia**. O modelo suporta vários períodos, mas a UI de múltiplos intervalos, feriados, exceções, ciclos e regras de turnos está deliberadamente fora do âmbito.

O formulário inicia com uma **sugestão não gravada**, de segunda a sexta das 09:00 às 18:00. O utilizador deve confirmar e guardar. Um sábado ou domingo pode ser marcado como aberto ou fechado, independentemente dos restantes dias. A gravação é local e versionada em `schedule-engine:v2:opening-hours:v1`; dados indisponíveis ou inválidos não são tratados como horários confirmados.

O módulo `src/localSetupSnapshot.ts` permite combinar os estados validados da identidade e do funcionamento para exercer a função pura de encaminhamento. Se a identidade estiver válida e o funcionamento não estiver configurado, o destino é `/configuracao/funcionamento`. Se ambos estiverem válidos, a próxima secção é a equipa; **a configuração global não é declarada concluída**. O login ainda não está ligado a estes estados locais e nenhum dado é enviado à cloud.

Os testes em `tests/operatingHours.test.ts`, `tests/openingHoursDraftRepository.test.ts` e `tests/localSetupSnapshot.test.ts` cobrem os horários, a persistência e a decisão de entrada. A aprovação visual e funcional no Safari, desktop e telemóvel, é um critério separado antes da integração.

## Equipa — PR73

A terceira secção funcional do onboarding introduz a entidade `TeamMember`, independente do motor, com:
- `id`: UUID v4 estável que não depende do nome;
- `name`: nome identificativo normalizado e validado (2–120 caracteres);
- `active`: elegibilidade para **futuro planeamento**, não presença, turno, férias ou folga.

Permite adicionar, editar nomes, ativar e inativar colaboradores sem os apagar. Nomes iguais são permitidos para pessoas diferentes, pois o identificador é independente. A lista não está limitada à entidade empregadora real: a gravação ainda é um **rascunho local do navegador**, sem isolamento por conta, sem backend ou sincronização; não devem ser aqui introduzidos identificadores pessoais, contactos, salários ou dados sensíveis. A migração para uma fonte autenticada exigirá modelo de organizações, permissões e consentimento adequados.

A validação independente do domínio, em `src/team.ts`, distingue a consistência do registo da conclusão da etapa: um rascunho vazio ou com todos inativos pode ser guardado, mas **não valida a secção Equipa**. É preciso pelo menos um colaborador ativo. A persistência isolada em `src/teamDraftRepository.ts` trata corrupção, versão desconhecida e erros de armazenamento, sem confundir ausência de dados com indisponibilidade. A interface bloqueia alteração silenciosa de um rascunho corrompido e pede confirmação explícita antes de o substituir.

A função de entrada encaminha para `/configuracao/equipa` quando empresa e funcionamento estão válidos, mas ainda não existe equipa válida. Quando a equipa está válida, o próximo passo lógico é `rules`, sem etapa autónoma de disponibilidades; em nenhum caso se declara a configuração completa. Esta lógica não está ligada a um login real.

O formulário e a lista estão em `src/TeamEditor.tsx`, com estilos isolados em `src/team.css`. O resumo real de membros ativos/totais aparece em `/configuracao`. Os testes de domínio, persistência, fluxo e rotas acompanham a implementação; a aceitação visual no Safari desktop/telemóvel será separada do CI.

## Limpeza do onboarding — PR74

Foi retirada a entrada `availability` de `SETUP_SECTIONS`, do encaminhamento pós-login e dos testes. O percurso obrigatório originalmente incluía **Empresa → Funcionamento → Equipa → Regras → Cobertura**; o PR76 retira a etapa Cobertura. O acesso ao calendário depende agora da validação real das quatro secções, sem concluir prematuramente o onboarding. Nenhum rascunho local anterior (empresa, funcionamento ou equipa) é apagado ou migrado.

A regra de elegibilidade é derivada, não persistida: uma pessoa ativa recebe exatamente os intervalos de funcionamento da organização como janelas possíveis; uma pessoa inativa não recebe nenhuma. As janelas não são turnos atribuídos. A função rejeita dados de origem inválidos em vez de inventar horários. O algoritmo de atribuição e as hard constraints contratuais continuam por implementar na V2.

## PR75 — Primeira regra do núcleo e certificação independente

**40 horas semanais fixas e obrigatórias** por colaborador ativo, representadas por 2 400 minutos de trabalho efetivo. Não existe configuração individual deste número nesta fase. Uma semana com 38h ou 42h é inválida, tal como um ciclo de 14 dias com 30h + 50h. Estar disponível dentro da abertura da empresa não significa que essas horas já tenham sido trabalhadas.

### Módulos do núcleo (sem React, API ou Supabase)

- **src/schedulePeriods.ts:** cinco modos: weekly, 14d, 21d, 28d e monthly. Períodos de duração fixa começam à segunda-feira; o mês é civil. Datas com início inclusivo e fim exclusivo. Distingue intervalo editável de horizonte das semanas completas para certificação.
- **src/workAssignments.ts:** trabalho efetivo por colaborador, data, início e fim. As pausas não contabilizadas têm de separar intervalos de trabalho; intervalos noturnos a atravessar a meia-noite ainda não existem.
- **src/weeklyHours.ts:** hard constraint constante de 2 400 minutos por semana completa de segunda a domingo.
- **src/certifySchedule.ts:** valida independentemente a estrutura, colaboradores, abertura da empresa, sobreposições, períodos e 40 horas por pessoa/semana. Não atribui turnos nem escreve em dados.

### Outros meses são sempre só de leitura

Se o período editável for novembro de 2026, nenhuma atribuição proposta pode estar fora de 01/11–30/11. Para validar as semanas de 26/10–01/11 e 30/11–06/12, o certificador consulta contexto externo, mas nunca o modifica. O estado aprovado/rascunho do mês externo não altera esta proteção. O contexto deve declarar explicitamente que dias externos têm informação completa, incluindo os dias sem trabalho; faltando informação, o resultado não pode ser declarado válido. Turnos externos podem ter sido produzidos sob outro funcionamento da empresa, pelo que não são revalidados contra os horários atuais; apenas contribuem com os minutos registados.

**A proteção de escrita no armazenamento será responsabilidade adicional do futuro adaptador de persistência**, incluindo autorização e verificação de versão do contexto. O certificador atual é uma função pura, sem qualquer operação de escrita.

### Estados de certificação e limites

O resultado é valid, invalid ou insufficient_context; inclui códigos de erro e totais por pessoa e semana. Uma infração comprovada prevalece sobre falta de contexto. Uma semana incompleta não pode ser declarada deficiente ou validada apenas pelo total parcial; excesso já comprovado continua inválido.

**Ainda não há gerador funcional ou botão de geração nesta V2.** Quando houver, a aplicação terá uma única ação «Gerar horário», que faz a certificação automaticamente e mostra os problemas ao utilizador. Não haverá um segundo botão de validar.

Neste PR, um resultado valid significa que **as regras aqui implementadas** foram cumpridas. O certificado completo do motor virá depois da implementação e validação de descansos, pausas e demais regras aplicáveis que venham a integrar o âmbito. Não se devem apresentar os resultados atuais como aprovação global de um horário de produção.

Os testes adicionais em tests/schedulePeriods.test.ts e tests/certifySchedule.test.ts cobrem os cinco modos, fronteiras dos meses, 38h/40h/42h, 30h+50h, equipas ativas/inativas, sobreposições e contexto read-only.

## PR76 — Remoção da cobertura mínima

**Decisão de âmbito:** a primeira fase do Schedule Engine **não exige cobertura mínima**. Não existe número mínimo de colaboradores por turno, regra de staffing por intervalo, grelha de cobertura ou requisito de preencher todo o funcionamento da empresa.

A implementação V2 na main antes do PR76 não possuía um algoritmo de cobertura nem persistência desses dados: apenas continha uma secção `coverage` obrigatória no encaminhamento de onboarding e referências em documentação/testes. O PR76 elimina essa etapa, mantendo quatro secções: **Empresa → Funcionamento → Equipa → Regras**. Não se retiram verificações de 40 horas semanais, funcionamento, colaboradores ativos ou sobreposição de intervalos.

O certificador independente do PR75 não verificava cobertura; continua a não a verificar. O seu resultado `valid` continua limitado às regras implementadas. A interface atual não tem formulário de cobertura, pelo que não é necessária qualquer migração, remoção de dados ou modificação de ecrãs.

A próxima geração deve distribuir 40 horas semanais respeitando as restantes restrições implementadas, **sem impor ocupação mínima de cada intervalo da empresa**. A obrigação de 40h por colaborador também não significa trabalhar continuamente durante toda a abertura.

## PR77 — Primeiro gerador real, com certificação automática

O módulo puro `src/generateSchedule.ts` recebe período, equipa, funcionamento da empresa e contexto externo **só de leitura**. Devolve:
- `candidateAssignments`: proposta de intervalos efetivos de trabalho **apenas** no período editável;
- `certification`: resultado do certificador independente executado **automaticamente**, sem botão de validação adicional;
- `status`: `valid`, `invalid`, `insufficient_context` ou `invalid_input`;
- `shortfalls`: défices comprovados por pessoa e semana quando falta capacidade dentro do período editável e o contexto exterior está completo.

### Estratégia inicial e limitações

- Todos os colaboradores ativos são elegíveis para trabalhar nos intervalos de abertura da empresa, sem preferências individuais nem cobertura mínima.
- O gerador procura cumprir **exatamente 2 400 minutos por colaborador e semana completa**, sem compensar semanas. Começa com uma distribuição determinística de até 8 horas de trabalho efetivo por dia aberto. Se os dados de fora do período estiverem completos e a empresa não oferecer cinco dias de 8 horas, procura distribuir as horas restantes entre os dias abertos, em passagens de até 60 minutos, sem inventar um limite diário obrigatório de 8 horas.
- Suporta semana, 14 dias, 21 dias, 28 dias e mês civil; usa o mesmo certificador independente para todos os períodos.
- Ao gerar um mês civil, só pode propor turnos **dentro desse mês**. As atribuições dos dias de outros meses entram exclusivamente no `externalContext`, independentemente de estarem aprovadas ou em elaboração. O gerador **não altera** esse contexto nem cria turnos nesses dias.
- Com dias de outros meses não conhecidos, o gerador só coloca uma distribuição conservadora (até 8h por dia editável) nas semanas de fronteira. O certificador devolve `insufficient_context` quando não consegue provar as 40h, em vez de assumir turnos ou folgas fictícias fora do mês.
- Se o funcionamento não permitir cumprir 40h numa semana com contexto completo, o gerador devolve `invalid`, uma proposta parcial e um défice explícito. **Nunca grava uma proposta automaticamente.** Entradas inválidas são recusadas sem gerar turnos.
- A estratégia é deliberadamente simples e determinística, sem heurísticas de cobertura, otimização, equidade, pausas legais, descanso diário/semanal ou turnos noturnos. **Um resultado `valid` certifica apenas as regras atualmente implementadas**, não um horário legal/operacional completo.

### Experiência prática no Terminal

```bash
npm ci
npm test
npm run build
npm run example:generator
```

O último comando executa `examples/firstGeneration.ts` com **dados fictícios**, apresentando uma semana com 40h por colaborador ativo e um mês com contexto exterior desconhecido. Mostra turnos gerados e o relatório automático do certificador. Não grava dados locais ou remotos nem modifica os horários de outros meses.

O teste `tests/generateSchedule.test.ts` valida semanal, 14/21/28 dias, mês de novembro de 2026 com outubro/dezembro só de leitura, contexto insuficiente, 40h impossíveis, dias encerrados, múltiplos colaboradores ativos, inativos, horários repartidos, entrada corrompida e ausência de mutações.

**A partir do PR78, a página /horarios dispõe de uma ação funcional «Gerar horário» para o mês visível**, certificação automática, visualização diária e possibilidade de guardar a proposta no navegador. Não existe persistência em servidor, aprovação definitiva nem ecrã separado de validação. Os modos de 7/14/21/28 dias continuam implementados no núcleo, mas a seleção visual desses modos permanece fora do PR78, que integra inicialmente a geração mensal.

## PR78 — Gerar, consultar e guardar propostas no Safari

A página `/horarios` utiliza agora `CalendarScheduler` e o motor real do PR77. O utilizador pode navegar entre meses civis, clicar em **Gerar horário**, consultar os intervalos atribuídos a cada colaborador no calendário e clicar em **Guardar proposta**. A certificação é executada automaticamente, incluindo quando se consulta uma proposta local guardada. Não existe ecrã nem botão independente para validar.

### Persistência local (rascunhos, não horários aprovados)

O adaptador `src/monthlyScheduleDraftRepository.ts` guarda uma proposta completa por mês na chave `schedule-engine:v2:schedule-month:v1:AAAA-MM` do `localStorage`. Os dados são revalidados à leitura e à escrita; entradas corrompidas não podem ser confundidas com meses vazios. O armazenamento guarda apenas os intervalos de trabalho efetivo, **não um certificado definitivo**. A certificação é recalculada ao abrir a proposta, a partir da equipa e funcionamento atuais e do contexto dos meses vizinhos.

Cada escrita atinge **exclusivamente a chave do mês selecionado**. Nunca acrescenta, edita nem apaga turnos de outro mês, esteja esse mês aprovado, incompleto ou apenas em preparação. As semanas que atravessam as fronteiras do mês consultam os meses adjacentes em modo de leitura: um mês vizinho **sem proposta guardada é desconhecido**, não é assumido como 0 horas. Uma proposta mensal guardada representa o conjunto de atribuições de todos os dias desse mês, incluindo dias sem turnos, sem transformar automaticamente esses dias em folgas.

Se faltar contexto externo, a proposta pode ser guardada **como rascunho não certificado**, com a respetiva advertência. **Uma proposta comprovadamente inválida não pode ser guardada pelo fluxo da UI**. No momento de guardar, a aplicação verifica se a equipa, o funcionamento, o contexto externo e o mês selecionado não foram alterados desde a geração; em caso de alteração, exige que o utilizador volte a gerar/recarregue em vez de substituir silenciosamente o que já foi guardado. Substituir uma proposta existente exige confirmação. O controlo de revisão em `localStorage` é uma defesa básica contra dados obsoletos, não uma transação atómica entre dispositivos ou uma garantia de concorrência em servidor.

Este PR integra apenas o **modo mensal na interface** para reduzir a complexidade inicial. O motor já suporta 7, 14, 21 e 28 dias, que poderão ser apresentados numa fase posterior com um modelo de persistência consistente para períodos sobrepostos. Não há dados cloud, sincronização, login real, alterações ao Supabase nem horários aprovados. O certificador atual ainda não verifica todos os descansos e requisitos legais. Um resultado `valid` significa somente que as restrições codificadas até este PR foram respeitadas.

### Teste manual

1. Configurar a identificação da empresa, os horários semanais de funcionamento e pelo menos um colaborador ativo.
2. Abrir `http://localhost:5173/horarios`, selecionar o mês pretendido e carregar em **Gerar horário**.
3. Confirmar que aparecem os dias com turnos, a lista de pessoas e os intervalos no detalhe diário.
4. Guardar a proposta e recarregar a página: os turnos devem permanecer disponíveis no mesmo dispositivo.
5. Navegar para o mês anterior ou seguinte. O seu horário não pode ser alterado pela geração do mês corrente; se ainda não estiver guardado, deve manter-se desconhecido e causar `Contexto incompleto` quando necessário.
6. Alterar os dados da equipa/funcionamento e voltar à proposta: a certificação não deve ser considerada permanentemente válida por ter sido guardada.

## PR79 — Distribuição simples de turnos entre colaboradores ativos

No primeiro algoritmo V2, cada colaborador começava sempre na hora de abertura, pelo que, para funcionamento 09:00–19:00 e dois colaboradores ativos, ambos recebiam 09:00–17:00. Esta duplicação não era um erro do certificador: faltava uma heurística para diferenciar as janelas de trabalho.

**Correção pontual:** após alocar a carga horária obrigatória, o gerador usa a margem entre a duração do funcionamento e a duração do trabalho atribuído para sugerir inícios de turno alternados por pessoa e por dia civil. Por exemplo, com dois colaboradores, segunda 09:00–17:00 / 11:00–19:00, terça com posições trocadas. Com três colaboradores, o mesmo exemplo permite 09:00–17:00, 10:00–18:00 e 11:00–19:00. A alternância tem continuidade ao atravessar semanas e meses.

**Isto é uma preferência de distribuição**, não uma nova hard constraint de cobertura: se a empresa apenas abrir 8h ou não houver margem para alternar, os turnos podem continuar iguais; um único colaborador não é obrigado a prolongar a presença até ao fecho. Pausas do funcionamento (entre intervalos de abertura) nunca contam como trabalho, mesmo quando um turno é deslocado para mais tarde.

Conservam-se 40h/semana por colaborador ativo, certificação independente automática, integridade dos meses vizinhos apenas em leitura e rascunhos locais por mês. Não foram adicionados novos campos de configuração nem modificações à UI ou Supabase. **Regerar um mês pode substituir apenas a proposta desse próprio mês, após confirmação; horários de meses anteriores permanecem inalterados.** Ainda não são verificadas todas as regras laborais de pausa/descanso, pelo que os turnos gerados continuam a ser propostas.

## PR80 — Diagnóstico da distribuição para 2, 10, 50 e 200 colaboradores

**Objetivo desta etapa:** medir e testar o algoritmo V2 atual; não altera a geração, a certificação, a UI nem a persistência. Os resultados abaixo provêm de testes sintéticos e reproduzíveis, não de dados pessoais nem de utilização real.

Executar:
```bash
npm ci
npm run test:distribution
npm run build
```

O cenário comum é **28 dias a partir de 02/11/2026**, segunda a sexta **09:00–19:00**, sábado e domingo encerrados. Cada colaborador ativo necessita de 40h por semana e recebe 20 intervalos de 8h. São verificadas as hard constraints já implementadas, o determinismo (mesma entrada = mesma saída), a ausência de alterações nos inputs e a qualidade da distribuição. Os resultados detalhados aparecem na saída dos testes com a marca `SCHEDULE_DISTRIBUTION_DIAGNOSTIC`.

### Resultados observados no GitHub Actions 44500072146 (19/11/2026)

| Pessoas | Turnos em 28 dias | Inícios diferentes por dia | Pessoas sem início exato às 09h | Pessoas sem fim exato às 19h | Diferença máxima entre médias individuais de início | Tempo de execução, duas medições |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2 | 40 | 2 | 0 | 0 | 0 min | 14,55 / 2,34 ms |
| 10 | 200 | 10 | 0 | 0 | 13,4 min | 12,91 / 9,34 ms |
| 50 | 1 000 | 50 | 30 | 30 | 58,9 min | 47,87 / 74 ms |
| 200 | 4 000 | 121 | 180 | 180 | 105 min | 232,4 / 242,66 ms |

Em todos os quatro casos, a certificação das **40h semanais** foi `valid` (segundo as regras implementadas). Os valores de duração são observações pontuais num runner partilhado: **não são SLA**, não provam comportamento em todos os dispositivos e não permitem extrapolar desempenho para milhares de pessoas.

**Interpretação:** a heurística atual alterna de forma equilibrada para 2 pessoas, mas à medida que a equipa cresce as médias individuais dos inícios divergem. Com 200 pessoas, a dispersão entre médias é de 105 minutos dentro de uma margem total de 120 minutos. O algoritmo desloca a posição de cada pessoa apenas um índice por dia civil, sem otimizar diretamente a equidade num horizonte de várias semanas. A inexistência de abertura/fecho exato para muitos colaboradores, isoladamente, **não constitui violação**: há apenas 20 dias úteis e cada dia tem um número limitado de posições exatas de abertura e fecho. Também existem apenas 121 minutos de início possíveis entre 09:00 e 11:00, pelo que **121 inícios distintos para 200 pessoas** é compatível com a granularidade de um minuto e com a possibilidade de turnos coincidentes.

Foi executado ainda um cenário de **dezembro de 2026 (31 dias), 200 colaboradores**, produzindo 4 600 atribuições apenas dentro de dezembro, em cerca de 285 ms, com estado `insufficient_context` porque os dias exteriores de novembro/janeiro não foram fornecidos. O motor não inventou contexto e não declarou a proposta validada.

**Próxima decisão:** melhorar a equidade ao longo do horizonte sem acrescentar cobertura mínima, exigência de turnos exclusivos ou outra hard constraint. Primeiro comparar pequenas variantes da rotação contra estas mesmas métricas e validar com casos reais. A certificação atual continua incompleta quanto a pausas, descansos e legalidade final.

## PR81 — Distribuição automática e justa das horas de entrada

O PR80 mediu uma diferença de até **105 minutos entre as médias individuais de entrada** numa equipa de 200 colaboradores. O PR81 substitui a distribuição proporcional ao número de pessoas por uma **heurística automática de rotação**, sem controlo ou configuração adicional na interface. O utilizador continua a clicar apenas em **Gerar horário**.

O motor calcula as posições de início possíveis a partir do funcionamento real da empresa, das horas de trabalho necessárias e do número de colaboradores ativos. **Prefere entradas à hora certa** quando existem posições distintas suficientes para a equipa; **considera também meias horas** quando é útil ter mais posições. Para uma empresa aberta de segunda a sexta das 09:00 às 19:00, com 8h de trabalho por colaborador, isto produz por exemplo:

- 2 colaboradores: 09:00–17:00 e 11:00–19:00, alternando;
- 3 colaboradores: 09:00–17:00, 10:00–18:00 e 11:00–19:00;
- 4 colaboradores: pode distribuir 09:00–17:00, 09:30–17:30, 10:30–18:30 e 11:00–19:00;
- equipas maiores: reutilizam as posições de meia em meia hora, alternando as atribuições em cada dia civil.

**Não existe um seletor de 30/60 minutos**, nem uma regra obrigatória de cobertura mínima ou exclusividade de horários. O alinhamento é uma *soft preference*, nunca uma hard constraint: se não houver entrada alinhada que permita cumprir a abertura e a duração do trabalho, o gerador preserva a viabilidade em vez de inventar horários ou reprovar turnos. A grelha baseia-se no relógio real, mesmo em funcionamento repartido; não confunde pausas de funcionamento com trabalho. O certificador independente não rejeita um turno manual tecnicamente válido só porque começa, por exemplo, às 09:15.

A rotação acompanha as datas civis sem reiniciar ao entrar num novo mês e mantém a geração exclusivamente dentro do período editável. Os horários de meses vizinhos são sempre contexto read-only. Os rascunhos já guardados não são modificados até uma geração e substituição expressamente confirmadas.

### Regressão de equidade

Os testes de diagnóstico sintéticos utilizam 28 dias, 20 dias úteis, 09:00–19:00 e 40h semanais obrigatórias por colaborador. Comparação com PR80:

| Ativos | Amplitude das médias antes | Amplitude após rotação automática | Posições de início por dia |
| ---: | ---: | ---: | ---: |
| 2 | 0 min | 0 min | 2 |
| 10 | 13,4 min | 0 min | 5 |
| 50 | 58,9 min | 0 min | 5 |
| 200 | 105 min | 0 min | 5 |

As métricas demonstram equidade **apenas neste cenário sintético**; não comprovam justiça com exceções, diferentes durações ou preferências ainda não implementadas. Os testes verificam também determinismo, 40h/semana exatas, ausência de mutações, mês civil de 31 dias, continuidade entre meses e separação entre restrições hard e preferência soft. O gerador ainda não certifica todas as pausas e descansos legais e só guarda rascunhos locais, não horários oficiais.

Verificar com `npm test`, `npm run test:distribution` e `npm run build`. No Safari, basta abrir `/horarios`, carregar em **Gerar horário** e observar os turnos: não há qualquer seletor a configurar.

## PR82 — Estabilidade de turnos dentro da semana, com rotação entre semanas

**Requisito confirmado pelo utilizador:** numa empresa aberta de segunda a sexta-feira, das 09:00 às 19:00, dois colaboradores de 40h semanais devem manter sempre que possível o mesmo turno de segunda a sexta e **trocar de turno na semana seguinte**. Esta é uma correção da interpretação anterior (que tentava alternar os dias de trabalho, incluindo o sábado). Essa interpretação anterior foi rejeitada, a branch do PR82 foi reposta à `main` e o PR82 foi reformulado, sem alterar a seleção dos dias de trabalho.

| | Colaborador A | Colaborador B |
| --- | --- | --- |
| Semana 1 | 09:00–17:00 todos os dias úteis | 11:00–19:00 todos os dias úteis |
| Semana 2 | 11:00–19:00 todos os dias úteis | 09:00–17:00 todos os dias úteis |
| Semana 3 | 09:00–17:00 todos os dias úteis | 11:00–19:00 todos os dias úteis |

*Exemplo ilustrativo de atribuição de pessoas aos turnos; a posição inicial depende da semana civil de referência.*

### O que muda tecnicamente

Só a unidade de rotação do início de turno: antes rodava por **dia civil**; agora roda por **semana civil segunda–domingo**, com âncora global de segunda-feira (1970-01-05). **Não reinicia** no primeiro dia de cada mês, nem quando o horizonte é consultado como 7, 14, 21, 28 dias ou mês civil. As posições continuam a ser calculadas automaticamente a partir das horas de funcionamento, do tempo atribuído a cada dia e do número de colaboradores, preferindo entradas às horas certas ou meias horas quando necessário. Não há seletor na interface.

A seleção de dias e a repartição de horas semanais podem agora ser otimizadas em dias abertos de durações diferentes (ver extensão abaixo), **sem alterar** as 40 horas semanais obrigatórias nem as regras de certificação. A estabilidade do turno é uma **preferência SOFT**: dias com funcionamento ou durações de trabalho diferentes podem exigir horários diferentes, e nesse caso a validade tem prioridade. Não há cobertura mínima, alteração às folgas, regras adicionais de descanso, Supabase ou persistência.

### Como validar

Os testes com **2 colaboradores** exigem que ambos mantenham a mesma entrada e saída em cada um dos cinco dias da semana e **troquem de turno na semana seguinte**. Foram acrescentados testes para fronteira novembro/dezembro com dados de novembro apenas em leitura, garantindo que o turno de 30/11 se mantém em 01/12–04/12, sem escrever em novembro. Mantêm-se os testes de 2, 10, 50 e 200 pessoas, determinismo, funcionamento repartido, mês de 31 dias e certificador independente.

**Trade-off mensurável:** com cinco posições de meia em meia hora entre 09:00 e 11:00, o período de 28 dias tem apenas quatro semanas. Mantendo o turno fixo dentro de cada semana, a diferença entre médias individuais de início pode chegar a **30 minutos** em quatro semanas, em vez de 0 minutos na versão que alternava todos os dias. Isto não implica favorecimento permanente: um ciclo de **cinco semanas** permite que cada pessoa percorra as cinco posições. Os limites de desempenho e equidade dependem do cenário e não substituem regras de equidade de longo prazo ainda por definir.

Executar `npm test`, `npm run test:distribution`, `npm run build`. Validar no Safari a geração de duas semanas consecutivas com dois colaboradores 09h–19h, sem substituir propostas antigas até estar satisfeito com o resultado.

### PR82 — Distribuição semanal pelos dias reais de funcionamento (extensão)

Depois de confirmar a rotação estável dos horários de entrada entre semanas, o utilizador identificou outro limite: a alocação das **40h semanais** era feita sempre por ordem de dia civil, até 8h/dia, pelo que ignorava qualquer dia aberto depois de as primeiras cinco jornadas terem consumido as 40h. A clarificação é **geral**: todos os dias/intervalos de funcionamento da empresa devem ser candidatos, sejam quais forem os seus nomes, ordens, aberturas ou durações; sábado não tem qualquer tratamento especial. **Ainda não decidir/implementar alternância de colaboradores por dias.**

O gerador passa a otimizar em conjunto as durações de trabalho da semana em todos os dias abertos e editáveis, quando o contexto semanal exterior é completo. A função `allocateBalancedWeek` procura: (1) utilizar os dias viáveis abertos, sem considerar a presença como nova hard constraint de cobertura; (2) aproveitar integralmente períodos mais curtos quando possível, em vez de os encurtar para criar desfasamentos sem utilidade; (3) manter durações iguais nos dias com a mesma capacidade de funcionamento (estabilidade); (4) evitar turnos residuais muito curtos; e (5) não exceder a capacidade temporal nem as 40h semanais obrigatórias. Tudo isto é SOFT, não uma regra de cobertura. A seleção automática dos horários de entrada continua a preferir horas e meias horas e mantém o mesmo início ao longo de uma semana sempre que as capacidades/durações o permitem. Em semanas que atravessam meses e não têm contexto de todos os dias, conserva-se o comportamento conservador e o certificador devolve `insufficient_context`, sem inventar turnos nos meses adjacentes.

**Caso concreto corrigido após validação do utilizador:** segunda a sexta 09:00–19:00, sábado 09:00–13:00 e domingo encerrado, duas pessoas de 40h. O motor distribui **4 × 7h + 1 × 8h + 1 × 4h = 40h por pessoa**, com quatro dias longos de duração igual e um quinto dia longo de duração diferente para completar exatamente 36 horas antes do dia curto. Como no dia de funcionamento reduzido são atribuídas **as quatro horas completas**, todos os colaboradores começam às **09:00 e saem às 13:00**, sem desfasamentos artificiais nem necessidade de escolher turnos nesse dia. O dia curto foi identificado apenas pela sua **capacidade relativa**, nunca pelo nome «sábado». Em horários mais complexos, aproveitar integralmente um período curto é uma preferência, não uma obrigação de cobertura nem uma regra de presença individual.

Também foram testados sete dias de funcionamento, com durações diferentes e períodos interrompidos, o caso de 36h totais de abertura (certificação correta como inválido por faltarem 4h), continuação de uma semana de novembro para dezembro sem modificar novembro, e equipas de 2, 10, 50 e 200 pessoas no cenário 6 dias abertos. Não foi alterada a interface, o modelo de dados, as folgas, a seleção de pessoas por dia, a persistência, o Supabase nem a regra hard de 40h por semana. **A distribuição pelos dias e as entradas alinhadas continuam preferências soft, sem cobertura mínima.**

**Revisão adicional — 19/11/2026:** a geração do PR82 foi novamente testada com períodos curtos de 4h colocados em **qualquer um dos sete dias**, incluindo todos os colaboradores ativos na mesma janela 09:00–13:00. No cenário de seis dias abertos, foram testadas equipas de 2, 10, 50 e 200 pessoas, verificando 4h completas no dia curto, 36h redistribuídas pelos restantes dias, 40h/semana certificadas e turnos de entrada/saída estáveis quando a duração do trabalho é igual. Os testes sintéticos não equivalem a certificação legal de pausas e descansos.

## PR83 — Quantidade semanal de dias de folga por colaborador, sem dias fixados

Esta é a **primeira fase de experimentação** de folgas. Na página **Configuração → Equipa**, ao adicionar ou editar um colaborador, pode definir-se apenas a **quantidade de dias sem trabalho por semana civil (segunda a domingo)**. Não se indicam datas nem dias da semana. A opção **«Por definir»** mantém o comportamento anterior. O campo opcional `weeklyDaysOff` aceita os inteiros de 0 a 6.

A interpretação operacional deste primeiro modelo é: para um colaborador com `weeklyDaysOff=N`, uma semana completa e conhecida deve conter **exatamente N datas sem atribuições de trabalho e 7−N datas distintas com trabalho**, bem como **40 horas exatas**. Datas em que a empresa está encerrada contam para o número de datas sem trabalho, mas **não são declaradas nem etiquetadas automaticamente como folga oficial**. Tal como antes, a página Horários mantém «Sem turno atribuído» nos dias sem atribuições. A definição formal de folgas identificadas e os seus dias específicos ficam para uma etapa posterior.

**Hard constraints:** 40h/semana por colaborador e número semanal configurado de dias sem trabalho. O certificador independente `src/certifySchedule.ts` verifica ambos e emite `WEEKLY_DAYS_OFF_MISMATCH` para quantidades incompatíveis. Dias com turnos repartidos são contados apenas uma vez. Semanas que atravessam meses só são certificadas como válidas quando o contexto externo está completo; não é permitido tratar datas desconhecidas como folgas. Um excesso conhecido de dias de trabalho pode ser inválido mesmo com contexto externo incompleto.

**Preferências soft preservadas:** distribuição automática dentro do funcionamento real, aproveitamento de janelas curtas e estabilidade de turnos sempre que viável. Para garantir a contagem semanal, o motor escolhe um subconjunto de dias com funcionamento e encontra nele as horas de trabalho exigidas. Não há regras particulares para sábados, mínima cobertura, dias específicos de descanso ou alternância de folgas. Se a configuração for incompatível com o funcionamento e as 40h, o resultado é `invalid`: o motor não cria turnos fora das horas de abertura nem certifica uma solução falsa.

**Compatibilidade:** equipas já guardadas no formato V2 continuam legíveis sem qualquer migração ou valor assumido de folgas. O novo campo só fica guardado quando é explicitamente definido; o armazenamento continua local neste dispositivo. A configuração não altera automaticamente propostas mensais guardadas. Ao regenerar uma proposta, a certificação pode passar a detetar conflito com regras que foram entretanto modificadas.

### Casos de teste

Empresa com segunda–sexta 09:00–19:00, sábado 09:00–13:00, domingo encerrado, cada colaborador com 40h obrigatórias:

| Dias sem trabalho/semana | Dias trabalhados | Distribuição possível |
|---:|---:|---|
| 1 | 6 | Quatro dias de 7h, um de 8h, dia curto completo de 4h |
| 2 | 5 | Quatro dias de 9h, incluindo dia curto completo de 4h |
| 3 | 4 | Quatro dias de 10h; a janela curta pode ficar sem turno |

Não são prescritas folgas em dias concretos. Os testes automatizados verificam ainda: equipas diferentes com quantidades diferentes, valores inválidos e proteção dos dados antigos; certificação independente e confrontos impossíveis; meses cruzados com contexto exterior apenas em leitura; geração determinística para equipas de **2, 10, 50 e 200 pessoas**. A medição em CI não é uma garantia de desempenho em produção.

Executar `npm ci`, `npm test`, `npm run build` e `npm run dev`, e validar no Safari a edição de cada colaborador e a geração de uma nova proposta. A interpretação formal de folgas como registos próprios e os descansos previstos na lei **não estão ainda implementados nem certificados**.

### Correção PR83 — distribuir dias sem trabalho entre colaboradores

A primeira versão de PR83 selecionava os dias de trabalho de **cada pessoa isoladamente**, sem considerar as restantes. Em cenários simétricos (várias jornadas longas iguais e uma janela curta), todas as pessoas com dois dias sem trabalho acabavam por escolher o mesmo dia longo, criando uma concentração artificial de ausências. O utilizador identificou esse problema no Safari com **quatro colaboradores**, um configurado com 1 dia sem trabalho/semana e três com 2.

A correção mantém as restrições obrigatórias inalteradas e introduz uma **preferência SOFT de distribuição conjunta por semana civil**: depois de preservar as janelas mais curtas quando a carga semanal permitir, o motor escolhe para cada pessoa os dias de trabalho que acrescentem a menor concentração de ausências nos dias abertos. Para esse efeito, acompanha apenas a contagem de dias sem trabalho já atribuídos à equipa nessa semana, nunca dias da semana fixados ou uma exigência de presença mínima. O mapa é reiniciado em cada semana. Colaboradores antigos sem preferência configurada também contribuem para a contagem das ausências já geradas. A otimização mantém uma escolha determinística em cada execução.

**Exemplo reproduzido:** quatro pessoas, 40h semanais, empresa aberta em cinco dias longos de 10h, uma janela curta de 4h, outro dia encerrado; uma pessoa com 1 dia sem trabalho, três pessoas com 2. Todos trabalham na janela curta; as três ausências adicionais ficam **distribuídas por três dias longos distintos**, em vez de concentradas todas na sexta-feira. Num dos testes de regressão, a presença nos cinco dias longos fica [3, 3, 3, 4, 4] em cada semana. A janela curta pode estar em qualquer dos sete dias; não há uma exceção para sábado ou domingo.

**Escala sintética:** com duas folgas configuradas por pessoa e uma janela curta aberta, a contagem de presenças nos cinco dias longos na primeira semana é: equipa de 2 → [2, 2, 2, 1, 1]; de 10 → [8, 8, 8, 8, 8]; de 50 → [40, 40, 40, 40, 40]; de 200 → [160, 160, 160, 160, 160]. As 40h e a contagem semanal de dias sem trabalho continuam certificadas. Estes números demonstram distribuição no cenário testado, **não** um mínimo de cobertura exigido nem uma garantia geral de equidade em todas as configurações. Não foi introduzida alternância de pessoas entre semanas.

O calendário ainda distingue «Sem turno» de folga registada, mantém a mesma interface e não altera propostas guardadas. A distribuição das ausências é um critério de otimização, não uma nova hard constraint.

### PR83 — Filtro de colaborador na página Horários

Para permitir verificar visualmente a distribuição individual dos turnos e dos dias sem trabalho, o calendário mensal passou a ter o filtro **«Ver horário de»**, com as opções **«Toda a equipa»** (vista inicial) e cada colaborador existente na Equipa. A seleção não altera o motor, as 40 horas obrigatórias, a certificação, as escolhas de folgas nem os dados guardados.

- **Toda a equipa:** o calendário mantém as contagens de turnos por dia e o detalhe com as pessoas escaladas.
- **Pessoa selecionada:** cada dia do mês apresenta as suas **horas de entrada e saída** ou **«Sem turno»**; o detalhe do dia mostra apenas os seus intervalos, incluindo períodos repartidos.
- No topo, a vista individual apresenta o total de horas e o número de dias com trabalho **nesse mês** (não são horas semanais nem uma contagem de folgas formais).
- O filtro mantém a pessoa selecionada ao navegar entre meses. Funciona sobre **pré-visualizações ainda não guardadas** e sobre **propostas mensais guardadas**, privilegiando a pré-visualização quando existe.
- O filtro é **exclusivamente de consulta**. O botão Guardar proposta e o certificador independente continuam a receber o conjunto completo de turnos de todos os colaboradores; não existe gravação de um horário filtrado.
- Colaboradores presentes numa proposta antiga, mas ausentes da equipa atual, continuam disponíveis na lista para que os turnos guardados não fiquem escondidos; são identificados como «Colaborador não encontrado».
- **«Sem turno» não significa automaticamente «Folga».** Não foi adicionada qualquer classificação de folgas oficiais.

Código: `src/calendarScheduleView.ts` contém apenas a projeção de leitura por colaborador e os totais; `src/CalendarScheduler.tsx` apresenta o filtro; estilos locais em `src/calendarScheduler.css`. Testes automatizados verificam isolamento do colaborador, turnos repartidos, dias sem turno, ausência de mutação e que a gravação e a certificação continuam a usar a proposta completa. Deve ser validado no Safari com o cenário de quatro colaboradores do PR83 antes do merge.

## PR84 — Um único turno com pausa interna e cobertura contínua (revisão de 20/11/2026)

O utilizador definiu uma pausa de refeição de **60 minutos**, que só pode começar **a partir de três horas após a entrada**, sem pausa em jornadas curtas. A duração ainda não é configurável. Para a experiência inicial, jornadas com até **4h efetivas** são tratadas como curtas; trata-se de uma escolha operacional provisória, não de um parecer jurídico.

A **primeira implementação do PR84 foi rejeitada** pelo utilizador por dois motivos objetivos:
1. Produzia **dois turnos** para a mesma pessoa (um antes e outro depois da refeição). Isto é incorreto: a pessoa tem **um único turno de entrada a saída** e a pausa acontece dentro desse turno.
2. Distribuía pausas isoladamente e podia deixar a empresa **sem ninguém a trabalhar durante a abertura**. A nova regra exige **pelo menos um colaborador efetivamente a trabalhar em cada minuto de funcionamento**. Não foi introduzido um mínimo de duas ou mais pessoas, apenas ausência de cobertura zero. Ao contrário da política SOFT de distribuição anterior, esta exigência é agora uma **HARD constraint explícita** para propostas novas.

### Modelo correto

O objeto `WorkAssignment` representa **um turno por colaborador e data**, por exemplo:

```ts
{
  memberId: "id-da-pessoa",
  date: "2026-11-02",
  start: "09:00",
  end: "18:00",
  mealBreak: { start: "12:00", end: "13:00" },
}
```

O tempo de trabalho efetivo é `(18:00-09:00)-(13:00-12:00)=8h`. A pausa **não é um segundo turno**. O turno único aparece no calendário como `09:00–18:00`, com a pausa `12:00–13:00` identificada **dentro do turno**, e oito horas efetivas. Para uma janela curta `09:00–13:00`, há um turno `09:00–13:00` **sem refeição**, totalizando quatro horas.

### Planeamento e certificação

- `src/mealBreaks.ts` produz **candidatos de turno único** com pausa opcional embutida e hora de refeição válida. Os dois segmentos de trabalho efetivo antes/depois da pausa são usados **apenas para contas e validação**; não são turnos separados. Em empresas com abertura repartida, a pausa pode coincidir com um fecho de uma hora, se for viável.
- `src/mealCoveragePlanner.ts` coordena os turnos de **todos os colaboradores de um mesmo dia**. A escolha privilegia cobrir minutos abertos ainda sem ninguém, antes de preferências como entrada estável/rotação semanal, e nunca cria trabalhadores, horários fora da abertura ou horas em excesso.
- `src/workAssignments.ts` valida o turno com pausa aninhada, desconta a pausa de `assignmentMinutes` e calcula intervalos efetivamente trabalhados para avaliar abertura/cobertura.
- `src/certifySchedule.ts` certifica independentemente: **um único turno por pessoa/data**, pausa **60 minutos**, início **>= entrada+180 minutos**, ausência de pausa em jornadas curtas, horários de funcionamento respeitados, **zero lacunas de cobertura** em cada intervalo de abertura, 40h efetivas semanais e número de dias sem trabalho configurado. Um problema `OPENING_UNCOVERED` inclui data e horário exato da primeira lacuna encontrada em cada intervalo.
- **Se uma configuração for impossível** (por exemplo, duas pessoas com folgas que deixam uma pessoa sozinha numa janela de 10h, com pausa obrigatória), o resultado é `invalid`, mesmo que cada pessoa cumpra 40h. É uma incompatibilidade de constraints; o motor **não deve inventar cobertura nem declarar uma solução válida**.

Exemplo com empresa aberta `09:00–19:00` e duas pessoas, cada uma com oito horas de trabalho efetivo por dia:

| Pessoa | Turno | Pausa | Horas efetivas |
|---|---|---|---|
| A | 09:00–18:00 | 12:00–13:00 | 8h |
| B | 10:00–19:00 | 13:00–14:00 | 8h |

Esta distribuição cobre integralmente a abertura. O exemplo é ilustrativo: a escolha automática pode trocar os horários entre pessoas e semanas, mas **não pode deixar lacunas** se a proposta for considerada válida.

### Persistência e histórico

`src/monthlyScheduleDraftRepository.ts` guarda as propostas novas com `mealBreakPolicy:"v2"` e os turnos únicos com `mealBreak` aninhado, mantendo o mesmo envelope mensal `version:1` para preservar dados existentes. Os rascunhos antigos sem refeições e os rascunhos experimentais `mealBreakPolicy:"v1"` com pausa separada continuam **legíveis**, sem regravação automática. A página Horários identifica propostas antigas como **«Modelo anterior»**, em vez de as apresentar como certificadas pelas novas regras. Regenerar uma proposta exige confirmação antes de substituir a antiga; os outros meses são contexto apenas de leitura.

### Testes

A suite verifica dois colaboradores sem intervalo descoberto (até ao minuto), rejeição de pausas simultâneas que deixam a empresa vazia, rejeição de dois turnos por pessoa, pausas fora de regra, quatro pessoas com folgas diferentes, abertura repartida, 40h efetivas, semanas que atravessam meses e reprodução determinística. Testes de 28 dias cobrem equipas de 2, 10, 50 e 200 pessoas com configuração compatível de folgas; outra prova mostra que folgas incompatíveis produzem `invalid`, mesmo com as 40 horas corretas.

A validação automatizada não substitui teste funcional no Safari nem certificação legal integral. O PR84 permanece em **Draft**, fora da `main`, até confirmação do utilizador.

### PR84 — Dias de funcionamento curto são indivisíveis (20/11/2026)

**Regra confirmada pelo utilizador:** sempre que um colaborador tem turno num dia cuja abertura da empresa é curta, trabalha **a jornada completa de funcionamento**, não apenas uma parte para acertar as contas semanais. Isto **não obriga todos os colaboradores a trabalhar nesse dia**; obriga cada pessoa escalada a cumprir a janela completa. Não existem condições especiais por nome do dia (incluindo sábado). Nesta fase, «dia curto» significa até **4h totais de abertura**, tal como a regra inicial de não atribuir pausa para refeição nas jornadas até quatro horas.

Exemplos:
- Abertura **09h–13h**: quem estiver escalado trabalha **09h–13h**, quatro horas efetivas e sem refeição; atribuições como 09h–11h ou 10h–13h são **inválidas**.
- Abertura **10h–13h**: quem estiver escalado trabalha **10h–13h**, três horas efetivas e sem refeição.
- Num dia sem turno atribuído ao colaborador, nada é criado artificialmente. A obrigação de cobertura de funcionamento permanece independente.

**Algoritmo:** em `src/generateSchedule.ts`, a alocação semanal mantém a otimização anterior para jornadas normais, mas avalia as combinações possíveis de dias curtos **inteiros ou não trabalhados**. Para um máximo de sete datas civis por semana, esta enumeração é pequena. Só considera válidas as distribuições que cabem no total semanal sem fragmentar os dias curtos. No caso de contexto mensal incompleto, a alocação conservadora também deixa de atribuir remanescentes parciais numa janela curta. Se não houver solução que cumpra simultaneamente 40h, dias de descanso, pausas, abertura e cobertura, o resultado deve ser marcado `invalid` ou `insufficient_context` conforme o contexto conhecido, nunca «valid» falsamente.

**Certificação independente:** `src/certifySchedule.ts` introduz `SHORT_OPENING_INCOMPLETE`: cada turno efetivamente atribuído num dia curto tem de coincidir com o início e o fim do funcionamento desse dia e totalizar todas as horas de abertura. A verificação é independente da heurística do gerador. Se o funcionamento curto for repartido em intervalos incompatíveis com o atual modelo de turno único e sem pausa, o motor não inventa um turno equivalente: a proposta fica inválida.

**Testes:** casos de abertura 09h–13h deslocada para **qualquer dia da semana**, abertura de três horas 10h–13h, vários dias curtos numa só semana, cumprimento das 40h efetivas, e rejeição deliberada de uma atribuição parcial 10h–13h num dia 09h–13h. Mantêm-se as regressões de 2/10/50/200 colaboradores, refeições dentro de um único turno e cobertura contínua. **CI GitHub Actions [44763336983](https://github.com/gv62hfjc8c-dot/schedule-engine/actions/runs/44763336983)** em `698759ab4df223d2a8f8236139f11d5c3e624d75`: `npm ci` PASS, **196/196 testes PASS**, `npm run build` PASS. Falta aceitação manual no Safari. PR84 ainda em Draft, fora da main.

### PR84 — Deteção automática de jornadas curtas de cinco horas (20/11/2026)

**Problema comprovado no Safari:** a empresa do teste tem abertura **08:30–19:00 de segunda a sábado (10h30)** e **14:00–19:00 ao domingo (5h)**. O motor anterior só identificava jornadas curtas com até **4 horas**, pelo que o domingo era tratado como uma jornada normal, limitada a quatro horas efetivas depois de descontada uma pausa, originando entradas desfasadas **14:00–18:00** e **15:00–19:00** para quatro colaboradores. Isso contradiz a regra de cada colaborador escalado trabalhar **toda a abertura curta**.

**Correção:** uma janela curta é identificada a partir do **funcionamento semanal da empresa**, não pela duração que o motor atribuiu a um colaborador, nem pelo nome do dia. Nesta fase experimental, é considerada curta uma abertura diária de até **4h**; aberturas de **mais de 4h até 6h** também são curtas quando a sua duração **não ultrapassa dois terços** da maior jornada de abertura da empresa na semana. A regra é explícita, determinística, sem novo seletor e ainda pode ser refinada com mais casos reais. Por exemplo: 5h aos domingos versus 10h30 nos dias normais => **curta**; um dia de 8h versus 10h30 => **normal**. Isto não é uma classificação legal universal de períodos de refeição.

**Invariante HARD:** qualquer colaborador com turno num dia curto deve trabalhar **a totalidade da abertura**, sem pausa para refeição. Exemplo real, abertura 14:00–19:00 => cada um dos quatro colaboradores escalados tem **um único turno 14:00–19:00**, cinco horas efetivas; a atribuição de 14:00–18:00 ou 15:00–19:00 é inválida. Isto não implica obrigar todos os colaboradores da equipa a trabalhar nos dias curtos: apenas os que forem escalados.

**Alterações verificadas:**
- `src/shortOpenings.ts`: regra pura comum que classifica dias curtos a partir da configuração semanal; nenhum dia específico codificado.
- `src/generateSchedule.ts`: alocações curtas mantêm a estratégia **totalidade ou nenhum turno**; a capacidade do dia curto é igual ao total de abertura, mesmo quando ultrapassa as antigas quatro horas.
- `src/mealBreaks.ts` e `src/mealCoveragePlanner.ts`: em dias classificados como curtos, a opção gerada é o **turno completo de abertura, sem pausa**, mesmo para cinco horas efetivas. A pausa de 60 minutos após pelo menos três horas continua para as jornadas normais.
- `src/certifySchedule.ts`: classifica independentemente os mesmos dias a partir da configuração da empresa e rejeita qualquer atribuição parcial com `SHORT_OPENING_INCOMPLETE`. A ausência de pausa numa abertura curta válida de cinco horas deixa de ser sinalizada como `MEAL_BREAK_MISSING`.
- `src/monthlyScheduleDraftRepository.ts`: aceita guardar uma jornada de cinco horas sem pausa; a obrigatoriedade da pausa depende do horário da empresa e é certificada pelo validador com acesso a esse contexto, não por uma regra cega de duração do turno no armazenamento.

**Teste real automatizado:** quatro colaboradores, folgas semanais configuradas como `1, 2, 2, 2`, período semanal que inclui domingo **2026-11-22**, abertura 08:30–19:00 de segunda a sábado e 14:00–19:00 ao domingo. O gerador produziu e certificou `valid` **quatro turnos de domingo 14:00–19:00, sem pausa**, 40 horas efetivas por colaborador, e cobertura de todo o funcionamento em todos os dias. O teste adulterou turnos para 14:00–18:00, 15:00–19:00 e 14:30–18:30 e confirmou `invalid` via certificador independente. Inclui teste de gravação/releitura do turno de cinco horas e identificação de uma abertura curta de cinco horas noutro dia da semana, sem regra específica para domingo.

**CI da correção:** GitHub Actions [44832458449](https://github.com/gv62hfjc8c-dot/schedule-engine/actions/runs/44832458449), head `480a97b2689d495a5a41fc9f01303aa26de12ed9`: `npm ci` PASS, **200/200 testes PASS**, `npm run build` PASS. PR84 permanece **OPEN/DRAFT, sem merge**, a aguardar confirmação visual desta correção no Safari. Não foram alterados outros meses nem horários guardados.

## PR85 — Equilíbrio de horas com janela móvel de 28 dias

Novo modo experimental no calendário da V2: cada data é avaliada com os 27 dias civis anteriores, sem âncora nem data inicial. Para 40h semanais, a referência é **160 horas em 28 dias**. Não se atribuem débitos, créditos ou pagamentos salariais a partir da diferença.

### Comportamento
- Com um colaborador selecionado, a página mantém o total de horas e dias do mês e acrescenta as horas dos **últimos 28 dias**, comparadas com a referência de 160h. A data final é a data selecionada ou o último dia do mês.
- O gerador percorre as semanas cronologicamente e consulta os **21 dias anteriores** à semana que está a construir. Com histórico completo, o objetivo sugerido para a nova semana aproxima o total de 28 dias de 160h. Exemplos: 118h nas três semanas anteriores sugerem 42h; 122h sugerem 38h. A sugestão tem suavização de +/-4h por passo, só de otimização, nunca uma regra legal.
- Sem histórico completo, o gerador usa a referência prudente de 40h para essa semana e a interface marca o saldo móvel como **por apurar**, não zero.
- O certificador com a política rolling28 deixa de impor 40h exatas em cada semana, mantendo as demais verificações: folgas configuradas, turno único por dia, refeição interna, jornada curta completa e cobertura contínua.
- Para novos horários, a política fica guardada no rascunho do mês. Rascunhos antigos sem esta política mantêm a verificação semanal original.
- O histórico de meses anteriores é lido sem escrita. Erros de armazenamento impedem a geração para não inventar horas.

### Módulos e testes
- src/rolling28Day.ts — janela móvel por data, horas efetivas e dados ausentes.
- src/rollingHoursPlan.ts — sugestão de horas semanais informada pelo histórico.
- src/generateSchedule.ts — aplicação da sugestão sem comprometer cobertura, turnos e folgas.
- src/certifySchedule.ts — política alternativa com 40h como objetivo e não igualdade hard.
- src/monthlyScheduleDraftRepository.ts — histórico dos 27 dias anteriores e persistência da política.
- tests/rolling28Day.test.ts e tests/rollingHoursIntegration.test.ts — testes de meses cruzados, 38/42h, refeição, folgas, histórico, compatibilidade e integridade.

### Teste funcional no Safari
1. Atualizar a branch v2/rolling-28-day-analytics e reiniciar o servidor Vite.
2. Em Horários, gerar uma proposta, selecionar um colaborador e comparar horas do mês com a janela móvel.
3. Selecionar datas consecutivas: a janela avança um dia de cada vez.
4. Sem mês anterior, confirmar que o sistema informa histórico insuficiente, sem inventar dívida.
5. Guardar uma proposta, navegar para o mês seguinte e confirmar que utiliza o histórico em leitura.
6. Recarregar a página e confirmar que turnos e política persistem; testar cobertura e domingo curto.

**Limite:** trata-se de planeamento experimental de rascunhos, não de banco de horas, aprovação ou certificação legal integral. Descansos e limites laborais específicos ainda não estão completamente modelados e exigem definição antes de uso profissional.

## PR86 — Calendário em largura total e visão operacional do dia

**Decisão visual:** a página Horários mantém o painel de proposta mensal e o calendário com filtro individual. O calendário passa a ocupar a largura da página e o detalhe do dia deixa de ser uma barra lateral: aparece **por baixo** do calendário, também em largura total.

A nova linha temporal representa todos os colaboradores ativos (incluindo os sem turno), mesmo quando o calendário está filtrado por uma única pessoa. O colaborador filtrado é destacado, sem ocultar os restantes.

- **Escala temporal por dia:** o início corresponde à primeira abertura e o fim ao último fecho definidos para o dia da semana. Segunda-feira 08:30–19:00 e domingo 14:00–19:00 têm eixos diferentes automaticamente. A escala é em tempo civil real; aberturas repartidas preservam a distância do intervalo fechado, sem o considerar falta de cobertura.
- **Um turno = uma barra**, com as pausas internas assinaladas dentro da barra. Propostas antigas com pausas separadas continuam representadas sem modificar os dados.
- **Cobertura da empresa:** uma linha calcula o número de colaboradores realmente a trabalhar em cada intervalo, descontando pausas e contando cada pessoa no máximo uma vez em cada instante. Lacunas durante a abertura surgem a vermelho, com minutos em falta. Fora da abertura não há "falha".
- **Resumo:** pessoas escaladas, horas efetivas previstas, duração total do funcionamento e pico simultâneo. Sem uma proposta ou sem configuração válida, as informações não são inventadas. Num dia encerrado não se cria um eixo fictício.
- **Responsividade:** em ecrãs estreitos a linha temporal tem deslocação horizontal, com cabeçalho do tempo e nomes dos colaboradores fixos dentro da região percorrível. Os detalhes textuais dos turnos permanecem consultáveis abaixo do gráfico.
- **Separação de responsabilidades:** src/dailyTimeline.ts é uma projeção pura com escala, sobreposições e cobertura; src/DayScheduleTimeline.tsx apresenta os dados. Nenhuma alteração foi feita ao motor de geração, certificação ou persistência.
- **Testes:** tests/dailyTimeline.test.ts, tests/dayTimelineInterface.test.ts e tests/dayTimelineRender.test.ts verificam geometria, escala dinâmica, refeições, cobertura, filtros e marcação visual.

**Teste manual no Safari:** atualizar a branch v2/day-timeline-full-width, abrir Horários, gerar/consultar uma proposta, escolher uma segunda-feira e um domingo e comparar as escalas. Filtrar Teste 1 e confirmar que Teste 2 continua visível no gráfico. Confirmar cobertura nos intervalos de refeição e verificar o comportamento no telemóvel. A PR só deve ser integrada depois dessa confirmação visual.

## PR87 — Edição manual de turnos e pausas diretamente no gráfico

Esta alteração continua o PR86 e **não altera o algoritmo de geração**. O detalhe
inferior do dia torna-se editável para propostas V2, inclusive as já guardadas,
sem que o calendário filtrado oculte colaboradores da equipa.

### Comportamento aprovado

- **Barra verde do turno:** arrastar horizontalmente altera a entrada e saída
  em conjunto. A duração efetiva e a duração da presença não mudam. A pausa
  integrada acompanha a deslocação e conserva a mesma posição relativa.
- **Barra amarela da refeição:** arrastar horizontalmente altera só a pausa.
  A entrada, saída, duração da pausa e horas efetivas do turno mantêm-se.
- Os movimentos são quantizados a **15 minutos**. O deslocamento em píxeis
  é convertido proporcionalmente à escala real do dia (primeira abertura a
  último fecho). Podem usar-se as setas esquerda/direita com o controlo focado.
- Turnos não podem sair da amplitude visível do funcionamento; pausas ficam
  estritamente dentro do turno. A posição pode, contudo, violar cobertura,
  antecedência mínima da refeição, divisão de abertura ou outras regras
  implementadas: **os conflitos não provocam reversão automática**.
- Enquanto se arrasta, os turnos e a cobertura usam uma **cópia transitória**
  e a certificação é apresentada como provisória. Ao soltar, a edição passa
  para um **rascunho de alterações manuais**, e o certificador independente
  avalia a proposta mensal completa. Os problemas ficam visíveis.
- **Desfazer alteração** reverte um gesto de cada vez; **Descartar edições**
  restaura a última proposta gerada/guardada sem a modificar.
- **Guardar proposta** permanece bloqueado com violações obrigatórias.
  Antes de gravar, o motor certifica de novo **todos os turnos editados**
  com o contexto atual e confirma que os dados de origem não foram alterados.
  A gravação usa o controlo de revisão já existente; nenhuma alteração
  é escrita durante o arrastamento.
- Propostas antigas de pausas separadas (modelo V1) mantêm-se **só de
  leitura**. Regenerar uma proposta enquanto existirem edições por guardar
  exige confirmação.

### Separação técnica e validação

- src/timelineEditing.ts: transformação imutável de uma única atribuição e
  conversão determinística de píxeis em 15 minutos.
- src/TimelineDraggableBar.tsx: eventos de ponteiro com captura e operação
  equivalente por teclado. A barra do turno e a pausa são controlos irmãos,
  nunca botões aninhados.
- src/DayScheduleTimeline.tsx: controles interativos no gráfico do PR86,
  mantendo a linha de cobertura de toda a equipa.
- src/CalendarScheduler.tsx: buffer manual, pré-visualização transitória,
  certificação após cada gesto, desfazer, descarte e proteção da gravação.
- tests/timelineEditing.test.ts: deslocação de turnos/pausas, conservação da
  duração, escala variável, limites, imutabilidade e conflitos aceites mas
  rejeitados pelo certificador. Testes de interface e renderização atualizados.

### Aceitação visual no Safari

1. Abrir a branch v2/interactive-timeline-drag, gerar proposta e clicar num
   dia normal. Arrastar o turno do Teste 1 e confirmar entrada/saída + pausa.
2. Arrastar só a pausa de refeição. Confirmar entrada/saída inalteradas,
   enquanto a cobertura responde.
3. Criar duas pausas simultâneas e confirmar que a lacuna de cobertura aparece,
   que a posição fica visível ao largar e que **Guardar proposta** fica
   indisponível. Corrigir a pausa e confirmar nova certificação.
4. Usar **Desfazer alteração**, **Descartar edições** e as setas do teclado.
5. Editar um horário V2 já guardado; confirmar que uma atualização/reload sem
   guardar recupera o estado anterior e que **Guardar proposta**, após
   certificar, conserva o estado editado.
6. Testar o eixo curto de domingo 14:00–19:00. Um turno que já ocupa toda a
   abertura não pode ser deslocado para fora do funcionamento.
7. Confirmar o arrastamento e o scroll horizontal num ecrã reduzido.

**Estado atual:** PR86 e PR87 já foram validados e integrados na `main`.
Esta secção mantém os critérios históricos de aceitação.


## PR88 — Evitar jornadas de presença excessivamente longas

**Decisão operacional:** preferir **8 horas de trabalho efetivo por dia**
(ex.: 08:30–17:30 com uma hora de refeição), sem transformar esse valor
num limite obrigatório. Uma jornada até 9h efetivas pode ser necessária;
acima de 9h deve ser fortemente evitada quando há alternativa.
O objetivo é melhorar a experiência real da equipa sem perder cobertura.

### Otimização implementada

- O cálculo é sobre **trabalho efetivo**, não mera presença entre entrada
  e saída. A regra de pontuação distingue excesso acima de 8h e acima de 9h;
  este último tem maior prioridade. Com todas as jornadas abaixo de 8h,
  continuam a prevalecer as preferências existentes de consistência.
- A redistribuição local transfere carga em **blocos de 15 minutos**
  apenas entre dias normais **já trabalhados** pelo mesmo colaborador.
  Não cria nem elimina folgas, não altera as horas semanais, não mexe nos
  turnos de outros colaboradores e não fragmenta turnos.
- As **jornadas curtas** (ex.: domingo de funcionamento 14:00–19:00)
  continuam indivisíveis e prioritárias para garantir que o estabelecimento
  não fica descoberto. Se forem escaladas, são feitas por inteiro.
- Com domingo de 5h e quatro outros dias para completar 40h, o motor
  pode distribuir as 35h restantes em **4 × 8h45**, em vez de concentrar
  o trabalho em jornadas de 9h30 evitáveis.
- Para colocar um turno de 8h45 com saída às 19h, o motor passa a
  considerar **entradas às 09h15** quando necessário. Turnos de duração
  compatível continuam a usar os pontos de meia hora habituais.
  A seleção de entradas em horas certas passou a contar **horas de
  início distintas**, nunca várias opções de almoço para a mesma entrada.
- A cobertura efetiva e todas as hard constraints continuam a ser
  verificadas pelo **certificador independente**; não é um banco de horas
  nem uma certificação de legalidade.

### Validação

- src/dailyWorkloadBalance.ts — métrica pura da carga diária e
  redistribuição determinística de 15 minutos.
- src/generateSchedule.ts — inclui a prioridade diária no seletor de
  dias de trabalho e nas propostas de carga semanal.
- src/mealBreaks.ts e src/mealCoveragePlanner.ts — horários de início
  com precisão suficiente para cobrir o fecho de dias com 8h45 efetivas.
- tests/dailyWorkloadBalance.test.ts — semanas de 40h, dias de 5h,
  folgas, dias de 8h45, situações inevitáveis acima de 9h,
  cobertura, imutabilidade e saída às 19h.
- Testes de regressão existentes protegem semanas que atravessam meses,
  dias curtos completos e o comportamento mensal.

### Aceitação no Safari

1. Na branch `v2/daily-workload-balance`, configurar uma loja de segunda a
   sábado das 08h30 às 19h00 e domingo das 14h00 às 19h00.
2. Gerar novamente novembro com colaboradores reais e comparar o número
   de dias com mais de 8h/9h efetivas com a versão anterior.
3. Confirmar cobertura ininterrupta, pausas internas, folgas e turnos
   dominicais completos; observar saídas às 19h sem exigir entrada às 08h30.
4. Confirmar que o histórico guardado não foi modificado pela geração.
   O PR88 já foi validado e integrado na `main`.

**Limite conhecido:** esta é uma otimização local da carga diária, não
uma pesquisa global de todas as distribuições de domingos entre
colaboradores. Esse tema pode ser desenvolvido depois de observarmos o
comportamento real da equipa.


## PR89 — Política genérica de folgas e rotação de fins de semana (fundação)

**Objetivo:** testar a rotação de sábados/domingos em diferentes empresas,
sem codificar uma frequência fixa, uma equipa de quatro pessoas, um setor
ou uma necessidade de cobertura específica. O algoritmo de turnos e o
certificador continuam inalterados nesta fase experimental.

### Contrato do novo modelo

- **Descanso habitual (HARD):** cada pessoa tem um número configurado de
  dias sem trabalho numa semana normal, e pode ter dias de descanso
  explicitamente fixos. Um dia sem turno no calendário **não é por si só**
  considerado uma folga oficial.
- **Semana com fim de semana completo (HARD quando atribuída):** a política
  individual define quantos dias sem trabalho se devem preservar de
  segunda a sexta. Por exemplo, com mínimo 1: sábado + domingo + um dia
  útil = **3 dias sem trabalho**. Isso aplica-se quer a pessoa tenha uma
  ou duas folgas semanais habituais; a sua folga fixa continua protegida.
  Uma empresa que esteja *naturalmente fechada* sábado e domingo não
  concede automaticamente um dia extra de descanso a meio da semana.
- **Cobertura mínima diária (HARD no pré-planeamento):** a organização
  configura o número mínimo de pessoas presentes para **cada dia**.
  Fechos são declarados explicitamente; cobertura zero não significa
  necessariamente encerramento. O módulo procura conjuntos completos
  de dias com/sem trabalho que respeitem esta cobertura.
- **Frequência de fins de semana (SOFT):** não existe um intervalo universal
  de quatro semanas. O módulo tenta atribuir o máximo de fins de semana
  completos compatíveis com a configuração e prioriza quem recebeu menos
  fins de semana, considerando também o histórico fornecido e o tempo de
  espera. O algoritmo é determinístico, mas esta primeira fase **não
  certifica um ótimo global de rotação**.
- **Capacidade de horas (ANÁLISE, não horas atribuídas):** se receber a
  capacidade efetiva máxima de cada dia, o módulo calcula o limite superior
  do trabalho possível após os descansos. Quatro jornadas de 9h30 dão no
  máximo **38h**; nunca se inventam duas horas para atingir as 40h.
  A referência móvel de 160h em 28 dias permanece fora deste módulo.
- **Contexto:** o histórico anterior é opcional, mas a sua ausência é
  declarada na resposta. O ciclo prossegue entre meses e não reinicia
  automaticamente no primeiro dia do mês.
- **Limites da pesquisa:** se a pesquisa exaustiva atingir o orçamento
  determinístico de exploração, devolve **not_proven**, nunca uma
  alegação infundada de impossibilidade.

### Implementação e fronteira de responsabilidade

- `src/weekendRotation.ts`: política de descanso, escolha de fins de
  semana, atribuição explícita de dias sem trabalho, verificação de
  cobertura por **número de pessoas/dia**, capacidade horária máxima
  e continuação a partir de histórico.
- `tests/weekendRotation.test.ts`: rotação de 4/6 colaboradores, diferentes
  mínimos de cobertura, ausência de fins de semana viáveis, descanso fixo,
  empresa encerrada ao fim de semana, mudança de mês, histórico, validação
  de entradas e limite máximo de 38 horas numa semana de quatro dias.

### Integração do PR89: gerador, certificador, interface e persistência

- `src/team.ts` e `src/TeamEditor.tsx`: configuração individual
  **opt-in** da rotação, folga fixa semanal e mínimo de descanso
  segunda–sexta se sábado e domingo forem atribuídos como descanso.
  As equipas anteriores continuam legíveis e mantêm o algoritmo anterior
  enquanto não ativarem a rotação.
- `src/rotationIntegration.ts`: planeia **apenas semanas civis completas
  dentro do mês editável**, com um mínimo de pessoas derivado da capacidade
  necessária à cobertura. Este limite inferior por dia NÃO substitui
  necessidades de cobertura horária configuráveis por empresa.
- `src/generateSchedule.ts`: aplica os dias sem trabalho escolhidos
  ANTES de distribuir turnos e refeições. Em blocos de quatro semanas
  completas, procura 160h de referência total (SOFT), distribuindo
  excessos/deficiências até à capacidade de cada dia; não inventa horas
  para cumprir um objetivo inviável. Noutras semanas continua a política
  histórica móvel de 28 dias.
- `src/certifySchedule.ts`: certifica de forma **independente** as folgas
  fixas e a diferença entre descanso semanal normal e fim de semana
  completo com folga(s) adicional(is). O descanso extra não reinterpreta
  fins de semana inteiramente fora do mês editável.
- `src/plannedRest.ts` e `src/monthlyScheduleDraftRepository.ts`:
  guardam com a proposta mensal (local) os dias EXPLICITAMENTE planeados
  sem trabalho, verificando que não coincidem com turnos. O histórico
  de equidade futuro lê apenas fins de semana explicitamente guardados:
  **um dia sem turno NÃO é tratado como folga**.
  Propostas V1 e V2 antigas sem metadados de descanso mantêm-se legíveis.
- `src/CalendarScheduler.tsx`: mostra a rotação proposta por semana,
  os descansos planeados ao filtrar um colaborador e a rotação guardada
  após reabrir o mês. Não são automaticamente criadas aprovações.
- `tests/rotationIntegration.test.ts` e `tests/plannedRest.test.ts`:
  validação fim-a-fim com quatro pessoas, semanas de três dias livres,
  160h de referência, folgas fixas, cobertura, fronteiras de meses,
  imutabilidade e histórico explícito guardado/reaberto.

**Limitações ainda declaradas:** o motor não certifica a legislação laboral;
o pré-planeamento garante um limite inferior de pessoas **por dia** e o
certificador final verifica a existência de cobertura de pelo menos
uma pessoa **a cada minuto de funcionamento** (não mínimos configuráveis
por intervalo). A escolha inicial de folgas usa pesquisa determinística
limitada, sem provar a melhor rotação global em todos os cenários.
Nas semanas parciais nas fronteiras de meses preserva-se a lógica
conservadora e o contexto externo. Períodos aprovados, exceções,
presenças reais e futuras necessidades de cobertura por posto continuam
fora deste PR. Não fazer merge antes do teste real na interface.


### PR89 — Correção após teste visual de 21/11/2026 (equipa real)

Foi observado no Safari que o pré-planeador atribuía até **seis**
fins de semana completos aos mesmos sábados/domingos e, em dois
sábados, deixava o estabelecimento sem cobertura entre
**08h30 e 08h45**. O erro era um excesso de otimização da quantidade
de descansos, ignorando a capacidade de trabalho disponível para
manter a referência de **160h em 28 dias** com jornadas de qualidade.

- `src/weekendRotation.ts`: a rotação opcional aceita um orçamento
  SOFT de trabalho do ciclo, derivado das aberturas, capacidade efetiva
  e descanso obrigatório de cada colaborador. Atribuir mais fins de
  semana completos passa a ter um custo objetivo: pode exigir
  jornadas superiores a 9h ou tornar 160h inviáveis. As atribuições
  são espalhadas pelas semanas e pessoas em vez de concentradas num
  só fim de semana. **Não há frequência de 4 semanas codificada.**
- `src/rotationIntegration.ts`: o gerador passa a utilizar a
  referência existente de 160h/28d e a penalização de jornadas acima
  de 9h no cálculo do orçamento de descanso. **O objetivo de horas e
  as 9h continuam SOFT**, não limites legais nem 40h obrigatórias
  em todas as semanas.
- `src/mealCoveragePlanner.ts`: depois da escolha inicial de turnos
  e pausas, se existir uma lacuna de cobertura, testa
  reposicionamentos dos próprios turnos que reduzam estritamente os
  minutos sem cobertura; não cria turnos nem altera folgas, horas,
  pausas ou as entradas/saídas fora do funcionamento. O certificador
  continua a rejeitar lacunas que não sejam reparáveis.
- `tests/rotationIntegration.test.ts`: regressões com **oito
  colaboradores** em 28 dias, horários 08h30–19h00 de segunda a
  sábado e domingo curto 14h00–19h00, incluindo folgas fixas
  e colaboradores com uma ou duas folgas habituais. Verifica que
  não se atribuem seis descansos simultâneos e que os sábados
  14 e 21 de novembro têm abertura e fecho cobertos.
- **Contexto de fronteira:** ausência de dados verificados das semanas
  de 26/10 e 30/11 continua a produzir `CONTEXT_INCOMPLETE` — não
  se deve ocultar esse diagnóstico nem assumir que uma folga/ausência
  de turno é um facto confirmado.

O PR89 mantém-se em Draft até o caso real ser novamente confirmado
no Safari. A proposta guardada anteriormente não é automaticamente
alterada nem substituída; requer **Gerar horário** e a opção explícita
de guardar quando a certificação o permitir.

### PR89 — Equilíbrio diário como qualidade INTERNA do motor (V1)

**Decisão corrigida após validação do produto (22/11/2026):** o objetivo
indicativo de aproximadamente **60% da equipa escalada em dias abertos
NÃO é configurável**. Não existe campo, toggle, separador nem requisito
adicional na definição da empresa. O propósito é ajudar o algoritmo
a distribuir pessoas e folgas com maior equilíbrio, não criar um
novo compromisso operacional para quem utiliza a aplicação.

- `src/dailyStaffingBalance.ts`: a referência de 60% é uma heurística
  SOFT **interna**, experimental e modificável à luz de testes futuros,
  não uma hard constraint, contrato de configuração ou valor legal.
  Ex.: 8 colaboradores => 5 por dia de funcionamento, quando a equipa,
  as folgas e as necessidades de cobertura o permitirem.
- `src/weekendRotation.ts`: utiliza automaticamente essa referência
  para reduzir concentração de folgas e de fins de semana simultâneos,
  após verificar as hard constraints e a viabilidade do objetivo de
  horas do ciclo. Trocas locais de dias de descanso não modificam o
  número de folgas semanais, as folgas fixas nem a cobertura obrigatória.
- `src/rotationIntegration.ts`: mantém a integração condicionada à
  existência de uma rotação explícita de fins de semana no módulo atual.
  Equipas antigas sem essa política conservam a distribuição anterior.
- `src/operatingHours.ts` e `src/App.tsx`: nenhum campo de presença
  mínima/desejada é guardado ou apresentado na configuração. Registos
  experimentais que já tenham a antiga percentagem são carregados sem
  perder os horários de funcionamento; o campo obsoleto é descartado
  pelo validador, não se altera nem apaga o draft original na leitura.
- `src/generateSchedule.ts` e `src/CalendarScheduler.tsx`: o diagnóstico
  da distribuição é calculado com os **turnos efetivamente gerados**,
  e apresentado apenas como uma frase de contexto dentro da própria
  rotação. Não existe um novo painel/aba/opção de configuração.
- `tests/dailyStaffingBalance.test.ts` e testes de contrato da UI:
  verificam o comportamento automático com oito e quatro colaboradores,
  a preservação de dias fixos, o respeito por empresas encerradas ao
  domingo, a ausência de configuração e a manutenção dos dados antigos.

**Nota:** 60% por dia não significa 60% de pessoas a trabalhar
simultaneamente em todos os minutos. Não se promete que a referência
seja sempre viável nem que a solução seja um ótimo global. O
certificador independente continua a validar as hard constraints.
Não fazer merge antes da aceitação no Safari.


### PR89 — Exportação de diagnóstico reprodutível (22/11/2026)

Decisão: acrescentar **um único botão "Exportar diagnóstico" ao calendário**,
sem nova configuração, separador, conta, API ou base de dados.

- O botão guarda um ficheiro JSON local
  `schedule-engine-diagnostico-AAAA-MM.json`. A exportação não cria,
  recalcula, modifica, aprova nem substitui o horário; também funciona
  com uma proposta gerada ainda não guardada, com edições manuais e com
  um mês apenas configurado.
- `src/diagnosticExport.ts`: constrói um snapshot de versão 1 com a
  equipa e regras individuais, horários de funcionamento, **todos os
  turnos visíveis** (sem aplicar o filtro de colaborador), pausas,
  descanso explicitamente planeado, proposta guardada para comparação,
  rotação, resultado do algoritmo, certificação e conflitos, contexto
  das semanas de fronteira e histórico para as horas móveis de 28 dias.
  Inclui resumos por dia e por colaborador: trabalho efetivo, domingos,
  jornadas acima de 8h/9h, fins de semana livres e dias escalados.
- `src/CalendarScheduler.tsx`: obtém sempre a configuração e o contexto
  atuais do navegador. Se a configuração tiver mudado desde a geração,
  identifica essa diferença e inclui **a cópia exata dos dados usados
  originalmente** para a geração, preservada no snapshot da proposta.
  O download usa `Blob` e `a.download` sem enviar dados a serviços.
- São exportados somente campos explícitos e validados; **não são
  exportados tokens de autenticação, palavras-passe, cookies, chaves
  ou todo o `localStorage`**. O JSON **contém dados pessoais** como
  nomes e horários. A pessoa que o descarrega decide se o partilha.
  Nunca é carregado automaticamente para uma conversa.
- A estrutura indica que um dia sem turno **não é uma folga automática**,
  que as horas são de trabalho efetivo planeado e que o diagnóstico
  de colaboradores por dia **não representa presenças simultâneas**.
  Se faltarem dados de contexto, preserva-se o aviso — não se inventam
  aprovações nem se converte incerteza em horário válido.
- `tests/diagnosticExport.test.ts` e `tests/interfaceContract.test.ts`:
  cobertura de exportação sem horário guardado, coerência com turnos,
  totais por pessoa, feriados/descansos explícitos, imutabilidade,
  compatibilidade de cenários anteriores, dados de entrada originais
  quando a configuração mudou e ausência de campos sensíveis de sessão.

**Teste funcional no Safari:** atualizar a branch do PR89, gerar
novembro na configuração atual e carregar em "Exportar diagnóstico".
Abrir o ficheiro JSON, verificar que contém os colaboradores, folgas,
turnos e eventuais alertas esperados. Enviar esse JSON para a
conversa apenas se for apropriado partilhar os dados da equipa.
**Não é necessário guardar nem aprovar a proposta** para exportar.


### PR90 — Jornadas longas e presença simultânea nas pausas (22/11/2026)

**Baseline de diagnóstico real, novembro de 2026:** oito pessoas,
160h efetivas por pessoa nas quatro semanas completas, 169 turnos;
64 jornadas acima de 9h e 210 minutos de sábados com apenas um
colaborador efetivamente a trabalhar (07:105, 14:30, 21:30, 28:45).
Não confundir escala diária com presença simultânea. A certificação
global continua a aguardar os dados de outubro/dezembro.

- `src/dailyWorkloadBalance.ts` e `src/generateSchedule.ts`: no V2
  com `rolling28`, quando o **excesso total de minutos acima de
  8h e 9h é igual**, preferir menos jornadas acima de 9h. Só se
  redistribuem blocos de 15min entre dias de trabalho já existentes
  da mesma semana. Dias livres, domingos curtos, 160h de referência,
  capacidade diária e contexto externo permanecem intactos. O
  comparador legado não mudou.
- `src/simultaneousCoverage.ts` e `src/mealCoveragePlanner.ts`:
  só quando a cobertura obrigatória já está integralmente garantida,
  procurar diminuir os minutos com **exatamente uma pessoa a trabalhar**.
  Primeiro alterar pausas dentro dos mesmos turnos e depois, se
  necessário, deslocar entradas/saídas de turnos existentes sem mudar
  horas efetivas. Cada movimento tem melhoria estrita; nenhuma
  preferência de duas pessoas se torna uma regra obrigatória. A
  pesquisa é determinística e limitada para proteger a performance.
- `src/diagnosticExport.ts`: acrescenta `soloMinutes` e
  `uncoveredMinutes` a cada dia do JSON, além do resumo mensal. O
  formato permanece compatível (campos adicionais na versão 1).
  Não existe novo separador, ecrã, campo ou configuração.
- `tests/workloadPauseQuality.test.ts`: quatro sábados reais
  anonimizados, com entradas, saídas e pausas originais, teste
  end-to-end com oito pessoas e mesmas regras (sem nomes nem IDs
  reais no repositório), imutabilidade, determinismo e preservação
  da certificação. A suite de escala com 200 colaboradores continua.

**Resultado do teste anónimo reproduzível:** 64 → **56** jornadas
acima de 9h e 210 → **0 minutos** de presença solitária nos quatro
sábados; 169 turnos e 160h por pessoa mantidos, sem violação de
hard constraints nas quatro semanas completas. Este resultado é
do cenário de teste: só o novo diagnóstico do Safari confirma o
caso real, que não é atualizado automaticamente.

**Estado:** PR90 em Draft, não integrado. Reexecutar novembro no Safari
e exportar o novo JSON; comparar `analysis.quality` com o diagnóstico
anterior. Se o resultado real piorar noutra dimensão, não fazer merge.

**Validação funcional adicional com o diagnóstico real do Safari
(22/11/2026, exportado às 10:30:05 UTC):** confirmado o mesmo
resultado de **56** jornadas acima de 9h, **0 minutos** com apenas
uma pessoa em trabalho efetivo, **0 minutos** sem cobertura em
**todo o mês**, **169** turnos, oito colaboradores e **160h efetivas
por pessoa entre 2 e 29/11**. Verificação independente minuto a
minuto confirmou o mínimo de **duas** pessoas a trabalhar durante
todos os intervalos abertos, sem turnos duplicados, pausas inválidas
ou trabalho em folgas fixas. A melhoria do número de jornadas longas
ocorre especialmente em duas pessoas, com 16 → 12 jornadas acima
de 9h cada. As restantes distribuições mantiveram-se.

**Limitação preservada:** o certificador sinaliza
`insufficient_context` exclusivamente para a falta de histórico
confirmado de 26–31/10 e 1–6/12. Não declarar novembro
globalmente certificado até existirem dados das semanas vizinhas;
não converter ausência de histórico em folga ou aprovação. A
pré-visualização testada não alterou a proposta anteriormente guardada.


### PR91 — As 160 horas são distribuídas pelo ciclo, não fechadas semana a semana

**Direção de arquitetura (22/11/2026):** no modo `rolling28` com
rotação de fins de semana, melhorar o horário sobre **quatro semanas
civis completas em conjunto**. A semana continua a ser a unidade de
descanso obrigatório, mas a distribuição de horas entre essas semanas
é uma decisão de otimização do ciclo. As 160h são a referência de
planeamento (não um limite legal universal); as horas realmente
atribuídas continuam a ser validadas por um certificador independente.

- `src/cycleWorkloadOptimization.ts`: otimizador puro e determinístico
  que transfere blocos de 15min **entre jornadas existentes** de um
  mesmo colaborador em quatro semanas consecutivas. Não cria nem
  remove turnos/dias de trabalho, não modifica folgas ou domingos
  curtos inteiros, não excede a capacidade real de um dia e conserva
  o total exato de horas do ciclo. Recusa ciclos incompletos,
  duplicados ou de datas não consecutivas.
- Prioridade SOFT: reduzir o **número de jornadas acima de 9h**,
  sem aumentar o total de minutos acima de 9h nem o total acima de
  8h. Como proteção experimental contra a concentração de horas
  numa única semana, a procura mantém cada semana no intervalo
  de **36 a 44h** quando a distribuição inicial já está nesse
  intervalo. Isto é uma guarda interna da experiência, não uma nova
  opção da empresa nem uma regra obrigatória do certificador.
- A integração em `src/generateSchedule.ts` usa como controlo a
  proposta anterior. Gera também uma proposta reajustada e
  **certifica as duas independentemente**. Só apresenta a proposta
  nova se reduzir jornadas longas, sem novos conflitos e sem aumentar
  minutos de abertura descobertos ou minutos com uma só pessoa
  efetivamente a trabalhar. Caso contrário mantém-se a proposta
  anterior. As semanas que atravessam o mês ficam intocadas.
- `tests/cycleWorkloadOptimization.test.ts`: ciclo sintético
  matematicamente verificável com 160h, 4 semanas e domingo de 5h
  intacto, impossibilidade de alteração de dados incompletos e
  preservação do conjunto de dias trabalhados.
- `tests/workloadPauseQuality.test.ts`: regressão end-to-end de
  novembro com oito pessoas e configuração anonimizada do ensaio;
  certificador independente, 160h/pessoa, 169 turnos, folgas
  existentes, zero minutos com uma pessoa nos sábados e geração
  repetível.

**Resultado no cenário de teste anonimizado:** **56 → 30 jornadas**
acima de 9h (redução de 46,4% relativamente ao PR90), mantendo
as 160h efetivas por pessoa entre 02–29/11, 169 turnos e nenhuma
nova violação de hard constraints. Este resultado não prova a
otimalidade global nem substitui a **exportação real do Safari**
para validação final. Os avisos de semanas fronteiriças continuam
a exigir dados reais de 26–31/10 e 01–06/12.

**Limite de arquitetura ainda existente:** a experiência trabalha
apenas blocos de quatro semanas **inteiramente incluídos no período
editável**. Um ciclo fixo que atravessa dois meses exigirá, numa
fase seguinte, ligar o planeamento às propostas/horários aprovados
anteriores, com fronteiras conhecidas. Não se podem preencher datas
externas desconhecidas nem recalcular horários históricos para
melhorar artificialmente o ciclo.

**PR91:** manter Draft e sem merge até a suite final passar e a
proposta do Safari confirmar as métricas no cenário verdadeiro.


### PR91 — Correção da referência interna de 60% com folga fixa de sábado (22/11/2026)

**Problema reproduzido com diagnóstico real do Safari:** oito pessoas,
uma com sábado fixo sem trabalhar; a rotação permitia três pessoas
adicionais com sábado e domingo livres e deixava só quatro pessoas
no sábado em 07, 14 e 28/11. O diagnóstico marcava 3 dias abaixo
da referência SOFT de cinco pessoas. A contagem de pessoas presentes
é por dia, não simultaneidade ao minuto.

**Correção:** em `src/weekendRotation.ts`, ao testar uma nova
atribuição opcional de fim de semana completo, comparar também
o défice de pessoas de sábado e domingo da solução já admissível.
Quando há folga fixa em dia de fim de semana, recusar uma atribuição
opcional que agrave esse défice. Folgas fixas, descanso semanal
configurado e cobertura HARD mantêm prioridade. Esta é uma
heurística interna, não um mínimo legal, uma obrigação global de
60% ou uma opção configurável. Em equipas sem folga fixa ao
fim de semana, conservar o comportamento anterior.

**Regressão reproduzível:** em `tests/weekendRotation.test.ts`
e `tests/workloadPauseQuality.test.ts`, cenário anonimizado de
novembro com oito colaboradores, regimes mistos, sábado fixo e
quatro semanas completas. Depois da correção, todos os quatro
sábados têm cinco pessoas escaladas e domingos 5/5/6/6.
Mantêm-se 160h efetivas por pessoa em 02–29/11, jornadas
>9h: 30 → 20, zero minutos sem cobertura e zero minutos
com apenas uma pessoa a trabalhar nos sábados. O total mensal
passa de 169 para 172 turnos porque são alterados dias escalados,
sem alterar folgas fixas nem transformar ausências de turno em
folgas oficiais. A reprodução é sintética e anonimizada, não
substitui a validação real no Safari.

**CI:** 315/315 testes e build PASS, GitHub Actions
https://github.com/gv62hfjc8c-dot/schedule-engine/actions/runs/45016408292 .
Na primeira tentativa, uma aplicação excessivamente geral
originou regressões em equipas pequenas. Foi corrigida antes
desta validação, restringindo a guarda adicional a cenários
com folgas fixas ao fim de semana.

**Pendente:** confirmar novamente novembro no Safari e exportar
diagnóstico com `settingsMatchGeneratedPreview=true`. Verificar
as oito datas de fim de semana, 160h por pessoa, jornadas >9h,
cobertura e `CONTEXT_INCOMPLETE` nas fronteiras sem histórico.
PR91 continua Draft; não integrar sem aceite funcional.
