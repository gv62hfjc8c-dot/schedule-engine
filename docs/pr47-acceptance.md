# PR #47 — Protocolo de aceitação e testes reproduzíveis

**Estado:** preparado, não executado no Safari. **PR #47 permanece em draft
e não pode fazer merge até os critérios de aceitação serem cumpridos.**

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
| 03 Edge Function antiga | **Versão 410 publicada; ensaio HTTP pendente** | Foi publicada a v6 com `verify_jwt=true`; confirmar resposta autenticada e eventuais consumidores. Bundle v5 arquivado para rollback |
| 04 Consentimento na importação | Implementado e reforçado para múltiplas contas | **G01**: conta nova escolhe começar vazia, sem importar dados legados do browser; a decisão é por proprietário, não apaga dados antigos, não afeta outra conta, e requer teste Safari |
| 05 Migrações divergentes | **Versões PR47 alinhadas com a instância real** | Histórico remoto e dois SQLs de migração PR47 têm IDs idênticos `20261108124759` e `20261108124844`; ensaio sintético aprovado. Falta verificar end-to-end em Auth/UI |
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
| 16 Escrita concorrente | **Mitigado** | D07, F05 e **G02**; mesma sessão em série, divergências entre abas sem merge automático |
| 17 Aprovação oficial ausente | **Fluxo protegido implementado na branch; não operacional** | Tabelas RLS, RPC de revisão e inicialização verificada em SQL publicadas; a inicialização falha com pessoa/dia desconhecido e não cria falsas folgas. Domínio valida contratos/ausências e 28 dias; Edge v2 e painel protegidos por flag desligada. Importação 2026 adiada, deploy/autenticação do endpoint e Safari pendentes |
| 18 Ciclos de 28 dias | **28 dias disponíveis na branch PR47** | `test:four-week` valida geração única com certificação; migração `20261108124759` publicada e UI limitada a 28 dias. Falta geração real e recuperação Safari |
| 19 Perfis de colaboradores | **V0 implementado; ocorrências oficiais dependem de #17** | `test:scheduling-model` valida `unavailableWorkDates` sem turno, incluindo rejeição da certificação. `test:qualification-coverage` valida competências durante turnos e refeições; UI edita datas indisponíveis e etiquetas. Motivos administrativos e tipos de vínculo não especificados |
| 20 Segurança Supabase | **RPC reforçado; 1 aviso Auth pendente** | Migração `20261108124844` aplicada e funções/permissões verificadas; verificar operações reais de gravação no Safari. Proteção de passwords comprometidas continua desligada, disponível em Supabase Pro+ |
| 21 Código experimental | Implementado | `npm run test:architecture`; verificar ausência de laboratório na UI e preservação dos testes do domínio |
| 22 Terminologia desatualizada | Implementado | A03, A06, D01 e revisão textual: «proposta guardada, não aprovada» |
| 23 Cobertura de regressões | **Reforçado, aceitação pendente** | `npm test` e F01–F08, mais A–D e G01–G03. Não certificar a ausência de defeitos fora dos cenários executados |

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

**Sem dados históricos importados, o resultado esperado de uma tentativa de aprovação é BLOQUEADO, nunca APROVADO.** O novo serviço está preparado mas permanece sem deploy; os testes HTTP reais não podem ser assinalados PASS enquanto essa publicação não estiver concluída.

| ID | Procedimento | Critério | Estado |
|---|---|---|---|
| H01 | Pedido sem JWT e JWT de conta anónima ao serviço oficial v2 | 401, zero escritas | PENDENTE — deploy |
| H02 | Conta A tenta aprovar proposta de B | 404/422, sem acesso nem escrita cruzada | PENDENTE — duas contas reais |
| H03 | Conta sem histórico de 2026 tenta aprovar | 409 por histórico incompleto, ledger continua vazio | PENDENTE — Auth real |
| H04 | Ficheiro histórico incompleto, um colaborador sem dias confirmados | Recusa; jamais presumir folga | PASS no CI de domínio; ensaio importador PENDENTE |
| H05 | Proposta guardada, flag da UI desligada | Não aparece operação ativa nem é possível aprovar | PENDENTE — Safari |
| H06 | Histórico simulado completo e proposta com restrições válidas | Teste de aplicação guarda apenas com CAS, falhas não publicam sucesso | PASS em testes simulados; HTTP/ledger real PENDENTE |
| H07 | Revisão parcial: baixa, férias ou saída depois de aprovar | Versão antiga preservada; novo turno certificado; tentativa retroativa recusada | PASS no domínio/CI; UI/HTTP PENDENTE |
| H08 | Importar horários antigos e rever totais de 28 dias e histórico anual | Identidade estável, sem dupla contagem, revisão de conflitos, proveniência | PENDENTE — importação adiada pelo utilizador |

Provas técnicas atuais: `test:official-revisions`, `test:verified-official-service`, `test:official-edge-bundle`, `test:history-context`, mais `scripts/ci/postgres_history_assertions.sql` e `scripts/ci/postgres_approval_revision_assertions.sql`. Estes testes não autorizam ativar a flag de aprovação nem efetuar merge sem evidência dos ensaios H01–H08 pertinentes.


## PR47 — Contas de ensaio e dados legados do mesmo navegador

- O Safari pode manter dados legados não associados a uma identidade; um utilizador novo não deve ser obrigado a reclamá-los. A opção **Começar esta conta vazia — não importar dados antigos** grava apenas uma decisão local associada ao identificador autenticado da conta, sem alterar a configuração existente nem importar dados de outra pessoa.
- Se a conta nova já tiver estado remoto, esse estado continua a prevalecer. Se não tiver, a nova conta começa vazia e poderá gravar os próprios dados com a primeira edição.
- `src/supabaseStateRepositoryTest.ts` confirma que o skip é isolado entre dois titulares e não escreve automaticamente na base de dados. **Safari confirmado em 08/11/2026**: uma conta nova abriu sem importar dados locais; colaborador fictício A1 persistiu após recarregar; na segunda conta, A1 estava ausente e B1 persistiu após recarregar. **Leitura SQL real**: 1 titular apenas com A1, 1 apenas com B1, 0 titulares com ambos, 3 contas com configuração. **Verificação inversa no Safari confirmada:** conta A mostra A1 e não mostra B1 após recarregar. Falta teste cruzado real usando JWTs distintos sobre a mesma API e uma proposta guardada por conta.
- **Nunca carregar no botão de importação dos dados antigos para uma conta de ensaio** quando o conteúdo pertence à conta habitual.
