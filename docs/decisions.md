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
