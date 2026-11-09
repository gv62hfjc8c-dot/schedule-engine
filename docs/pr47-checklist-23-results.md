# PR #47 — Registo de verificação dos 23 pontos (checklist canónica)

**Data:** 2026-11-09
**Commit de referência:** `5c4ff30a3de660973a33c72583cefc44f114949a` (CI verde)
**Fonte:** checklist funcional de 23 pontos fornecida pelo responsável do Schedule Engine em 09/11/2026.
**Estado pós-testes em 09/11/2026:** **16 PASS (alguns por WebKit/CI automatizado), 0 PARCIAL, 7 POR TESTAR**. Os resultados referem-se ao teste pedido, **não** apenas à implementação do código.

## Semântica da classificação

- **PASS:** o comportamento foi demonstrado pela evidência identificada na linha, incluindo testes automatizados WebKit e CI quando indicado. **PASS em WebKit não significa que houve ensaio nativo no Safari do Mac**. No ponto 20 o risco residual foi aceite, não eliminado.
- **PARCIAL:** código/CI ou parte da interface comprovados, mas falta uma verificação explicitamente exigida pelo ponto.
- **POR TESTAR:** não existe evidência de que o cenário específico do protocolo tenha sido executado, embora haja código e testes unitários sobre o tema.
- **FAIL:** cenário efetivamente testado e não conforme. O ponto 16 teve FAIL inicial, correção implementada e PASS no reteste.

## Tabela canónica

