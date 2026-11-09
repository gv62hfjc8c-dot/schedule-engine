# PR #47 — Protocolo de aceitação e testes reproduzíveis

**Estado em 09/11/2026:** CI e aceitação Safari S1/S2/S3 executadas e aprovadas. **O PR #47 permanece sem merge** até decisão expressa, segundo as exceções de âmbito e risco registadas em `docs/decisions/pr47-scope-and-residual-risks-2026-11-09.md`.

Branch: `audit/pr47-consistency-hardening`  
Versão de recuperação: `safety/pr46-baseline` (PR #46)  
Registo de anomalias: [matriz da auditoria](audit-pr47.md)

## 0. Proteção dos dados

- **Leitura de horários reais:** permitida na conta habitual, sem editar.
- **Edição de pessoas, regras, datas, disponibilidade e geração:** realizar
  numa conta de ensaio com equipa fictícia. Cada horário criado é uma proposta
  imutável guardada no Supabase; Git não reverte esses dados.
- **RLS entre duas contas:** executar primeiro os testes gratuitos de PostgreSQL
  do GitHub Actions com duas identidades sintéticas. Esta prova de políticas
  não substitui o ensaio com dois utilizadores reais via Supabase Auth.
  Não usar dados ou passwords de produção para os ensaios de autenticação.
- **Erros de arquivo, sessão expirada e respostas perdidas:** verificar
  com as suites automatizadas e, quando aplicável, falha de rede no Safari.
  Não criar intencionalmente registos corrompidos na base operacional.
- Não executar `supabase db push`, DDL, limpeza de dados, alterações Auth
  ou deploy de Edge Functions durante esta aceitação.
- Guardar evidência sem nomes pessoais, JWT, passwords ou chaves.

### Preparação no Mac

Primeiro confirmar que não existem alterações locais que se possam perder:

```bash
cd /caminho/para/schedule-engine
git status --short
git fetch origin
git switch audit/pr47-consistency-hardening
git pull --ff-only
git rev-parse --short HEAD
node --version
npm ci
npm run audit:dependencies
npm test
npm run typecheck
npm run build
npm run dev
```

Se a branch ainda não existir localmente, substituir o comando
`git switch` por:

```bash
git switch -c audit/pr47-consistency-hardening --track origin/audit/pr47-consistency-hardening
```

Usar **Node.js 22** e abrir no Safari o endereço indicado pelo Vite,
habitualmente `http://localhost:5173/`. Se `git status --short`
não estiver vazio, preservar primeiro essas alterações. O teste deve
ocorrer sempre na **SHA exata** registada antes do início da sessão.

## Checklist canónica de aceitação dos 23 pontos

**Estado após automação documentada (09/11/2026): 16 PASS (incluindo testes automatizados WebKit/CI), 0 PARCIAL, 7 POR TESTAR.** O ambiente WebKit do CI não substitui uma sessão nativa Safari/macOS; ver evidências e ressalvas da [checklist canónica](pr47-checklist-23-results.md). Não usar «Implementado» como substituto de PASS nem declarar encerrada uma verificação Safari apenas porque a CI passou. A matriz canónica e as provas estão em [docs/pr47-checklist-23-results.md](pr47-checklist-23-results.md). A classificação por comportamento pedido prevalece sobre a matriz de implementação e as antigas afirmações genéricas de «23 pontos tratados».

## Registo de resultados

Para cada teste escrever **PASS / FAIL / BLOCKED / N/A**, SHA, observação
e evidência mínima. Não usar PASS para testes não executados.

- **P0:** perda/corrupção de dados, leitura cruzada entre contas,
  proposta inválida divulgada como válida ou aprovada. Bloqueia merge.
- **P1:** violação de hard constraint, persistência, recuperabilidade,
  geração ou navegação essencial. Bloqueia merge.
- **P2:** inconsistência de UX, erro recuperável ou funcionalidade
  incompleta. Corrigir ou aceitar expressamente antes do merge.
- **P3:** texto/aspeto sem impacto operacional.

## Bloco A — regressão da experiência aprovada (Safari, só leitura)

| ID | Procedimento | Resultado esperado | Estado |
|---|---|---|---|
| A01 | Iniciar sessão no Safari, sair e voltar a entrar | Conta correta; configuração e arquivo carregados | PENDENTE |
| A02 | Abrir calendário mensal; navegar mês anterior, seguinte e «Hoje» | Datas corretas e navegação previsível | PENDENTE |
| A03 | Selecionar data com proposta guardada | Painel lateral de resumo, **sem lista de colaboradores** | PENDENTE |
| A04 | «Gerir horário deste dia» | Abre ecrã completo de equipa, pesquisa, filtros e paginação | PENDENTE |
| A05 | Selecionar pessoas e trocar filtros, pesquisas e páginas | Seleção global preservada, resumo correto | PENDENTE |
| A06 | Consultar horário completo arquivado | Turnos, refeições e equipa do snapshot original, sem regeneração | PENDENTE |
| A07 | Consultar data sem proposta | «Por planear» ou «Sem turno»; nunca inferir «Folga» | PENDENTE |
| A08 | Reabrir Safari após terminar a sessão | Proposta guardada continua disponível sem a recriar | PENDENTE |

## Bloco B — configuração de teste que antes não era editável

Usar uma **conta fictícia**. Esta edição de múltiplos intervalos foi
implementada especificamente para tornar o teste reproduzível **pela UI**.

| ID | Procedimento | Resultado esperado | Estado |
|---|---|---|---|
| B01 | Em **Operação → Calendário operacional**, abrir «Gerir períodos» de uma segunda-feira 09:00–18:00. Reduzir fim para 12:00; adicionar período; aumentar fim do novo período para 18:00; mover o início novo para 14:00 | Dois períodos **09:00–12:00 e 14:00–18:00**, persistidos após refresh | PENDENTE |
| B02 | Tentar alterar primeiro período para terminar 14:15 enquanto o segundo começa às 14:00 | Aviso de sobreposição; ambos os períodos originais permanecem | PENDENTE |
| B03 | Em **Operação → Exceções**, criar data fictícia e editar «Gerir períodos» para dois períodos | Funcionamento excecional conserva ambos os períodos após refresh | PENDENTE |
| B04 | Em **Equipa → Disponibilidade**, escolher pessoa fictícia, ativar segunda-feira e editar «Gerir períodos» para manhã e tarde | Disponibilidade com dois períodos dentro do funcionamento; sem perda do primeiro | PENDENTE |
| B05 | Tentar inserir disponibilidade que atravesse 12:00–14:00 (operação fechada) | Edição recusada com aviso; não substitui períodos válidos | PENDENTE |
| B06 | Em **Disponibilidade → Exceções**, escolher data com operação aberta e definir dois intervalos | Exceção conserva os dois períodos após refresh | PENDENTE |
| B07 | Em operação, disponibilidade e presença, tentar duplicar a data de uma exceção já existente | Duplicado rejeitado sem substituir dados anteriores | PENDENTE |
| B08 | Remover o segundo período em qualquer editor | O primeiro permanece; remover o último representa dia fechado/indisponível | PENDENTE |
| B09 | Em **Regras → Carga contratual e objetivos**, definir 20h máximo e 15h objetivo para uma pessoa | Dados persistem; máximo é hard, objetivo é soft | PENDENTE |
| B10 | Na mesma secção, adicionar data obrigatória explícita e removê-la | Data visível, persistente, sem duplicação | PENDENTE |
| B11 | Em **Operação**, aplicar fuso IANA inválido e depois `Europe/Lisbon` | Inválido recusado; válido persiste e surge no gerador | PENDENTE |
| B12 | Configurar âncora `2026-11-02`; consultar 29/11 e 30/11 | Dia 29 é semana 4/4; dia 30 inicia novo ciclo de 28 dias | PENDENTE |

**Localização verificada do editor contratual:** está **no final da área
«Regras»**, em «Carga contratual e objetivos». Este editor já existia
na branch; não foi necessário inventar um ecrã adicional.

**Pré-condição de B04:** depois de alterar o funcionamento, pode existir
disponibilidade antiga 09:00–18:00 que atravessa o novo intervalo fechado.
No editor de ensaio, remover/ajustar esse período legado antes de
adicionar manhã e tarde. Não editar a disponibilidade real.

## Bloco C — geração e certificação (Safari, conta fictícia)

Usar datas de ensaio sem turnos exteriores. **Só confirmar ausência
de turnos exteriores se a afirmação for verdadeira.** Os casos seguintes
necessitam de uma pessoa disponível, cobertura por fase configurada
e regras consistentes.

| ID | Procedimento | Resultado esperado | Estado |
|---|---|---|---|
| C01 | Escolher período, não assinalar a confirmação de contexto exterior | Gerador não publica proposta | PENDENTE |
| C02 | Dia 14:00–19:00 (5h) com jornada integral curta até 5h | Se gerado, turno cobre 5h sem refeição obrigatória | PENDENTE |
| C03 | Dia 09:00–16:00 (7h), jornada curta até 7h, cobertura 1/0/1 | Se gerado, 7h presença, 1h refeição, 6h efetivas | PENDENTE |
| C04 | Dia 09:00–18:00 (9h), jornada curta até 9h, cobertura 1/0/1 | Se gerado, 9h presença, 1h refeição, 8h efetivas | PENDENTE |
| C05 | Cobertura superior à equipa disponível | Nunca guardar uma proposta inválida; diagnóstico explícito | PENDENTE |
| C06 | Tentar gerar 15 dias, depois 28, depois 29 dias consecutivos | O motor aceita até 28; geração válida com 28 é arquivada e restaurada; 29 é rejeitado sem criar proposta | PENDENTE |
| C07 | Depois de gerar, mudar datas/regras e tentar usar pré-visualização anterior | Resultado antigo invalida-se, confirmação renovada | PENDENTE |
| C08 | Contrato de 20h com objetivo de 15h, num período de uma semana | Indicadores de trabalho efetivo e objetivos coerentes; hard cap nunca excedido | PENDENTE |
| C09 | Marcar dia obrigatório dentro do período, com disponibilidade e operação | Geração satisfaz obrigação ou informa impossibilidade, sem falso sucesso | PENDENTE |
| C10 | Marcar dia obrigatório **fora** do período, mas no contexto exterior declarado vazio | Contradição rejeitada pela validação independente | PENDENTE |

**Não confundir:** «search_limit» não prova inviabilidade. A aprovação
de C02–C04 exige um resultado realmente gerado e validado; se o cenário
não encontrar solução devido a outras regras, investigar a configuração
e registar BLOCKED/FAIL, não PASS automático.

## Bloco D — arquivo e resiliência (Safari, conta fictícia)

| ID | Procedimento | Resultado esperado | Estado |
|---|---|---|---|
| D01 | Gerar uma proposta válida; aguardar confirmação de gravação; recarregar | Proposta aparece sem regenerar; continua **não aprovada** | PENDENTE |
| D02 | Gerar outra proposta para datas sobrepostas | Histórico conserva versões, panorama avisa sobreposição | PENDENTE |
| D03 | No painel do dia, escolher versão antiga e fixá-la | Dias fora dessa proposta não importam dados de outra versão | PENDENTE |
| D04 | «Voltar ao panorama de propostas» | Recupera visão por dia, com aviso de que não é escala conjunta certificada | PENDENTE |
| D05 | Consultar mês civil com 5 semanas e ciclo de 28 dias | Ciclo é referência contabilística, não uma proposta automática de 28 dias | PENDENTE |
| D06 | Desligar temporariamente a ligação à Internet **depois** de o Vite estar iniciado em localhost; recarregar o arquivo; repor rede | Erro de consulta visível, sem falsos «por planear»; «Tentar novamente» recupera | PENDENTE |
| D07 | Criar duas edições sucessivas na configuração fictícia e recarregar | Última alteração permanece; sem conflito silencioso de revisão | PENDENTE |
| D08 | Com gravação pendente, tentar fechar/navegar e depois voltar | Aviso de saída quando aplicável; não afirmar persistência sem confirmação | PENDENTE |

**Não corromper manualmente o Supabase operacional.** Corrupção de
snapshots, respostas perdidas depois do commit e inserção concorrente
são cobertas por `npm run test:archive-consistency` e
`npm run test:generated-schedules`, com repositórios simulados e
assertivas automáticas. Isso testa o comportamento de erro sem
alterar registos reais.

## Bloco E — RLS gratuito em CI e ensaio Auth real ainda pendente

A CI já executa, sem criar projeto Supabase pago, um PostgreSQL 17 descartável:
reconstitui as migrações, configura duas identidades fictícias e verifica
leitura/escrita isolada de estados, históricos, propostas e ledgers oficiais.
Esse ensaio não envolve GoTrue, JWT assinado ou o Data API verdadeiro.

Existe ainda um verificador **read-only** que autentica duas contas reais
num ambiente de ensaio e verifica isolamento bidirecional sobre as três
tabelas do fluxo ativo. O ensaio real permanece pendente; não o confundir
com as simulações gratuitas de CI.

1. Preferir um ambiente Supabase isolado. **Alternativa sem custos
   adicionais neste projeto:** como os dados atuais foram declarados
   exclusivamente de teste pelo proprietário, podem utilizar-se duas contas
   descartáveis **distintas da conta habitual** no projeto atual. A suite
   de RLS só faz consultas, nunca altera dados. Não utilizar esta alternativa
   se já existirem dados reais ou compromissos operacionais.
2. Criar duas contas de teste e, através da própria UI, guardar uma
   configuração e **pelo menos uma proposta** em cada conta.
3. Criar um ficheiro **local ignorado pelo Git**
   `.env.rls-test.local` (nunca enviar as credenciais para o chat):

   ```env
   RLS_TEST_CONFIRM=EXISTING_TEST_PROJECT
   RLS_TEST_SUPABASE_URL=https://SEU_PROJETO_DE_TESTE.supabase.co
   RLS_TEST_PUBLISHABLE_KEY=sb_publishable_SUA_CHAVE_PUBLICA
   RLS_TEST_EMAIL_A=conta-a@example.test
   RLS_TEST_PASSWORD_A=PASSWORD_DA_CONTA_A
   RLS_TEST_EMAIL_B=conta-b@example.test
   RLS_TEST_PASSWORD_B=PASSWORD_DA_CONTA_B
   ```

4. Executar localmente, com Node 22:

   ```bash
   npm run test:rls-isolation
   ```

   O script utiliza `node --env-file=.env.rls-test.local`, **nunca
   altera dados**, e não imprime senhas nem tokens. Numa instância de
   staging separada utilizar `RLS_TEST_CONFIRM=STAGING_ONLY`.

5. Critério: `PASS` nas tabelas `schedule_engine_states`,
   `schedule_engine_state_history` e
   `schedule_engine_generated_schedules`; se faltar dado próprio numa
   conta, devolve `BLOCKED` e não certifica isolamento. Os ledgers
   oficiais antigos não pertencem ao fluxo ativo e são revistos através
   de grants/policies read-only no Checkpoint D.

**Não usar service_role ou chave secret**, pois essas credenciais
poderiam contornar as políticas que se pretende testar.

## Bloco F — integridade automática e encerramento

| ID | Comando | Critério | Estado |
|---|---|---|---|
| F01 | `npm run test:interval-editing` | Multi-intervalos, limites e preservação de dados aprovados | PENDENTE |
| F02 | `npm run test:scheduling-model` | Contratos, dias obrigatórios, fuso, ciclos | PENDENTE |
| F03 | `npm run test:final-matrix` | Geração determinística e certificação independente | PENDENTE |
| F04 | `npm run test:archive-consistency` | Falhas, sobreposições, versões imutáveis e paginação | PENDENTE |
| F05 | `npm run test:supabase-persistence` + `npm run test:supabase-auth` | Revisão concorrente e sessões protegidas | PENDENTE |
| F06 | `npm run test:supabase-security-contract` | Contratos de RLS/grants previstos e rollback | PENDENTE |
| F07 | `npm run audit:dependencies`, `npm run typecheck`, `npm run build` | Sem avisos npm moderados ou superiores; sem erros de tipos/build | PENDENTE |
| F08 | `npm run test:rls-isolation` (staging) | Isolamento real em duas contas com dados próprios | PENDENTE |

## Matriz de rastreabilidade — os 23 pontos originais

Esta tabela liga **cada ponto** de `docs/audit-pr47.md` a evidência
reproduzível ou a uma pendência explícita. Não confundir `IMPLEMENTADO`
com `TESTADO`: o estado da implementação não é um resultado de aceitação.
Os códigos A–F acima continuam **PENDENTES** até serem executados.

| Ponto | Situação da implementação | Verificação concreta / limite |
|---|---|---|
| 01 Documentação | Implementado | Comparar README, arquitetura, roadmap, setup e relatório com funcionalidades visíveis; nenhuma funcionalidade experimental declarada operacional |
| 02 Sem turno ≠ folga | Implementado | A07 e D06; nunca interpretar ausência de turno como folga |
| 03 Edge Function antiga | **Fonte publicada e contrato 410 provados; sem tráfego autenticado observado** | Código real da v6 devolve sempre 410, sem operações na base de dados; gateway JWT obrigatório. Logs reais das 24h analisadas (08/11 11:00Z a 09/11 11:00Z) registaram apenas GET/POST 401 sem autenticação válida (22 de cada). Não há evidência de consumidor autenticado no intervalo; não se pode provar que não existam consumidores fora dele |
| 04 Consentimento na importação | Implementado e reforçado para múltiplas contas | **G01**: conta nova escolhe começar vazia, sem importar dados legados do browser; a decisão é por proprietário, não apaga dados antigos, não afeta outra conta, e requer teste Safari |
| 05 Migrações divergentes | **10/10 versões alinhadas, migração de concorrência adicional testada** | Quatro históricas, seis PR47; PostgreSQL 17 reconstituído em CI, todas as versões também no Supabase, incluindo `20261108234026` |
| 06 Propostas misturadas | Implementado | D02–D04 e F04; vista de uma proposta não importa turnos de outras |
| 07 Alvo 40h vs contrato | Implementado (opcional) | B09, C08, F02 e F03; hard cap individual e alvo soft |
| 08 Certificação independente | Implementado | C02–C05 e F03; nenhuma solução com hard constraints violadas é publicada |
| 09 Jornada curta e refeição | Implementado | C02–C04 e testes de jornadas curtas; distinguir presença de horas efetivas |
| 10 Disponibilidade ≠ obrigação | Implementado | B10, C09, C10 e F02; datas obrigatórias sem disponibilidade são rejeitadas |
| 11 Períodos adicionais invisíveis | Implementado | B01–B06, B08 e F01; todos os intervalos podem ser editados sem substituição silenciosa |
| 12 Exceções duplicadas | Implementado | B07; duplicados são rejeitados e dados anteriores preservados |
| 13 Snapshots inválidos | Reforçado | D06 e F04; registo incompatível não é apresentado como válido. **Não corromper dados reais** |
| 14 Fecho durante gravação | **Mitigado** | D08 e F04; retries com UUID estável. Fecho forçado do navegador não oferece garantia de entrega |
| 15 Fusos divergentes | Implementado | B11, F02 e F03; fuso IANA da operação e do snapshot arquivado |
| 16 Escrita concorrente | **CAS e aviso entre abas aceites no Safari — PASS** | Ensaio transacional real, regressão de duas edições concorrentes do mesmo nome, aviso `storage` por titular, preservação de dados e reteste S3 confirmado em 09/11/2026 |
| 17 Aprovação oficial ausente | **API e revisões testadas de ponta a ponta com história sintética verificada; histórico real externo condicionado** | API v3 publicada com JWT obrigatório; teste de handler compilado executa readiness positiva, aprovação, replay 409, revisão parcial por ausência, cancelamento e histórico imutável com contexto sintético verificado, sem escrita na base real. Os horários anteriores de 2026 ainda não foram fornecidos/importados |
| 18 Ciclos de 28 dias | **Núcleo/DB/UI e Safari aceites — PASS** | Quatro semanas certificadas com DST/ano bissexto/mudança de ano. O utilizador confirmou a geração e recuperação do período de 02–29/11/2026 em 09/11/2026 |
| 19 Perfis de colaboradores | **V0 implementado; ocorrências oficiais dependem de #17** | `test:scheduling-model` valida `unavailableWorkDates` sem turno, incluindo rejeição da certificação. `test:qualification-coverage` valida competências durante turnos e refeições; UI edita datas indisponíveis e etiquetas. Motivos administrativos e tipos de vínculo não especificados |
| 20 Segurança Supabase | **RPC reforçado; 1 aviso Auth pendente** | Migração `20261108124844` aplicada e funções/permissões verificadas; verificar operações reais de gravação no Safari. Proteção de passwords comprometidas continua desligada, disponível em Supabase Pro+ |
| 21 Código experimental | Implementado | `npm run test:architecture`; verificar ausência de laboratório na UI e preservação dos testes do domínio |
| 22 Terminologia desatualizada | Implementado | A03, A06, D01 e revisão textual: «proposta guardada, não aprovada» |
| 23 Cobertura de regressões | **CI/SQL real/Safari completos para casos V0; HTTP real com dois JWTs por comprovar** | Testes S1, S2 e S3 confirmados em Safari; consulta read-only ao Supabase confirmou proposta B de 28 dias; `officialEdgeVerifiedRoundtripTest` passou com duas identidades simuladas, 404 cruzado, aprovação, revisão e cancelamento. RLS SQL real entre duas contas, gateway HTTPS sem JWT e Deno strict aprovados. Não foi usado JWT real de outro titular nos testes automatizados |

### Testes complementares necessários para fechar a rastreabilidade

**G01 — Importação inicial e identidade (conta descartável):**
num navegador/perfil de ensaio com dados locais históricos controlados,
entrar numa conta nova sem configuração remota. A aplicação deve pedir
consentimento explícito antes de importar. Repetir com conta já
configurada na cloud e confirmar que o estado remoto prevalece.
Executar a partir do estado de browser apropriado, **sem apagar a
configuração operacional**. Resultado: **PENDENTE**.

**G02 — Conflito entre duas abas (conta descartável):** abrir duas abas
da mesma conta, modificar a mesma configuração em ambas com revisões
concorrentes, observar conflito explícito e possibilidade de recuperar
o estado mais recente. Não aceitar overwrite silencioso. Resultado:
**PENDENTE**. A fila local cobre apenas alterações da mesma aba.

**G03 — Avisos externos Supabase (apenas leitura):** voltar a executar
os Security Advisors e as 10 verificações SQL de `supabase/audit/`.
Confirmar o estado do RPC privilegiado e da proteção contra
palavras-passe comprometidas no painel Auth. **Não alterar a
configuração de produção nesta aceitação.** Enquanto os dois avisos
continuarem presentes, registar **PENDENTE**, mesmo que os 10
invariantes SQL sejam PASS. Resultado: **PENDENTE**.

**Critério de honestidade:** todos os 23 pontos estão rastreados, mas os
itens **03, 05, 17, 18, 19 e 20 não podem ser classificados como
«totalmente resolvidos» com o produto e as decisões atuais**; os
itens **14, 16 e 23** têm mitigação/cobertura crescente mas continuam
a exigir validação ou têm limites explícitos. Não transformar estes
estados em PASS apenas porque o CI passou.

### Gate de merge

O PR #47 só sai de draft após: zero P0/P1, casos manuais críticos
A–D aprovados, regressões F01–F07 verdes na SHA final, resultado
F08 registado, matriz das 23 observações reconciliada e confirmação
explícita do utilizador. Uma pendência externa do Checkpoint D
continuará descrita como pendência, não como «resolvida».

O procedimento protege a `main` e o rollback PR #46. Não integrar
uma alteração parcial sem repetir os testes afetados.


## Alternativa sem custos adicionais — PR47

- O ambiente efémero de PostgreSQL 17 no GitHub Actions `migration-contract` substitui a branch paga para ensaios de esquema, constraints, políticas RLS com identidades sintéticas e RPC atómica com rollback.
- A execução da CI no commit `8aa66b9` foi aprovada (workflow `42479688865`), incluindo os jobs `validate` e `migration-contract`.
- O teste de isolamento entre duas contas sintéticas foi expandido depois dessa execução, em `scripts/ci/postgres_migration_assertions.sql`; confirmar a respetiva CI antes de marcar PASS.
- A simulação não demonstra isolamento de duas contas reais do Supabase Auth. Essa verificação e os ajustes de Auth Dashboard continuam pendentes e não autorizam utilizar a base operacional como staging.
- Não é necessário comprar uma branch Supabase. A aplicação só deve ativar geração de 28 dias após compatibilidade SQL confirmada na instância alvo e validação funcional.


## Instância Supabase PR47 — correções publicadas

- `20261108124759_pr47_four_week_proposals.sql`: aplicado e confirmado via `pg_constraint`. A tabela mantém as quatro propostas existentes.
- `20261108124844_pr47_state_rpc_private_schema.sql`: aplicado; função pública `SECURITY INVOKER` e escrita privada com CAS. Auditor Supabase deixou de reportar execução privilegiada da RPC pública.
- A funcionalidade **Leaked Password Protection** depende de Supabase Pro ou superior; não foi simulada por validação JavaScript do frontend, porque isso não protegeria o endpoint Auth.
- A migração e o SQL do Git foram alinhados às versões instaladas. Antes de ensaios reais com dados no browser: atualizar a branch PR47, executar CI e consultar a configuração recuperada sem editar.
- A nova interface PR47 aceita 28 dias; outros deployments devem aplicar migrações antes de publicar a UI.


## Bloco H — aprovação oficial e história anual (PR47-17)

**Sem dados históricos importados, o resultado esperado é BLOQUEADO, nunca APROVADO.** O serviço v3 está publicado; o teste HTTP real sem JWT já passou e a aprovação de um calendário real continua bloqueada até existir prova de histórico.

| ID | Procedimento | Critério | Estado |
|---|---|---|---|
| H01 | HTTP sem JWT e sessão anónima para v2 | Resposta 401, zero operações | Sem JWT: **PASS em HTTPS real**; sessão anónima autenticada: PASS simulado, remoto pendente |
| H02 | Conta A tenta aprovar proposta de B | 404/422, sem acesso nem escrita cruzada | **PASS no endpoint compilado com duas identidades simuladas; SQL RLS real confirma separação A/B.** HTTP com JWT reais distintos ainda não executado |
| H03 | Conta sem histórico de 2026 tenta aprovar | 409 por histórico incompleto, ledger continua vazio | **PASS no endpoint compilado e em SQL real:** nenhum ledger oficial foi criado; cenário real do utilizador continua bloqueado |
| H04 | Ficheiro histórico incompleto, um colaborador sem dias confirmados | Recusa; jamais presumir folga | PASS no CI de domínio; ensaio importador PENDENTE |
| H05 | Proposta guardada, ausência de histórico verificado | UI consulta prontidão ao servidor; sem `ready=true` não apresenta aprovação | **PASS — S1 confirmado pelo utilizador em 09/11/2026** |
| H06 | Histórico simulado completo e proposta com restrições válidas | Teste de aplicação guarda apenas com CAS, falhas não publicam sucesso | **PASS ponta a ponta:** código Edge compilado aprovou proposta sintética verificada, obteve `alreadyApproved=true` e recusou replay 409; RPC CAS real de ledger/revisão testada com ROLLBACK no Supabase |
| H07 | Revisão parcial: baixa, férias ou saída depois de aprovar | Versão antiga preservada; novo turno certificado; tentativa retroativa recusada | **PASS ponta a ponta em dados sintéticos:** `POST revise` substituiu A por B, manteve versão anterior como `superseded`, `POST cancel` preservou o histórico. Cenário retroativo recusado na suite de domínio; teste com horários reais depende da importação histórica |
| H08 | Importar horários antigos e rever totais de 28 dias e histórico anual | Identidade estável, sem dupla contagem, revisão de conflitos, proveniência | **Infraestrutura e testes sintéticos PASS** (SQL provenance/RLS/bootstrap exige pessoa-dia explicitamente verificado). **Importação de horários reais PENDENTE de decisão e ficheiros do utilizador**, não pode ser inventada |

Provas técnicas atuais: `test:official-revisions`, `test:verified-official-service`, `test:official-edge-bundle`, `test:history-context`, mais `scripts/ci/postgres_history_assertions.sql` e `scripts/ci/postgres_approval_revision_assertions.sql`. Estes testes não autorizam ativar a flag de aprovação nem efetuar merge sem evidência dos ensaios H01–H08 pertinentes.


## PR47 — Contas de ensaio e dados legados do mesmo navegador

- O Safari pode manter dados legados não associados a uma identidade; um utilizador novo não deve ser obrigado a reclamá-los. A opção **Começar esta conta vazia — não importar dados antigos** grava apenas uma decisão local associada ao identificador autenticado da conta, sem alterar a configuração existente nem importar dados de outra pessoa.
- Se a conta nova já tiver estado remoto, esse estado continua a prevalecer. Se não tiver, a nova conta começa vazia e poderá gravar os próprios dados com a primeira edição.
- `src/supabaseStateRepositoryTest.ts` confirma que o skip é isolado entre dois titulares e não escreve automaticamente na base de dados. **Safari confirmado em 08/11/2026**: uma conta nova abriu sem importar dados locais; colaborador fictício A1 persistiu após recarregar; na segunda conta, A1 estava ausente e B1 persistiu após recarregar. **Leitura SQL real**: 1 titular apenas com A1, 1 apenas com B1, 0 titulares com ambos, 3 contas com configuração. **Verificação inversa no Safari confirmada:** conta A mostra A1 e não mostra B1 após recarregar. Falta teste cruzado real usando JWTs distintos sobre a mesma API e uma proposta guardada por conta.
- **Nunca carregar no botão de importação dos dados antigos para uma conta de ensaio** quando o conteúdo pertence à conta habitual.


### Ensaio Safari — 08/11/2026, conta fictícia A, 02/11/2026

- A consulta read-only ao Supabase confirmou exatamente **um colaborador ativo** (A1), disponível à segunda das 09:00–18:00; a operação de segunda funciona **09:00–17:00**, e exige **1 pessoa em abertura, operação e fecho**. Regra de refeição: 60 minutos se o trabalho efetivo ultrapassar 6 horas.
- A simulação devolveu `not_found` sem solução e sem publicar horário. A ausência de sobreposição durante a refeição torna impossível cobrir 8 horas de operação com apenas uma pessoa; **é um cenário realmente incompatível com as hard constraints**, não prova de erro do algoritmo.
- A consulta SQL read-only confirmou **0 propostas guardadas na conta A**, incluindo para 02/11/2026.
- Próximo teste: reduzir apenas o horário operacional de segunda da **conta A de teste** para **09:00–13:00**, manter A1 disponível, gerar 02/11/2026 e verificar arquivo e recuperação. Não alterar configurações da conta principal.

### Ensaio Safari — 08/11/2026, conta fictícia A, persistência da proposta

- Após reduzir o funcionamento de segunda-feira para um período compatível com um único colaborador, o motor gerou e guardou uma proposta para **02/11/2026**. O utilizador confirmou que a proposta continuou visível após atualizar o Safari.
- Verificação SQL read-only: **conta A: 1 proposta** (1 na data 02/11/2026), **conta B: 0**, **conta principal: 4**. Nenhuma das contas tinha ledger de horários oficialmente aprovados. A nova proposta permaneceu associada apenas ao proprietário A.
- A primeira tentativa 09:00–17:00 com A1 sozinho não encontrou solução devido à cobertura contínua e pausa obrigatória; o cenário mais curto foi gerado e recuperado. Isto confirma comportamento coerente com as hard constraints, não a exaustividade do algoritmo.
- **Ainda pendente:** guardar uma proposta na conta B, confirmar que não aparece em A e executar teste de acesso cruzado com JWTs reais.


### Ensaio Safari — 08/11/2026, conta fictícia B, proposta de dois dias

- O utilizador confirmou no Safari que, após atualizar a página na conta B, a proposta de **02–03/11/2026** permanecia consultável, com os turnos de B1 nos dois dias. Isto valida a recuperação de uma proposta de vários dias nessa conta.
- Consulta anterior da base de dados confirmou que as propostas estão separadas por `owner_id`: A tem uma proposta de 02/11; B possui a proposta de 02–03/11 e duas propostas adicionais de 02/11; a conta habitual conserva quatro propostas.
- **Ainda pendente:** regressar à conta A, atualizar e garantir que não aparece o turno de B1 em 03/11 nem qualquer proposta de B. O teste de acesso cruzado com JWTs reais permanece independente desta verificação de interface.


## Ronda consolidada de validação técnica — 08/11/2026

**Sem novas ações manuais exigidas:** foi concluído um ensaio de leitura real por cada titular usando o papel `authenticated` e transações revertidas. A conta A vê 1 estado e 1 proposta; B vê 1 estado e 3 propostas; ambas veem 0 ledgers e 0 fontes históricas. O SQL real rejeitou também um pedido de gravação com revisão obsoleta (`40001`) após uma primeira alteração no mesmo bloco transacional; tudo terminou com `ROLLBACK`.

A Edge `official-schedules-v2` foi atualizada até à **versão 3** com JWT obrigatório, Deno strict e CORS. A UI consulta prontidão por omissão, mas bloqueia o botão até receber certificação do servidor. Continuam por executar testes remotos com JWTs de sessão reais e os cenários físicos de duas abas/fecho forçado.


### Regressões em CI concluídas — último ciclo do PR47

- `test:retired-edge`: simulação de GET e POST da API antiga v6 produziu 410 e não efetuou pedidos de rede; o gateway real continua a exigir JWT, conforme metadados Supabase.
- `test:four-week`: quatro cenários adicionais de 28 dias inteiros foram gerados e certificados atravessando mudanças sazonais e calendáricas, sem unir horários semanais de forma artificial.
- GitHub Actions `42534315836`: **validate + migration-contract aprovados**. Um teste de domínio aprovado não substitui uma interação real não executada.


### Reforço atómico aplicado

- Nova migração `20261108234026`: `commit_schedule_engine_approved_ledger_v2` aceita a **revisão da configuração**, bloqueia essa linha durante a transação e recusa operações desatualizadas sem mexer no ledger. O serviço antigo de gravação deixou de poder ser invocado diretamente por `service_role`.
- O servidor passou a carregar os limites do dia curto e a política de dias disponíveis da configuração atual e a aplicá-los à certificação oficial; regressões dedicadas na suite `test:approved-schedules`.
- `deno check` do endpoint e `liveEdgeSmokeTest.mjs` passaram; no HTTPS real, os dois serviços recusam GET/POST sem JWT e o v3 responde ao preflight CORS. O gateway não foi validado com JWT de A/B.


## Ronda final única no Safari — restantes decisões de merge

Esta ronda substitui as verificações manuais repetidas. A criação das duas contas A/B, persistência de colaboradores, propostas e isolamento em SQL já foram confirmados; **não repetir**.

| ID | Operação Safari | Critério de aprovação | Estado |
|---|---|---|---|
| S1 — JWT real | Atualizar a branch e reiniciar Vite. Na **conta A**, abrir a proposta guardada de 02/11/2026 | Painel de **Aprovação oficial** consulta v2 com a sessão, indica histórico por verificar e **não** apresenta botão de aprovação. HTTP 401/404/503 não conta como sucesso | **PASS — Safari, confirmado pelo utilizador em 09/11/2026** |
| S2 — 28 dias | Na **conta B**, simular 02–29/11/2026 com configuração fictícia atual, confirmar corretamente o contexto exterior, guardar e recarregar | Aceita 28 dias, respeita cobertura e descansos, recupera a proposta inteira após reload | **PASS — Safari, confirmado pelo utilizador em 09/11/2026** |
| S3 — duas abas | Na **conta B**, abrir duas abas já carregadas. Alterar o nome B1 na aba 1; guardar. Alterar o **mesmo campo** para outro valor na aba 2, sem reload | A segunda tentativa mostra conflito e não sobrescreve a aba 1. Após reload prevalece a versão da aba 1 | **PASS — Safari, reteste confirmado pelo utilizador em 09/11/2026**. A correção de comunicação entre abas resolveu a falha original; proteções de CAS e exportação permanecem ativas. |

Se S1–S3 passarem, a aceitação visual está concluída. Se falhar algum, corrigir e repetir **apenas o teste que falhou**. O merge continua separado das exceções explícitas: importação histórica adiada e leaked-password protection exigindo plano Pro+.

**Provas automáticas:** cenário de perda de rede antes/depois de commit com outbox e replay por UUID (PR47-14); transação real CAS de estado e ledger no Supabase com ROLLBACK (PR47-16/17); endpoint compilado com duas identidades sintéticas, 404 cruzado e histórico incompleto, além de RLS SQL real (PR47-23).


### S3 — Falha real de aviso e correção (09/11/2026)

- O utilizador confirmou S1 e S2, sem necessidade de os repetir. O screenshot de S2 mostra turnos de segunda a sexta entre 02 e 27/11 dentro do período pedido de 28 dias. A API não promove propostas a horários oficiais sem histórico.
- Em S3, um segundo Safari privado mostrou «A guardar» e não comunicou o conflito. Uma consulta read-only confirmou que a conta B ainda tem o nome que venceu na primeira aba (revisão 41); não houve substituição silenciosa.
- Correção PR47-16: evento owner-scoped de gravação confirmada enviado via localStorage e detetado nas outras abas do mesmo titular; a aba obsoleta é bloqueada com mensagem clara e opção de exportação antes do reload. Sem comunicação de dados ou tokens entre abas. Timeout de 20s para confirmação incerta, sem falsa indicação de sucesso. Adicionados regressões puras de isolamento de aviso e simulação de duas edições concorrentes do nome da mesma pessoa.
- Só S3 precisa de um único reteste com Safari após atualização do Git. O estado da CI deve estar verde antes de o solicitar.


### Confirmação final do reteste S3 — 09/11/2026

O utilizador confirmou expressamente que a correção do conflito entre abas ficou **resolvida** no Safari após atualização da branch. S1, S2 e S3 estão aceites na ronda final. Esta confirmação fecha a falha funcional de apresentação; não representa, por si só, uma autorização para aprovar horários sem histórico, nem corrige o aviso Auth dependente do plano Pro.


### Validação técnica aprofundada — 09/11/2026

- `test:official-edge-verified` passou em GitHub Actions `42609906545`: aprovações com histórico sintético completo usando o **verdadeiro handler Edge compilado**, teste de identidade distinta com 404 e nenhuma escrita cruzada, GET de prontidão positiva, POST aprovado, repetição recusada, revisão futura de ausência com substituição e cancelamento com preservação de versões.
- SQL PostgreSQL real: uma operação com estado desatualizado é recusada; só a versão certa cria um evento de histórico; repetição não o duplica. Tudo executado em `BEGIN/ROLLBACK`.
- SQL read-only no Supabase: existem 1 proposta A, 4 propostas B (incluindo 1 de 28 dias) e 4 da conta habitual. Nenhuma é oficialmente aprovada.
- Registos de `function_edge_logs` durante 24h até 09/11 11:00Z mostraram apenas HTTP 401 nos pedidos GET/POST às funções antigas e novas; o GET/POST 410 da função antiga foi comprovado em CI no handler isolado, mas não autenticado no gateway. Não afirmar prova de consumo inexistente fora da janela observada.
- **Decisões confirmadas em 09/11/2026:** histórico real desde janeiro de 2026 a importar posteriormente, com aprovação bloqueada até à verificação; Supabase Free mantido e aviso Auth de passwords comprometidas aceite como risco residual. Ver ADR de fecho. Não requer nova confirmação.


### Gate da auditoria após decisão do responsável — 09/11/2026

- S1 (consulta de bloqueio oficial), S2 (geração/recuperação de 28 dias) e S3 (alerta de conflito entre abas) — **PASS confirmado**.
- Importação de horários anteriores de 2026: **DIFERIDA POR DECISÃO**, não bloquear o merge do motor; **não** aprovar propostas com historial incompleto.
- Aviso `auth_leaked_password_protection`: **RISCO ACEITE** pelo responsável no plano Free; não marcar como corrigido nem subscrever Pro.
- Provas HTTP remotas com dois JWTs reais/410 autenticado da v6: **não realizadas**; evidências substitutas registadas, não afirmar PASS.
- Código e base de dados não recebem dados sintéticos definitivos por causa deste fecho; os testes sintéticos da CI e da transação revertida preservam o isolamento.


### Revisão dos nove resultados parciais — 09/11/2026

- 01, 14, 15, 18, 19, 21 e 22 passaram testes reais da aplicação no WebKit automatizado, usando backend isolado e sintético, com persistência por RPC simulada e reload.
- 03: o Supabase confirmou v6 inerte/JWT, a fonte executável coincide com a origem arquivada no Git e existem 13 ficheiros de rollback + manifesto. Não se afirma 410 autenticado remotamente.
- 05: dez migrações identificadas em produção e reconstruídas sem erro em PostgreSQL 17 descartável com contratos Supabase. Não se afirma criação de segundo projeto Supabase alojado.
- **Classificação operacional: 16 PASS com modo de teste explicitado, 7 POR TESTAR.** Não há autorização para merge implícita nesta classificação, e os riscos do Supabase Free e histórico adiado mantêm-se.
- **CI:** `42631894388`, 3/3 jobs `success`, commit `5f8e243`.
