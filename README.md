# Schedule Engine — V1

Motor independente de geração e validação de horários. A interface React e o
Supabase existem para configurar, executar e guardar o trabalho do motor — não
definem o algoritmo.

## O caminho principal (ler por esta ordem)

| Função | Ficheiro |
| --- | --- |
| Entrada da aplicação e configuração | `src/App.tsx` |
| Ecrã de geração | `src/components/ConstrainedPeriodGeneratorPanel.tsx` |
| Pesquisa de horários | `src/utils/constrainedPeriodGenerator.ts` |
| Pesquisa de turnos e refeições de cada dia | `src/utils/mealAwareDayGenerator.ts` |
| Certificação independente | `src/utils/finalScheduleCertification.ts` |
| Limites de trabalho e descanso | `src/utils/workConstraints.ts` |
| Cobertura mínima em cada intervalo | `src/utils/workCoverage.ts` |
| Disponibilidade dos colaboradores | `src/utils/availability.ts` |
| Propostas imutáveis | `src/persistence/supabaseGeneratedScheduleRepository.ts` |
| Calendário e consulta do arquivo | `src/components/ScheduleHome.tsx` |

O fluxo é: **configurar → gerar → certificar → guardar proposta → consultar**.
Uma proposta guardada não é automaticamente um horário oficialmente aprovado.

## Regras essenciais

- **Hard constraints**: cobertura mínima durante o funcionamento, disponibilidades,
  vínculos, máximo diário e semanal, refeições e descanso entre turnos.
- **Soft constraints**: preferências de distribuição e objetivo semanal, quando a
  empresa não os definiu como obrigatórios.
- **Sem turno não significa folga**: um dia ainda não planeado não pode ser
  apresentado como folga atribuída.
- Abertura contínua da empresa não elimina a refeição individual dos colaboradores;
  a cobertura tem de se manter enquanto alguém está em pausa.
- Alterações a propostas criam versões novas; o arquivo anterior permanece consultável.

## Limitações conhecidas nesta transição V1

1. A geração certificada suporta, atualmente, até **28 dias** por proposta.
   Um mês de 31 dias exige nova capacidade com validação de semanas e descansos
   que atravessam as fronteiras do mês.
2. O contrato semanal é um **máximo obrigatório**, mas o objetivo semanal é
   **soft**. A V1 ainda tem de suportar a exigência expressa de 40h efetivas
   semanais para cada colaborador e validá-la independentemente.
3. A aprovação oficial depende de **histórico verificado** e não deve ser
   inferida de propostas guardadas. A respetiva segurança, migrações e
   rastreabilidade são preservadas durante a simplificação.

A auditoria de dezembro de 2026 usa oito colaboradores, segunda a sexta das
09:00 às 19:00, folga ao fim de semana e mínimo de uma pessoa em cada intervalo.
Não considerar o resultado mensal certificado enquanto os pontos 1 e 2 não estiverem resolvidos.

## Utilizar o projeto

Requer Node.js 22 e Supabase com autenticação configurada.

```bash
npm ci
cp .env.example .env.local
# Preencher VITE_SUPABASE_URL e a chave pública no .env.local.
npm run dev
```

Nunca colocar service_role nem chaves secretas no frontend.

As rotas principais são `/horarios` (calendário), `/horarios/gerar`
(geração), `/operacao` (funcionamento), `/operacao/cobertura` (presença),
`/equipa` (pessoas), `/equipa/disponibilidades` (disponibilidade) e
`/regras` (limites). `/horarios/AAAA-MM-DD` abre a vista diária.

## Verificar antes de integrar alterações

```bash
npm run audit:v1          # mapa do que é usado na aplicação e apenas em testes
npm test                  # contratos, segurança e regressões do motor
npm run typecheck
npm run build
npm run audit:dependencies
```

O GitHub Actions também executa verificações WebKit e testes das migrações
num ambiente descartável. Os testes automáticos não substituem uma validação
final na conta de ensaio.

## Estado dos dados e documentação antiga

O esquema ativo utiliza doze ficheiros versionados de migração:
**quatro identificadores históricos reconstruídos e seis migrações PR47**,
mais duas
migrações posteriores de classificação e vínculo temporal. O histórico de
alterações e de propostas é preservado; não apagar migrações antigas só porque
o modelo de interface V1 é mais simples. Consultar
[setup do Supabase](docs/supabase-setup.md) antes de qualquer atualização
da base.

Os relatórios e decisões das fases anteriores continuam arquivados em
[docs/](docs/). Não são o percurso recomendado para começar a desenvolver a V1.

**Método:** decisão → implementação → teste → validação → próxima decisão.
