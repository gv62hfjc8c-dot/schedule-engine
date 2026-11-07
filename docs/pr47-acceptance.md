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
- **RLS entre duas contas:** realizar num projeto Supabase **de staging** com
  duas contas descartáveis. Não usar dados ou passwords de produção.
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
| C06 | Tentar gerar 15 dias consecutivos | Limite de 14 dias é respeitado | PENDENTE |
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

## Bloco E — RLS real, duas contas (projeto staging obrigatório)

Além dos testes offline de segurança, agora existe um verificador
**read-only** que autentica duas contas num projeto de ensaio e verifica
isolamento bidirecional sobre as três tabelas do fluxo ativo.

1. Preparar projeto Supabase de **staging**, separado da instância
   operacional, com o esquema necessário ao fluxo atual.
2. Criar duas contas de teste e, através da própria UI, guardar uma
   configuração e **pelo menos uma proposta** em cada conta.
3. Criar um ficheiro **local ignorado pelo Git**
   `.env.rls-test.local` (nunca enviar as credenciais para o chat):

   ```env
   RLS_TEST_CONFIRM=STAGING_ONLY
   RLS_TEST_SUPABASE_URL=https://SEU_STAGING.supabase.co
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
   altera dados**, e não imprime senhas nem tokens.

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

### Gate de merge

O PR #47 só sai de draft após: zero P0/P1, casos manuais críticos
A–D aprovados, regressões F01–F07 verdes na SHA final, resultado
F08 registado, matriz das 23 observações reconciliada e confirmação
explícita do utilizador. Uma pendência externa do Checkpoint D
continuará descrita como pendência, não como «resolvida».

O procedimento protege a `main` e o rollback PR #46. Não integrar
uma alteração parcial sem repetir os testes afetados.
