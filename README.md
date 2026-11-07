# Schedule Engine

Motor de geração e validação de horários, concebido como núcleo de scheduling
**independente de qualquer empresa, interface ou base de dados**.

## Estado da aplicação

A `main` contém a versão aprovada do PR #46. As melhorias de consistência
dos checkpoints A–F, incluindo a preparação de aceitação, encontram-se **em revisão no PR #47**, ainda sem merge.

O fluxo operacional ativo inclui:

- **Calendário mensal** com resumo por dia, indicadores e acesso à gestão
  diária (equipa, pesquisa, filtros, seleção persistente entre páginas).
- **Gerador condicionado** de propostas para períodos inclusivos de **até
  14 dias**, com validação independente de hard constraints.
- **Disponibilidade e operação** por padrão semanal, exceções e mínimos de
  cobertura de abertura, período central e fecho.
- **Regras de trabalho**: limites diários/semanais, descanso e refeições,
  incluindo contabilização de horas efetivas.
- **Arquivo de propostas** persistidas no Supabase, consultáveis após
  encerrar e reabrir a aplicação, sem regeneração.

No PR #47, foram acrescentados contratos semanais individuais (limites
**hard**), objetivos semanais (**soft**), datas de trabalho obrigatórias,
fuso horário IANA por operação e uma **referência contabilística de ciclos
de 28 dias**. O modelo de ciclos não é um gerador de 28 dias; o limite
de geração continua em 14 dias até existir validação integral.

### Não confundir proposta com aprovação

Uma proposta válida e guardada **não constitui um horário oficialmente
aprovado**. O calendário pode apresentar propostas distintas em dias
consecutivos; o panorama indica essa proveniência e permite selecionar
uma única proposta para consulta, sem a tratar como escala combinada
certificada.

Os componentes históricos de aprovação subsistem como **código de domínio
e testes**, sem ligação ao fluxo operacional ativo. O serviço antigo
`official-schedules` no Supabase foi inventariado no Checkpoint D, mas
**não foi desativado nem alterado**.

## Instalação e execução

Requer **Node.js 22** (também utilizado pelo GitHub Actions) e um projeto
Supabase dedicado, com autenticação.

1. Consultar [configuração e migrações do Supabase](docs/supabase-setup.md).
2. Copiar `.env.example` para `.env.local` e preencher apenas URL e
   **publishable key**. Não colocar credenciais privilegiadas no frontend.
3. Instalar o lockfile e iniciar o servidor de desenvolvimento:

   ```bash
   npm ci
   npm run dev
   ```

A configuração é guardada com controlo de revisão no Supabase; propostas
válidas são arquivadas como snapshots imutáveis. A primeira importação
de dados antigos do navegador requer confirmação explícita de titularidade.

## Verificações

```bash
npm test
npm run typecheck
npm run build
npm run audit:dependencies
```

O `npm test` inclui testes do algoritmo, certificação final, regras,
contratos, calendário, arquivo, concorrência, persistência e segurança.
O teste de arquitetura impede a reintrodução acidental de laboratórios de
aprovação na interface. A auditoria npm verifica dependências de produção
e apresenta os avisos do ambiente de desenvolvimento separadamente.

A revisão manual de cenários reais e os testes funcionais no Safari
continuam indispensáveis antes de qualquer merge importante.
O [protocolo de aceitação PR #47](docs/pr47-acceptance.md) descreve
os testes reproduzíveis, incluindo a edição completa de períodos de
operação/disponibilidade, o arquivo e o ensaio read-only de isolamento RLS
com duas contas num projeto de staging. O ensaio RLS tem de ser executado
manualmente; não faz parte de `npm test`.

## Arquitetura e controlo de alterações

- `src/utils/`: domínio, geração, validação, regras e cálculos.
- `src/components/`: interface React de consulta e geração.
- `src/persistence/`: adaptadores de estado e arquivo (Supabase).
- `src/application/`: experiências históricas de fronteira de
  confiança, **não ligadas à interface atual**.
- `supabase/migrations/`: SQL histórico; **não executar `db push` na
  instância existente sem reconciliação**, devido à divergência confirmada.
- `supabase/audit/` e `supabase/rollback/`: inventário read-only e
  fontes preservadas para recuperar a função antiga.

A versão estável do PR #46 está marcada na branch Git
`safety/pr46-baseline`. O PR #47 é desenvolvido numa única branch,
com checkpoints separados, e só será integrado depois da auditoria final.

Documentação de referência: [arquitetura](docs/architecture.md),
[matriz das 23 observações](docs/audit-pr47.md) e
[baseline técnica Supabase](docs/supabase-deployment-baseline-pr47.md).

**Princípio de desenvolvimento:** decisão → implementação → teste →
validação → próxima decisão.
