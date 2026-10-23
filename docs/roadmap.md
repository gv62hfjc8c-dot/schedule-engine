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

## Ponto 5 — Requisitos mínimos de presença

Estado: **em validação**

- [x] três mínimos obrigatórios: abertura, durante a operação, fecho;
- [x] mínimos inteiros não negativos, com abertura e fecho ≥ mínimo operacional;
- [x] mínimos são limites inferiores, nunca tetos nem objetivos de pessoal exato;
- [x] padrão semanal com dias fechados isentos de exigência;
- [x] exceções por data substituem integralmente o padrão;
- [x] zero explícito é diferente de não configurado;
- [x] exceções duplicadas e requisitos incoerentes detetados;
- [x] validador de presença sobre turnos contínuos propostos;
- [x] validador percorre a operação completa e deteta lacunas intermédias;
- [x] mesmas pessoas podem satisfazer abertura e fecho num dia curto;
- [x] interface em cartões compactos;
- [x] persistência v4 com migração dos estados v1, v2 e v3;
- [x] testes básicos de domínio e persistência.

### Fora do Ponto 5

- estudo de afluência;
- curva de cobertura por intervalos horários;
- maximização da sobreposição no período central;
- geração de turnos e atribuições;
- contratos, horas semanais e pausas;
- validação integral de viabilidade do horário.

## Próximo ponto

Validar o Ponto 5 em casos reais antes de escolher a próxima regra de scheduling.
