# Decisões

## D001 — Schedule Engine é independente de qualquer empresa

**Estado:** aceite

Horários de funcionamento e regras específicas entram como dados/configuração.

## D002 — O período de planeamento é explícito

**Estado:** aceite

O motor não assume automaticamente uma semana, cinco dias úteis ou um mês.

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
