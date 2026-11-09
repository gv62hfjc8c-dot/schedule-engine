# Schedule Engine

Motor de geração e validação de horários, concebido como núcleo de scheduling
**independente de qualquer empresa, interface ou base de dados**.

## Estado da aplicação

A `main` contém o PR #48 integrado, incluindo classificação de ocorrências
históricas. Os vínculos com validade temporal, a revisão de refeições e a
certificação histórica por datas de entrada/saída estão em desenvolvimento
num PR seguinte, sem importação de dados reais.

O fluxo operacional ativo inclui:

- **Calendário mensal** com resumo por dia, indicadores e acesso à gestão
  diária (equipa, pesquisa, filtros, seleção persistente entre páginas).
- **Gerador condicionado** com validação independente de hard constraints.
  O núcleo e a interface do PR #47 suportam até **28 dias**; a migração
  de arquivo correspondente já foi aplicada no Supabase do projeto.
- **Disponibilidade e operação** por padrão semanal, exceções e mínimos de
  cobertura de abertura, período central e fecho.
- **Regras de trabalho**: limites diários/semanais, descanso e refeições,
  incluindo contabilização de horas efetivas.
- **Arquivo de propostas** persistidas no Supabase, consultáveis após
  encerrar e reabrir a aplicação, sem regeneração.

No PR #47, foram acrescentados contratos semanais individuais (limites
**hard**), objetivos semanais (**soft**), datas de trabalho obrigatórias,
fuso horário IANA por operação, ciclos contabilísticos fixos de 28 dias,
**geração de 28 dias testada no núcleo** e disponibilidade por pessoa.
As qualificações podem ser exigidas na cobertura e são validadas também
nas pausas. A interface aceita 28 dias; a geração e recuperação da proposta de 02–29/11/2026 foram confirmadas no Safari em 09/11/2026 e numa consulta read-only ao Supabase. A transição contabilística para 30/11 também passou numa execução automatizada WebKit.

### Não confundir proposta com aprovação

Uma proposta válida e guardada **não constitui um horário oficialmente
aprovado**. O calendário pode apresentar propostas distintas em dias
consecutivos; o panorama indica essa proveniência e permite selecionar
uma única proposta para consulta, sem a tratar como escala combinada
certificada.

O serviço de aprovação oficial v2 está publicado, e a interface consulta a prontidão através de sessão autenticada. A aprovação permanece bloqueada quando falta histórico verificado por pessoa/dia. Os laboratórios antigos não estão ligados à interface; as regras e testes de domínio permanecem. O serviço antigo
`official-schedules` no Supabase foi substituído pela versão inerte
v6 (HTTP 410), com fonte v5 preservada para recuperação.


Os vínculos temporais serão guardados por pessoa no estado de configuração.
Para pessoas com vínculos explícitos, o gerador não pode atribuir turnos fora
das respetivas datas. Uma conta antiga sem datas mantém compatibilidade na
simulação, mas **não pode certificar o histórico oficial** até ter vínculos
explicitamente declarados e verificados.

O editor de refeições cria uma **nova proposta imutável** após revalidar
cobertura, descanso e limites, sem alterar a versão anteriormente arquivada.

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

A configuração é guardada com controlo de revisão no Supabase.
Duas abas conseguem conciliar alterações independentes por comparação
de três versões; edições concorrentes incompatíveis são bloqueadas,
permitindo exportar uma cópia e recuperar o estado remoto. Propostas
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
com duas contas num projeto de staging. O ensaio RLS com contas reais de teste foi executado diretamente no Supabase,
sem modificar dados, e os testes SQL de isolamento estão na CI. Os testes
interativos WebKit utilizam um backend sintético e não substituem uma sessão Safari real.

## Arquitetura e controlo de alterações

- `src/utils/`: domínio, geração, validação, regras e cálculos.
- `src/components/`: interface React de consulta e geração.
- `src/persistence/`: adaptadores de estado e arquivo (Supabase).
- `src/application/`: contratos e serviços confiáveis de aprovação oficial,
  com execução no serviço Edge, sem dar ao cliente acesso privilegiado.
- `supabase/migrations/`: quatro identificadores históricos reconstruídos
  e seis migrações PR47 **aplicadas** (dez versões no Supabase), mais uma
  migração **integrada no PR48 mas ainda não aplicada à instância operacional**
  para classificar `worked`, `day_off`, `vacation` e `holiday`, e uma
  migração de verificação histórica por vínculo ainda em revisão
  (doze ficheiros versionados; dez já aplicados). A cadeia completa
  é reconstruída num PostgreSQL 17 descartável na CI. **Não executar `db push` na produção** sem
  verificar histórico, backup/restauro e operações de rollout.
- `supabase/audit/` e `supabase/rollback/`: inventário read-only e
  fontes preservadas para recuperar a função antiga.

A versão estável do PR #46 mantém-se preservada em
`safety/pr46-baseline`. O PR #47 foi integrado na `main`; o PR #48
não importa nem altera horários históricos reais.

Documentação de referência: [arquitetura](docs/architecture.md),
[matriz das 23 observações](docs/audit-pr47.md) e
[baseline técnica Supabase](docs/supabase-deployment-baseline-pr47.md).

**Princípio de desenvolvimento:** decisão → implementação → teste →
validação → próxima decisão.
