# Decisões

## D001 — Schedule Engine é independente de qualquer empresa

**Estado:** aceite

Horários de funcionamento e regras específicas entram como dados/configuração.

## D002 — O calendário operacional é contínuo

**Estado:** aceite

Não existe uma janela global de planeamento no núcleo.

O padrão semanal e as exceções existem ao longo do tempo. Quando for necessário gerar ou consultar um horário para um intervalo específico, essa janela será fornecida pela operação que fizer o pedido.

## D003 — O horário de funcionamento é configuração

**Estado:** aceite

Cada dia da semana pode ter zero ou mais intervalos de funcionamento.

Zero intervalos significa dia fechado.

## D004 — Exceções por data substituem o padrão semanal

**Estado:** aceite

Uma data específica pode ter um horário diferente ou estar fechada, independentemente do padrão semanal.

## D005 — Autorização não pertence ao motor

**Estado:** aceite

Quem pode alterar o horário de funcionamento é uma decisão da aplicação consumidora.

O Schedule Engine recebe a configuração e trabalha com ela.

## D006 — Construção incremental

**Estado:** aceite

Só introduzir novos conceitos quando o anterior estiver implementado e compreendido.

## D007 — Pessoa começa com um modelo mínimo

**Estado:** aceite

Uma pessoa contém apenas `id`, `name` e `active`.

Função, contrato, disponibilidade e restantes atributos não entram no modelo antes de existir uma necessidade concreta do motor.

## D008 — Pessoas são arquivadas, não eliminadas como fluxo normal

**Estado:** aceite

Uma pessoa que deixe de participar em horários futuros permanece identificável no sistema.

`active: false` retira-a de novas escalas sem destruir a entidade.

Datas de entrada/saída poderão substituir este booleano no futuro se o histórico exigir maior precisão.

## D009 — Persistência é uma porta da aplicação

**Estado:** aceite

O Schedule Engine não lê nem escreve diretamente em `localStorage`, bases de dados ou APIs.

A aplicação depende de um contrato assíncrono de persistência.

A implementação inicial usa `localStorage`, mas pode ser substituída por uma implementação remota sem alterar o domínio.

O estado persistido é versionado para permitir evolução controlada do formato.

## D010 — Disponibilidade é uma hard constraint

**Estado:** aceite

Uma pessoa não poderá ser escalada fora dos intervalos em que está disponível.

Zero intervalos num dia significa indisponível nesse dia.

## D011 — Disponibilidade segue padrão semanal com exceções

**Estado:** aceite

Cada pessoa pode ter um padrão semanal recorrente.

Uma exceção por data substitui integralmente o padrão semanal nessa data.

## D012 — Intervalos temporais são um conceito genérico

**Estado:** aceite

`TimeInterval` representa um intervalo temporal reutilizável.

Calendário operacional e disponibilidade usam o mesmo conceito base, evitando duplicação de modelos equivalentes.

## D013 — Evolução de persistência exige migração

**Estado:** aceite

A introdução de novos dados persistidos não deve fazer desaparecer dados existentes.

A versão 2 do estado adiciona disponibilidades e migra automaticamente o formato v1.

## D014 — Disponibilidade é limitada pelo calendário operacional

**Estado:** aceite

Disponibilidade da pessoa e funcionamento da operação são hard constraints independentes.

O intervalo efetivamente escalável é a interseção entre ambos.

Uma pessoa nunca pode ser escalada num dia em que a operação está fechada, nem fora do horário operacional.

A UI impede configurações obviamente impossíveis, mas o núcleo também aplica a interseção para garantir correção perante dados antigos ou incoerentes.

## D015 — Cobertura é uma hard constraint da operação

**Estado:** aceite

A cobertura define o número mínimo de pessoas necessário em cada período operacional.

O motor não deve considerar uma solução válida se não cumprir a cobertura mínima configurada.

## D016 — Cobertura ausente não significa zero pessoas

**Estado:** aceite

Um período operacional sem requisito de cobertura é configuração incompleta.

`minimumPeople: 0` representa explicitamente que zero pessoas são necessárias nesse período.

Esta distinção evita horários aparentemente válidos produzidos por falta de configuração.

## D017 — Cobertura é limitada pelo calendário operacional

**Estado:** aceite

Não existe cobertura efetiva quando a operação está fechada.

Cada requisito de cobertura deve estar integralmente dentro de um intervalo operacional.

Alterações posteriores ao calendário podem tornar cobertura existente inválida; esses dados são preservados e sinalizados em vez de serem apagados silenciosamente.

## D018 — Requisitos de cobertura não se sobrepõem

**Estado:** aceite

Dois requisitos de cobertura sobrepostos representam uma configuração ambígua e devem ser sinalizados como inválidos.

Períodos adjacentes são permitidos.

## D019 — Cobertura segue padrão semanal com exceções

**Estado:** aceite

A cobertura tem um padrão semanal recorrente e pode ter exceções por data.

Uma exceção substitui integralmente o padrão semanal nessa data.

## D020 — Persistência v3 adiciona cobertura

**Estado:** aceite

A versão 3 do estado persistido adiciona cobertura semanal e exceções de cobertura.

Estados v2 são migrados automaticamente sem alterar calendário, pessoas ou disponibilidades.
