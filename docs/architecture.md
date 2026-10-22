# Arquitetura

## Estado atual

O Schedule Engine está intencionalmente reduzido à fundação temporal do domínio.

### Tipos

`src/types.ts` contém:

- `SchedulePeriod`
- `OperatingInterval`
- `WeeklyOperatingHours`
- `OperatingHoursException`
- `ScheduleConfiguration`

### Calendário operacional

`src/utils/operatingCalendar.ts` contém funções puras para:

- expandir um período em datas;
- descobrir o dia da semana de uma data;
- resolver o horário efetivo de uma data;
- aplicar exceções sobre o horário semanal padrão.

### Interface

`src/App.tsx` é apenas uma ferramenta visual para editar e observar esta configuração.

A UI não é o motor.

## Limites

O núcleo não decide quem pode editar a configuração.

Permissões, autenticação e papéis de utilizador pertencem à aplicação que consumir o Schedule Engine.

## Regra arquitetural

Não adicionar o próximo conceito do domínio antes de o atual estar claro, testado e utilizável.
