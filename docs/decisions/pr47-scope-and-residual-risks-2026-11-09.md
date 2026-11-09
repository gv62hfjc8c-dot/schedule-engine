# PR47 — Decisões de fecho da auditoria e riscos residuais

**Data:** 2026-11-09
**Estado:** decisões expressamente confirmadas pelo responsável do projeto
**Aplica-se a:** PR #47, Schedule Engine independente da Borja Reis

## Decisão 1 — Histórico anterior de 2026: importar depois

A importação dos horários reais desde janeiro de 2026 **não faz parte do critério de merge do PR47**. A fonte externa, identidade e proveniência dos colaboradores, dias trabalhados, pausas e períodos de ausência serão integrados quando forem fornecidos os registos reais. Não se podem inventar turnos nem interpretar dias sem registo como dias de folga.

Até existir um arquivo externo inteiramente verificado por pessoa/dia, o Schedule Engine **pode gerar, guardar e consultar propostas, mas não pode aprová-las oficialmente** se a validação depender de um contexto desconhecido. Esta é uma restrição de segurança funcional deliberada, não uma falha por corrigir no âmbito do PR47. O serviço v2 conserva o bloqueio no servidor; a UI não pode contorná-lo.

**Tarefa futura autónoma:** importador com mapeamento de identidades, reconciliação de fontes, verificação de cobertura dia/pessoa, testes de continuidade e aprovação formal de dados reais. Não iniciar o trabalho de importação sem os documentos reais.

## Decisão 2 — Supabase Free: risco residual aceite

Manter o plano **Free**. O responsável aceita expressamente o aviso **`auth_leaked_password_protection`** (verificação de palavras-passe comprometidas desativada neste plano); **não contratar, não ativar upgrades pagos, não criar recursos faturáveis** sem nova autorização.

Isto **não significa que a funcionalidade esteja ativada ou que o aviso tenha desaparecido**. O risco deve ficar visível no Security Advisor e ser reavaliado quando se reconsiderarem os requisitos de autenticação. O restante hardening da base de dados (RLS, privilégios RPC, autenticação por titular, CAS) foi implementado e testado.

## Fecho de escopo — auditoria técnica

Os 23 itens foram abordados pela implementação do PR47, testes automáticos e aceite S1/S2/S3 no Safari. Existem duas **exceções de produto expressamente aceites** acima. Não contar a importação futura nem a funcionalidade Pro como trabalhos concluídos.

Validações e limites que permanecem **registados, sem falsos PASS**:
- A API antiga `official-schedules` v6 continua publicada mas inerte: devolve 410 no handler, sem acesso aos dados. Com JWT ausente, o gateway retorna 401; não se realizou GET autenticado remoto para provar 410.
- O fluxo v2 real foi exercitado no Safari com uma conta; as provas de isolamento entre duas contas combinam RLS em Supabase real, interface Safari e duas identidades simuladas no Edge compilado. **Não se executou teste HTTP remoto automatizado com dois JWTs reais.**
- Aprovação/revisão/cancelamento em contexto histórico completo passaram com dados sintéticos e com testes transacionais SQL revertidos; **nenhum histórico real importado nem horários reais aprovados**.

Estes são limites explícitos da prova, não impedimentos ocultos. Os testes pendentes com credenciais reais, se vierem a ser necessários, serão executados **nas sessões existentes do dispositivo**, sem solicitar passwords ou tokens.

## Critério de continuação

Uma vez verde a CI para o último commit e verificado o estado do Supabase, o PR47 pode ser considerado **tecnicamente pronto para a decisão de merge**, respeitando estas exceções e mantendo a aprovação de horários bloqueada. Merge é uma operação separada e não fica autorizada automaticamente por este documento.

O Schedule Engine retoma o desenvolvimento do seu núcleo assim que o PR47 for integrado. Não voltar a abrir esta auditoria por falta de dados cujo fornecimento foi explicitamente adiado.
