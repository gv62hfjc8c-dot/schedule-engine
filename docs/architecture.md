# Arquitetura

## Estado atual

O Schedule Engine está intencionalmente reduzido ao calendário operacional contínuo.

### Tipos

`src/types.ts` contém:

- `OperatingInterval`
- `WeeklyOperatingHours`
- `OperatingHoursException`
- `OperatingCalendarConfiguration`

### Calendário operacional

`src/utils/operatingCalendar.ts` contém funções puras para:

- descobrir o dia da semana de uma data;
- resolver o horário efetivo de uma data;
- aplicar exceções sobre o padrão semanal.

Não existe um período global de planeamento.

A configuração existe continuamente ao longo do tempo. Um intervalo temporal futuro será responsabilidade da operação que consultar ou gerar horários, não da configuração base do motor.

### Interface

`src/App.tsx` é uma ferramenta visual para editar e observar esta configuração.

A UI não é o motor.

## Limites

O núcleo não decide quem pode editar a configuração.

Permissões, autenticação e papéis de utilizador pertencem à aplicação que consumir o Schedule Engine.

## Regra arquitetural

Não adicionar o próximo conceito do domínio antes de o atual estar claro, testado e utilizável.
