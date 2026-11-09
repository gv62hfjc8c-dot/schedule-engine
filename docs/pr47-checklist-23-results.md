# PR #47 — Registo de verificação dos 23 pontos (checklist canónica)

**Data:** 2026-11-09
**Commit de referência:** `5c4ff30a3de660973a33c72583cefc44f114949a` (CI verde)
**Fonte:** checklist funcional de 23 pontos fornecida pelo responsável do Schedule Engine em 09/11/2026.
**Estado:** **7 PASS, 9 PARCIAL, 7 POR TESTAR**. Os resultados referem-se ao teste pedido, **não** apenas à implementação do código.

## Semântica da classificação

- **PASS:** o comportamento e as provas exigidas no ponto foram demonstrados com os testes disponíveis, ou, no ponto 20, a exceção residual foi aceite expressamente. Não significa que o risco do ponto 20 tenha desaparecido.
- **PARCIAL:** código/CI ou parte da interface comprovados, mas falta uma verificação explicitamente exigida pelo ponto.
- **POR TESTAR:** não existe evidência de que o cenário específico do protocolo tenha sido executado, embora haja código e testes unitários sobre o tema.
- **FAIL:** cenário efetivamente testado e não conforme. O ponto 16 teve FAIL inicial, correção implementada e PASS no reteste.

## Tabela canónica