| Nº | Teste exigido pelo responsável | Canal | Estado | Evidência e limite |
|---|---|---|---|---|
| 01 | Documentação: ecrãs, funcionalidades e limites correspondem à aplicação | Técnico | **PASS — documentação + WebKit + CI** | Corrigida divergência real do limite 14/28 dias em `src/App.tsx`; README e arquitetura atualizados (10 migrações, API oficial, 28 dias); `test:docs-consistency` e navegação de ecrãs no WebKit aprovados. Revisão automatizada de áreas principais, não inspeção manual exaustiva de cada texto |
| 02 | Dia sem turno diz «Sem turno»/«Por planear», nunca folga automática | Safari | **POR TESTAR** | UI e testes automatizados corrigidos; falta observação formal de um dia sem turno no Safari |
| 03 | API antiga: Supabase, permissões e recuperação; confirmar desativação | Infraestrutura | **PASS — infraestrutura verificada** | Supabase confirmou `official-schedules` v6 ativa mas inerte, `verify_jwt=true`, fonte executável idêntica à arquivada no Git (ignorando comentários), GET/POST 410 testados no handler sem acessos à rede, nenhuma aprovação oficial; rollback v5 preservado (13 fontes e manifesto). Resposta HTTP 410 autenticada pelo gateway não executada, pelo que não se reivindica essa prova |
| 04 | Conta ensaio: consentimento antes de importar e prioridade dos dados cloud | Ensaio | **PASS** | Conta A começou vazia recusando legado, conta B isolada, propostas/colaboradores persistiram após reload; precedência cloud e skip por titular cobertas por testes do repositório |
| 05 | Supabase: comparar migrações e esquema com Git, reconstruir isoladamente | Infraestrutura | **PASS — migrações e reconstrução isolada** | Supabase real contém exatamente as 10 versões do Git; a CI `migration-contract` reconstrói as dez migrações em PostgreSQL 17 descartável com papéis/stubs Supabase e testa RLS, RPC, CAS e rollback. Não foi criado um segundo projeto alojado no Supabase |
| 06 | Gerar duas propostas sobrepostas; cada versão isolada no calendário | Safari | **POR TESTAR** | Há propostas sobrepostas da conta B na DB e testes de snapshots; não há aceitação visual documentada sobre duas versões no calendário |
| 07 | Contrato 20h, objetivo 15h: hard vs soft | Safari | **POR TESTAR** | Regras implementadas e testadas na CI; cenário exato 20h/15h não confirmado no Safari |
| 08 | Restrições incompatíveis: não guardar solução inválida | Safari + CI | **PASS** | Conta A, 09–17 com uma pessoa e refeição obrigatória, devolveu sem solução; CI certifica hard constraints; consulta SQL confirmou zero propostas inválidas nesse cenário |
| 09 | Jornadas de 5h, 7h e 9h com pausa e horas efetivas | Safari | **POR TESTAR** | Motor/refeições com testes unitários; não há trio de cenários 5/7/9h validado no Safari |
| 10 | Dia obrigatório: cumprir ou indicar impossibilidade | Safari | **POR TESTAR** | Datas obrigatórias existem no núcleo e CI; cenário Safari específico não realizado |
| 11 | Operação e disponibilidade 09–12 + 14–18, confirmar persistência | Safari | **POR TESTAR** | Editor de múltiplos intervalos e CI implementados; ensaio visual com reload não confirmado |
| 12 | Criar exceção duplicada e conservar a primeira | Safari | **POR TESTAR** | Prevenção automática implementada; tentativa no Safari não confirmada |
| 13 | Snapshot corrompido detetado e não apresentado como válido | Automático | **PASS** | Suites de validação/arquivo, certificação e isolamento de registos ilegíveis na CI |
| 14 | Interrupção de gravação: aviso, repetição segura e sem confirmação falsa | Safari + CI | **PASS automatizado — WebKit + CI** | A interface WebKit recebeu resposta HTTP 503 simulada durante uma gravação; apresentou bloqueio, opção de exportação e não substituiu o último estado confirmado. A CI ensaiou replay com UUID persistente antes/depois de commit e sem duplicação. Não foi efetuado fecho físico do Safari no Mac |
| 15 | Europe/Lisbon: persistência, cálculos e DST | Safari + CI | **PASS automatizado — WebKit + CI** | Em UI WebKit aplicou-se `Europe/Lisbon`, foi guardado por RPC simulado e recuperado após reload; testes de domínio verificam horas reais em DST (salto) e rejeição de hora ambígua no recuo. Não foi uma sessão macOS Safari |
| 16 | Mesma configuração editada em duas abas, sem substituição silenciosa | Safari | **PASS** | S3 falhou inicialmente no aviso, foi corrigido e o responsável confirmou o reteste Safari; CAS e regressão do mesmo campo passam na CI |
| 17 | Proposta guardada não pode surgir aprovada nem oferecer aprovação fictícia | Safari | **PASS** | S1 aprovado na conta A: proposta continua não oficial, o painel bloqueia aprovação por histórico real ainda desconhecido |
| 18 | Âncora 02/11/2026: quatro semanas e transição 29→30/11 | Safari | **PASS — Safari S2 + WebKit transição** | Safari confirmou proposta real 02–29/11/2026 de 28 dias, recuperada após reload; WebKit com âncora `02/11/2026` verificou `29/11 = semana 4/4` e `30/11 = 1/4, novo ciclo 30/11–27/12`; CI inclui bissexto, mudança de ano e DST. A consulta de 30/11 foi no WebKit, não no Safari do Mac |
| 19 | Persistência de contratos, objetivos e dias obrigatórios; perfis | Safari | **PASS automatizado — WebKit + CI** | Interface WebKit gravou e recuperou após reload limite contratual de 20h, objetivo semanal de 15h e dia obrigatório de 16/11/2026, num Supabase simulado. CI valida máximo hard, objetivo soft, datas obrigatórias e perfis V0. Não se alteraram dados reais de pessoas |
| 20 | RLS com duas contas staging e avisos Supabase | Infraestrutura | **PASS COM RISCO ACEITE** | RLS de A/B ensaiada em SQL e isolamento na UI; apenas `auth_leaked_password_protection` permanece desativado. Responsável decidiu manter Supabase Free e aceitou formalmente o risco |
| 21 | Teste de arquitetura e ausência dos laboratórios na UI | Automático | **PASS — arquitetura + WebKit** | `npm run test:architecture` verifica grafo de dependências, ausência dos três laboratórios antigos e independência do núcleo; UI real no WebKit confirmou apenas as quatro áreas operacionais e inexistência de laboratórios visíveis |
| 22 | Revisão de terminologia nas vistas e estados | Safari | **PASS automatizado — WebKit + revisão de texto** | WebKit percorreu Horários, Operação, Equipa, Regras e geração: a UI distingue propostas guardadas de horários oficialmente aprovados, e confirma aviso de que a geração não aprova. O backend simulado não publica aprovações; não equivale a revisão manual exaustiva de todas as mensagens no Safari |
| 23 | `npm test`, `npm run typecheck`, `npm run build`, `npm run audit:dependencies` no commit final | Automático | **PASS** | GitHub Actions run `42617094052`, commit `5c4ff30a`, jobs validate e migration-contract concluídos com sucesso; workflow contém os quatro comandos |

