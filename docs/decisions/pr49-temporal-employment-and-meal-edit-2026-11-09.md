# PR49 — Vínculos temporais e revisão da refeição (09/11/2026)

## Decisões confirmadas

- O colaborador possui identidade permanente e um ou vários **períodos de
  vínculo** com datas inclusivas de entrada e saída.
- O facto de aparecer no Excel antes da contratação **não** cria qualquer
  turno, folga, feriado ou ausência anterior à entrada.
- Na importação histórica, quatro horas visíveis representam uma jornada de
  presença **contínua** com intervalo de refeição; não representam dois turnos.
  Duas horas isoladas representam jornada contínua sem refeição.
- A pausa é parte de `DatedWorkShift.mealBreak`, sem novos intervalos de
  trabalho separados.
- O utilizador pode ajustar o início de uma pausa numa proposta gerada.
  **Uma edição não modifica um snapshot persistido**: uma nova proposta é
  validada integralmente e arquivada com novo UUID, mantendo a anterior.
- A CI executa regressão, verificação PostgreSQL e testes WebKit; isto
  procura incompatibilidades, não questiona as datas já confirmadas.

## Regras temporais

A lista `Person.employmentPeriods` suporta entrada, saída e regresso à
equipa. Não são admitidos intervalos sobrepostos. `endDate=null` significa
vínculo aberto. A ausência desse campo conserva os projetos legados sem
impedir a sua interface, **mas não certifica o passado**: a inicialização
oficial do histórico exige explicitamente os períodos de todas as pessoas
cujo contexto é necessário.

Na geração, apenas pessoas `active` e com vínculo na data do turno são
elegíveis. Na verificação de histórico, os dias antes da entrada ou depois
da saída não são exigidos nem classificados; dados efetivamente importados
fora do vínculo são rejeitados.

**Dados do ficheiro de janeiro:** Lídio entrou a 05/01/2026; Floriberto
entrou em fevereiro, com data precisa a apurar no ficheiro desse mês.
A presença antecipada dos nomes no documento não cria vínculo.
Sandro do Excel é excluído e não é Sandro Borba existente no Supabase.

## Validação de pausas

O início da pausa pode ser deslocado, mantendo a duração original e o turno
de presença. O motor recertifica limites diários/semanais, descanso,
disponibilidade, cobertura operacional, qualificações e requisitos de
refeição. Se a recertificação falhar, não existe nova proposta.

## Deploy e limitação intencional

A classificação do PR48, bem como a nova migração de verificação temporal
deste PR, **não estão ainda aplicadas no Supabase operacional**. A leitura
`occurrence_type` na Edge Function depende do rollout ordenado das duas
migrações e da publicação da versão atualizada do serviço.

Não importar Excel e não inicializar aprovações oficiais antes de validar
identidades, vínculos, cobertura histórica e consistência de migrações.
Uma entrada posterior de colaboradores não pode reutilizar uma atestação
histórica feita com outra composição da equipa: o serviço volta a consultar
os vínculos e a cobertura real antes de autorizar qualquer proposta.

Conservar compatibilidade de propostas existentes, migrações RLS e
isolamento por proprietário. Nunca editar o ledger oficial pelo browser.
