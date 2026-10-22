# Changelog

## 2026-10-22 — Disponibilidade respeita calendário operacional

- tempo escalável passa a ser a interseção entre funcionamento e disponibilidade;
- dias fechados no calendário operacional ficam bloqueados na disponibilidade semanal;
- exceções de disponibilidade respeitam o funcionamento efetivo da respetiva data;
- seletores de horas ficam limitados ao intervalo operacional;
- adicionados testes para operação fechada, limites horários e abertura excecional.

## 2026-10-22 — Ponto 3: Disponibilidade

- introduzida disponibilidade semanal por pessoa;
- zero intervalos representa indisponibilidade;
- adicionadas exceções de disponibilidade por data;
- adicionada resolução da disponibilidade efetiva;
- adicionada validação de intervalos totalmente contidos;
- disponibilidade definida como hard constraint;
- criado separador próprio na interface;
- pessoas arquivadas preservam os dados mas deixam de ser selecionáveis;
- persistência atualizada para versão 2;
- migração automática preserva calendário e pessoas guardados na versão 1;
- adicionados testes de disponibilidade e migração.

## 2026-10-22 — Persistência automática local

- criada uma porta assíncrona de persistência independente do motor;
- implementado adaptador versionado de `localStorage`;
- calendário, exceções e pessoas são carregados automaticamente no arranque;
- alterações são guardadas automaticamente com debounce;
- adicionado indicador visual de estado da gravação;
- estrutura preparada para substituição futura por API/base de dados;
- adicionados testes do adaptador de persistência.

## 2026-10-22 — Separação por áreas

- calendário operacional e pessoas passam a existir em separadores próprios;
- cada separador mostra apenas os indicadores relevantes para o seu contexto;
- removido o empilhamento das áreas na mesma página;
- alteração limitada à interface, sem mudança no domínio.

## 2026-10-22 — Ponto 2: Pessoas

- introduzido modelo mínimo de pessoa com `id`, `name` e `active`;
- adicionadas funções puras para criar, renomear, arquivar, reativar e filtrar pessoas;
- adicionados testes do domínio de pessoas;
- adicionada gestão visual de pessoas à aplicação;
- arquivo preserva a entidade em vez de a eliminar;
- mantidos fora do modelo cargos, contratos, disponibilidade, folgas e turnos.

## 2026-10-22 — Ponto 1 fechado

- calendário operacional considerado funcionalmente concluído;
- melhorias de múltiplos intervalos, validação adicional e persistência passam para backlog;
- próximo conceito do motor será definido antes de nova implementação.

## 2026-10-22 — Refinamento visual e seleção de horas

- substituída a introdução manual de horas por dropdowns em intervalos de 15 minutos;
- fecho disponível apenas depois da hora de abertura;
- seleção automática de um fecho válido quando a abertura muda;
- reorganizada a grelha semanal em colunas Dia / Estado / Abertura / Fecho;
- simplificados os indicadores de resumo;
- refinado o painel de exceções e os estados aberto/fechado.

## 2026-10-22 — Calendário operacional contínuo

- removido o conceito de período de planeamento global;
- mantido o padrão semanal de funcionamento como configuração contínua;
- mantidas exceções por data;
- atualizado o núcleo para resolver horários por data;
- reorganizada a interface para um painel de configuração mais profissional;
- adicionados indicadores de resumo semanal;
- documentação alinhada com a nova decisão.

## 2026-10-22 — Reinício pelo Ponto 1

- removido o protótipo de pessoas e turnos A/B/C;
- removidos gerador e validador do V0 anterior;
- introduzido horário semanal de funcionamento;
- introduzidas exceções por data;
- criada resolução do calendário operacional;
- interface reduzida à configuração temporal;
- documentação alinhada com a nova fundação.