| Nº | Teste exigido pelo responsável | Canal | Estado | Evidência e limite |
|---|---|---|---|---|
| 01 | Documentação: ecrãs, funcionalidades e limites correspondem à aplicação | Técnico | **PARCIAL** | README/roadmap/ADR atualizados; não há confronto integral, ecrã a ecrã, de documentação e UI |
| 02 | Dia sem turno diz «Sem turno»/«Por planear», nunca folga automática | Safari | **POR TESTAR** | UI e testes automatizados corrigidos; falta observação formal de um dia sem turno no Safari |
| 03 | API antiga: Supabase, permissões e recuperação; confirmar desativação | Infraestrutura | **PARCIAL** | v6 publicada e inerte, handler GET/POST 410 sem rede; gateway JWT e plano de rollback verificados em fonte. Não há resposta 410 real obtida por sessão autenticada nem auditoria definitiva de consumidores externos |
| 04 | Conta ensaio: consentimento antes de importar e prioridade dos dados cloud | Ensaio | **PASS** | Conta A começou vazia recusando legado, conta B isolada, propostas/colaboradores persistiram após reload; precedência cloud e skip por titular cobertas por testes do repositório |
| 05 | Supabase: comparar migrações e esquema com Git, reconstruir isoladamente | Infraestrutura | **PARCIAL** | 10 migrações em Git e Supabase; reconstrução integral em PostgreSQL 17 descartável com stubs Supabase na CI. Não foi criado/testado um projeto Supabase isolado completo |
| 06 | Gerar duas propostas sobrepostas; cada versão isolada no calendário | Safari | **POR TESTAR** | Há propostas sobrepostas da conta B na DB e testes de snapshots; não há aceitação visual documentada sobre duas versões no calendário |
| 07 | Contrato 20h, objetivo 15h: hard vs soft | Safari | **POR TESTAR** | Regras implementadas e testadas na CI; cenário exato 20h/15h não confirmado no Safari |
| 08 | Restrições incompatíveis: não guardar solução inválida | Safari + CI | **PASS** | Conta A, 09–17 com uma pessoa e refeição obrigatória, devolveu sem solução; CI certifica hard constraints; consulta SQL confirmou zero propostas inválidas nesse cenário |
| 09 | Jornadas de 5h, 7h e 9h com pausa e horas efetivas | Safari | **POR TESTAR** | Motor/refeições com testes unitários; não há trio de cenários 5/7/9h validado no Safari |
| 10 | Dia obrigatório: cumprir ou indicar impossibilidade | Safari | **POR TESTAR** | Datas obrigatórias existem no núcleo e CI; cenário Safari específico não realizado |
| 11 | Operação e disponibilidade 09–12 + 14–18, confirmar persistência | Safari | **POR TESTAR** | Editor de múltiplos intervalos e CI implementados; ensaio visual com reload não confirmado |
| 12 | Criar exceção duplicada e conservar a primeira | Safari | **POR TESTAR** | Prevenção automática implementada; tentativa no Safari não confirmada |
| 13 | Snapshot corrompido detetado e não apresentado como válido | Automático | **PASS** | Suites de validação/arquivo, certificação e isolamento de registos ilegíveis na CI |
| 14 | Interrupção de gravação: aviso, repetição segura e sem confirmação falsa | Safari + CI | **PARCIAL** | CI simulou perdas antes e depois do commit com outbox e UUID idempotente; UI tem timeout e mensagem de incerteza. Não se fez a falha de rede/fecho na sessão Safari |
| 15 | Europe/Lisbon: persistência, cálculos e DST | Safari + CI | **PARCIAL** | CI de fusos DST/28 dias aprovada; não se configurou e validou Europe/Lisbon na interface Safari |
| 16 | Mesma configuração editada em duas abas, sem substituição silenciosa | Safari | **PASS** | S3 falhou inicialmente no aviso, foi corrigido e o responsável confirmou o reteste Safari; CAS e regressão do mesmo campo passam na CI |
| 17 | Proposta guardada não pode surgir aprovada nem oferecer aprovação fictícia | Safari | **PASS** | S1 aprovado na conta A: proposta continua não oficial, o painel bloqueia aprovação por histórico real ainda desconhecido |
| 18 | Âncora 02/11/2026: quatro semanas e transição 29→30/11 | Safari | **PARCIAL** | S2 confirmou geração/recuperação do período 02–29/11, inclusive proposta de 28 dias no Supabase. Não há prova de consulta ao 30/11 como início do ciclo seguinte |
| 19 | Persistência de contratos, objetivos e dias obrigatórios; perfis | Safari | **PARCIAL** | Modelo V0 implementado para contratos/objetivos/dias, ausências e competências; persistência de cada campo não foi verificada no cenário pedido no Safari |
| 20 | RLS com duas contas staging e avisos Supabase | Infraestrutura | **PASS COM RISCO ACEITE** | RLS de A/B ensaiada em SQL e isolamento na UI; apenas `auth_leaked_password_protection` permanece desativado. Responsável decidiu manter Supabase Free e aceitou formalmente o risco |
| 21 | Teste de arquitetura e ausência dos laboratórios na UI | Automático | **PARCIAL** | `test:architecture` passou e código experimental foi removido; ausência visual na aplicação não foi explicitamente verificada |
| 22 | Revisão de terminologia nas vistas e estados | Safari | **PARCIAL** | S1 confirma distinção de proposta guardada vs aprovada; não foi feita revisão sistemática dos ecrãs/estados |
| 23 | `npm test`, `npm run typecheck`, `npm run build`, `npm run audit:dependencies` no commit final | Automático | **PASS** | GitHub Actions run `42617094052`, commit `5c4ff30a`, jobs validate e migration-contract concluídos com sucesso; workflow contém os quatro comandos |

## Decisões já tomadas (não voltar a solicitar)

1. Os horários reais desde janeiro de 2026 serão importados **posteriormente**. O motor não pode concluir aprovações oficiais dependentes desse histórico até terem cobertura verificada por pessoa/dia.
2. Manter **Supabase Free**; o aviso Auth sobre palavras-passe comprometidas é risco residual **aceite**, não foi tecnicamente eliminado. Não contratar plano pago.
3. O PR #47 não está em `main`; o estado Ready for review não equivale a merge.

## Próxima aceitação eficiente

Não repetir S1/S2/S3 nem a infraestrutura já provada. Concentrar numa ronda Safari os itens ainda sem evidência visual: 02, 06, 07, 09, 10, 11, 12, 15, 18 (apenas 30/11), 19, 21 e 22. O ponto 14 pede um ensaio controlado de interrupção na conta fictícia; não fazer com dados reais. O 01 é revisão documental/UI e o 03 exige avaliação técnica do gateway/consumidores; o 05 possui apenas reconstrução PostgreSQL isolada, não projeto Supabase separado. Nenhum destes pontos pode receber PASS antes da respetiva prova ou de uma alteração explícita do critério de aceitação.

**Esta tabela prevalece sobre afirmações genéricas anteriores de «23/23 resolvidos».**
