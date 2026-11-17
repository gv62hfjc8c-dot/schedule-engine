# Schedule Engine — V2: base visual do produto

A V2 é uma reconstrução independente do código V0/V1. A identidade visual da aplicação foi mantida, mas as páginas estão a ser desenvolvidas como ecrãs de produto final, sem etiquetas de protótipo, desenvolvimento ou demonstração.

## Rotas

- `/` — página de acesso com formulário de início de sessão e identidade visual em dois painéis.
- `/horarios` — calendário mensal com navegação e seleção de datas. O calendário ainda não tem dados operacionais.
- `/configuracao` — consulta de dados guardados da organização.
- `/configuracao/inicial` — nome da empresa com validação e gravação local.
- `/configuracao/funcionamento` — dias e horários semanais de funcionamento com validação e gravação local.
- `/configuracao/equipa` — adicionar e editar colaboradores, com estado ativo/inativo.
- `/horarios/gerar` — rota da versão anterior: regressa à página inicial.

## Regra obrigatória de UI

Qualquer conteúdo visível deve fazer sentido para o utilizador final. Mensagens sobre versões, branches, testes, demos, PRs ou funcionalidades futuras pertencem apenas à documentação técnica, nunca ao produto.

O layout tem de se adaptar a desktop, tablet e smartphone, incluindo ecrãs com largura de 320px. O design preserva o estilo azul-escuro e teal, navegação acessível, foco visível e redução de animações quando o sistema pede.

## Estado funcional real

O formulário de acesso **ainda não tem provedor de autenticação**. Submeter o formulário não grava, envia ou autentica credenciais e apenas apresenta uma indisponibilidade de sessão. Não se simula autenticação. A navegação direta para `/horarios` está aberta apenas enquanto não existe backend nem dados privados.

Não existem ainda motor de scheduling, regras, turnos, aprovações, Supabase nem persistência em servidor. Os dados de empresa, funcionamento e equipa podem ser guardados apenas neste dispositivo. Os ecrãs não devem inventar resultados. Um dia sem turno nunca é automaticamente marcado como folga.

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
