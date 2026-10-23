# Roadmap

## Ponto 1 — Calendário operacional

Estado: **fechado**

- [x] horário semanal editável;
- [x] dias fechados;
- [x] exceções por data;
- [x] resolução do horário efetivo de uma data;
- [x] calendário contínuo sem janela global;
- [x] testes básicos;
- [x] interface em formato de painel;
- [x] seleção de horas por dropdown;
- [x] persistência automática através da aplicação.

### Melhorias futuras não bloqueantes

- múltiplos intervalos por dia na interface;
- validação adicional de intervalos inválidos ou sobrepostos;
- controlo de permissões na aplicação consumidora.

## Ponto 2 — Pessoas

Estado: **fechado**

- [x] modelo mínimo `Person`;
- [x] identificador estável;
- [x] nome;
- [x] estado ativa/arquivada;
- [x] criação;
- [x] edição de nome;
- [x] arquivo sem eliminação física;
- [x] reativação;
- [x] filtro de pessoas ativas;
- [x] testes básicos;
- [x] interface de gestão;
- [x] persistência automática.

## Ponto 3 — Disponibilidade

Estado: **fechado**

- [x] disponibilidade semanal por pessoa;
- [x] zero intervalos significa indisponível;
- [x] exceções por data;
- [x] resolução da disponibilidade efetiva de uma data;
- [x] verificação se um intervalo está totalmente dentro da disponibilidade;
- [x] disponibilidade tratada como hard constraint;
- [x] interseção com o calendário operacional;
- [x] bloqueio de disponibilidade em dias de operação fechada;
- [x] horas de disponibilidade limitadas ao horário operacional;
- [x] interface em separador próprio;
- [x] seleção de pessoa ativa;
- [x] persistência automática;
- [x] migração automática do estado persistido v1 para v2;
- [x] testes básicos.

### Fora do Ponto 3

- férias;
- baixas;
- ausências tipificadas;
- horas semanais máximas;
- descanso entre períodos;
- preferências;
- cobertura necessária;
- geração de horários.

## Ponto 4 — Regras de trabalho e turnos contínuos

Estado: **fechado**

- [x] duração padrão de turno configurável;
- [x] ausência de duração tratada como configuração incompleta;
- [x] um turno diário é um único intervalo contínuo;
- [x] turnos repartidos ficam fora do modelo atual;
- [x] cálculo de turno de abertura;
- [x] cálculo de turno de fecho;
- [x] validação contra o calendário operacional;
- [x] validação contra disponibilidade da pessoa;
- [x] operação com interrupções não pode ser atravessada por um turno contínuo;
- [x] dias mais curtos do que a duração padrão ajustam o turno ao funcionamento disponível;
- [x] interface própria;
- [x] persistência automática;
- [x] migração automática v2 → v3;
- [x] testes básicos.

### Fora do Ponto 4

- número mínimo de pessoas na abertura;
- número mínimo de pessoas no fecho;
- cobertura ao longo do dia;
- contratos e horas semanais;
- pausas;
- descanso entre dias;
- preferências;
- geração automática de horários.

## Próximo ponto

Depois de validarmos o Ponto 4, definir requisitos de presença na abertura e no fecho.