## Decisões já tomadas (não voltar a solicitar)

1. Os horários reais desde janeiro de 2026 serão importados **posteriormente**. O motor não pode concluir aprovações oficiais dependentes desse histórico até terem cobertura verificada por pessoa/dia.
2. Manter **Supabase Free**; o aviso Auth sobre palavras-passe comprometidas é risco residual **aceite**, não foi tecnicamente eliminado. Não contratar plano pago.
3. O PR #47 não está em `main`; o estado Ready for review não equivale a merge.

## Ronda de automação de 09/11/2026

A última suite passou nos três jobs de GitHub Actions: `validate`, `migration-contract` e `webkit-acceptance` (execução `42631894388`, commit `5f8e243`). WebKit 26, Playwright 1.56.1, Ubuntu 24.04, Vite/React reais com autenticação e Supabase integralmente simulados. Os cenários simulados nunca escreveram na instância Supabase do utilizador.

**Limite de equivalência:** as verificações marcadas `PASS automatizado` demonstram o funcionamento da interface em WebKit, motor do Safari, **mas não reproduzem o aplicativo Safari macOS**, nem autenticação real na UI sintética. No ponto 05, a reconstrução isolada foi PostgreSQL 17 com stubs Supabase, não outro projeto Supabase alojado. No ponto 03, o gateway com um JWT real não foi ensaiado para obter 410. Essas limitações permanecem documentadas; não transformar esta aceitação em prova de algo não executado.

## Próxima aceitação eficiente

Não repetir S1/S2/S3 nem o WebKit já aprovado. Concentram-se os testes originais ainda sem execução em 02, 06, 07, 09, 10, 11 e 12. Para qualquer revisão de segurança ou equivalência nativa, usar as limitações descritas acima e não fazer passar WebKit por Safari macOS.

**Esta tabela prevalece sobre afirmações genéricas anteriores de «23/23 resolvidos».** Sete cenários continuam por testar segundo o protocolo original.


## Ronda funcional comunicada pelo responsável — 09/11/2026

Após a checklist original, o responsável comunicou **PASS declarado** para os pontos
02, 07, 09, 10, 11 e 12. Estes resultados são aceitação funcional reportada
pelo responsável nesta conversa; não são provas novas de CI nem devem ser
confundidos com os resultados automatizados anteriores.

O responsável redefiniu o critério do ponto **06**: uma nova geração não pode
alterar nem sobrepor silenciosamente um horário **oficialmente aprovado**.
Este requisito é distinto do isolamento de propostas não aprovadas.

**Intervenção implementada na branch PR47 (a validar):**
- O núcleo recebe períodos oficiais protegidos e rejeita a geração quando
  existe interseção, incluindo o dia inicial/final e datas sem turnos.
- Antes de executar a geração, a interface consulta o ledger autenticado
  da conta no Supabase; erros de consulta impedem a geração.
- A ausência de ledger não é tratada como prova de contexto oficial
  completo: qualquer resultado gerado continua a ser apenas proposta
  não aprovada, dependente da declaração explícita do contexto exterior.
- Testes de regressão acrescentados ao gerador condicionado.
- Uma alteração genuína a horário aprovado continua reservada ao
  comando confiável de revisão, com nova versão e histórico imutável.

**Estado do ponto 06: IMPLEMENTADO / RETESTE PENDENTE.**
Não marcar como PASS até confirmação da CI e do comportamento real no Safari.
A escrita de propostas continua append-only; não modifica o ledger oficial.
A leitura prévia no cliente não constitui bloqueio transacional de concorrência
entre uma geração e uma aprovação efetuadas simultaneamente; a aprovação
oficial continua a depender da validação e CAS confiáveis do servidor.
