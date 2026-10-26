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

Estado: **fechado (2026-10-26)**

- [x] três mínimos obrigatórios: abertura, durante a operação, fecho;
- [x] mínimos inteiros não negativos e independentes, aplicados em janelas de 30 minutos;
- [x] configuração 1 / 2 / 1 válida e sobreposição de extremos em dias curtos;
- [x] mínimos são limites inferiores, nunca tetos nem objetivos de pessoal exato;
- [x] padrão semanal com dias fechados isentos de exigência;
- [x] exceções por data substituem integralmente o padrão;
- [x] zero explícito é diferente de não configurado;
- [x] exceções duplicadas e requisitos incoerentes detetados;
- [x] validador de presença sobre turnos contínuos propostos;
- [x] validador percorre a operação completa e deteta lacunas intermédias;
- [x] pré-verificação de pessoas disponíveis em cada parte do dia, sem afirmar viabilidade global;
- [x] mesmas pessoas podem satisfazer abertura e fecho num dia curto;
- [x] interface em cartões compactos;
- [x] persistência v4 com migração dos estados v1, v2 e v3;
- [x] testes básicos de domínio e persistência;
- [x] CI de testes, typecheck e build nos PRs.

### Fora do Ponto 5

- estudo de afluência;
- curva de cobertura por intervalos horários;
- maximização da sobreposição no período central;
- geração de turnos e atribuições;
- contratos, horas semanais e pausas;
- validação integral de viabilidade do horário.

## Ponto 6 — Gerador de horários V0

Estado: **em desenvolvimento**

### Etapa 6.1 — Gerador diário puro

- [x] entrada explícita e resultado tipificado com diagnósticos;
- [x] candidatos determinísticos de um turno contínuo por pessoa ativa e por dia;
- [x] duração padrão preservada, exceto em períodos operacionais mais curtos;
- [x] pesquisa discreta de 15 minutos mais limites horários exatos, com limite de nós;
- [x] seleção progressiva por número mínimo de pessoas, sem otimização da equidade;
- [x] verificação independente de cobertura e disponibilidade antes de publicar solução;
- [x] distinguir input inválido, capacidade insuficiente, pesquisa sem solução e limite atingido;
- [x] testes de domínio (dias longos, curtos, partidos, arquivo, casos impossíveis na grelha);
- [x] executar CI, typecheck e build do núcleo;
- [x] interface experimental para selecionar uma data e visualizar turnos e conflitos;
- [x] simulação efémera: nunca guardar turnos nem alterar configurações no Supabase;
- [x] ignorar resultados anteriores quando mudam data, pessoas ou regras;
- [x] validar manualmente a interface com dados reais: capacidade insuficiente, sem solução com turnos de 8h, horário válido para sábado de 4h e recuperação dos requisitos após remoção de exceção;

### Limites explícitos V0

- Pesquisa discreta de duração fixa: não encontrar solução não prova impossibilidade global.
- Não existem turnos repartidos nem atribuições multi-dia.
- Ainda sem equidade, contratos, horas semanais ou descanso entre dias.
- A interface de geração é apenas uma simulação, sem gravação dos turnos.

## Próximo passo

Rever e integrar a etapa 6.1 na main após aprovação do PR. Depois iniciar a modelação e validação de horários de vários dias, sem introduzir ainda regras de distribuição que não estejam definidas.
