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

A distribuição das horas de trabalho e dos dias atribuídos, bem como as **40 horas semanais obrigatórias**, são exatamente as mesmas do PR81. A estabilidade do turno é uma **preferência SOFT**: dias com funcionamento ou durações de trabalho diferentes podem exigir horários diferentes, e nesse caso a validade tem prioridade. Não há cobertura mínima, alteração às folgas, regras adicionais de descanso, Supabase ou persistência.

### Como validar

Os testes com **2 colaboradores** exigem que ambos mantenham a mesma entrada e saída em cada um dos cinco dias da semana e **troquem de turno na semana seguinte**. Foram acrescentados testes para fronteira novembro/dezembro com dados de novembro apenas em leitura, garantindo que o turno de 30/11 se mantém em 01/12–04/12, sem escrever em novembro. Mantêm-se os testes de 2, 10, 50 e 200 pessoas, determinismo, funcionamento repartido, mês de 31 dias e certificador independente.

**Trade-off mensurável:** com cinco posições de meia em meia hora entre 09:00 e 11:00, o período de 28 dias tem apenas quatro semanas. Mantendo o turno fixo dentro de cada semana, a diferença entre médias individuais de início pode chegar a **30 minutos** em quatro semanas, em vez de 0 minutos na versão que alternava todos os dias. Isto não implica favorecimento permanente: um ciclo de **cinco semanas** permite que cada pessoa percorra as cinco posições. Os limites de desempenho e equidade dependem do cenário e não substituem regras de equidade de longo prazo ainda por definir.

Executar `npm test`, `npm run test:distribution`, `npm run build`. Validar no Safari a geração de duas semanas consecutivas com dois colaboradores 09h–19h, sem substituir propostas antigas até estar satisfeito com o resultado.

### PR82 — Distribuição semanal pelos dias reais de funcionamento (extensão)

Depois de confirmar a rotação estável dos horários de entrada entre semanas, o utilizador identificou outro limite: a alocação das **40h semanais** era feita sempre por ordem de dia civil, até 8h/dia, pelo que ignorava qualquer dia aberto depois de as primeiras cinco jornadas terem consumido as 40h. A clarificação é **geral**: todos os dias/intervalos de funcionamento da empresa devem ser candidatos, sejam quais forem os seus nomes, ordens, aberturas ou durações; sábado não tem qualquer tratamento especial. **Ainda não decidir/implementar alternância de colaboradores por dias.**

O gerador passa a otimizar em conjunto as durações de trabalho da semana em todos os dias abertos e editáveis, quando o contexto semanal exterior é completo. A função `allocateBalancedWeek` procura: (1) utilizar os dias viáveis abertos, sem considerar a presença como nova hard constraint de cobertura; (2) manter durações iguais nos dias com a mesma capacidade de funcionamento (estabilidade de turnos); (3) evitar turnos residuais muito curtos; e (4) não exceder a capacidade temporal nem as 40h semanais obrigatórias. A seleção automática dos horários de entrada continua a preferir horas e meias horas e mantém o mesmo início ao longo de uma semana sempre que as capacidades/durações o permitem. Em semanas que atravessam meses e não têm contexto de todos os dias, conserva-se o comportamento conservador e o certificador devolve `insufficient_context`, sem inventar turnos nos meses adjacentes.

**Caso concreto verificado:** segunda a sexta 09:00–19:00, sábado 09:00–13:00 e domingo encerrado, duas pessoas de 40h. O motor consegue alocar a cada pessoa **5 × 7h30 + 1 × 2h30 = 40h**, com turno estável de segunda a sexta e uma presença de 2h30 no dia de funcionamento mais curto. A escolha da hora exata de início varia com a posição automática do colaborador, dentro do período de abertura; **não é uma cobertura obrigatória de 09:00–13:00** nem uma atribuição fixa a sábado.

Também foram testados sete dias de funcionamento, com durações diferentes e períodos interrompidos, o caso de 36h totais de abertura (certificação correta como inválido por faltarem 4h), continuação de uma semana de novembro para dezembro sem modificar novembro, e equipas de 2, 10, 50 e 200 pessoas no cenário 6 dias abertos. Não foi alterada a interface, o modelo de dados, as folgas, a seleção de pessoas por dia, a persistência, o Supabase nem a regra hard de 40h por semana. **A distribuição pelos dias e as entradas alinhadas continuam preferências soft, sem cobertura mínima.**
