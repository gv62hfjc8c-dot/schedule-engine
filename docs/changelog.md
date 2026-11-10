## 2026-11-10 — PR58 · Página de autenticação responsiva

- Reformulado o login do Schedule Engine com identidade visual própria, painel de apresentação em desktop e formulário adaptado a tablets e telemóveis.
- Campos de email e palavra-passe com foco acessível, botão principal, estado de autenticação e controlo Mostrar/Ocultar palavra-passe.
- Retiradas do ecrã do cliente as instruções internas «Authentication → Users» do Supabase.
- Mensagens de credenciais incorretas em português compreensível, mantendo erros de infraestrutura visíveis sem os mascarar.
- Nenhum formulário fictício para registo ou recuperação de palavra-passe: essas capacidades exigem implementação e validação próprias.
- Mantida a autenticação Supabase existente e o isolamento de dados por conta; sem alterações ao modelo de utilizadores, regras, horários ou base de dados.
- Aceitação WebKit valida login inválido, alternância da palavra-passe, ausência de instruções internas e ausência de scroll horizontal em ecrã móvel.

## 2026-11-10 — PR57 · Gestão diária redesenhada após validação de ecrãs

- O cabeçalho da gestão diária reúne data, estado da proposta, navegação e geração, com detalhe de leitura disponível numa secção expansível.
- Os cinco indicadores ficam compactos e visíveis; nenhum estado desconhecido é convertido automaticamente numa folga ou ausência.
- Pesquisa e seis filtros existentes preservados, com acesso rápido a equipa, escalados, disponíveis e indisponíveis; «Por planear / sem escala» e «Selecionados» ficam em «Mais filtros».
- Lista mais compacta em computador e responsiva em tablet/telemóvel. Paginação aparece apenas quando é necessária (mais de 12 colaboradores no filtro).
- Seleção múltipla ganha comparação contextual por colaborador: turno, refeição, horas efetivas e estado, sem repetir apenas nomes e sem alterar a proposta guardada.
- Preservados seleção entre filtros/páginas, versões imutáveis, semântica de indisponibilidade, separação entre histórico factual e proposta, e bloqueio de alterações oficiais.
- Adicionados testes WebKit sobre indicadores, filtros, seleção, comparação e ausência de paginação desnecessária.

## 2026-11-10 — PR56 · navegação real nas etapas do gerador

- Corrigido o passo 3 «Consultar», que anteriormente parecia um botão mas era apenas um indicador visual; agora é um botão funcional que abre a visualização da proposta válida.
- Os passos 1 e 2 também são controlos com navegação, foco de teclado e estado desativado quando o respetivo resultado ainda não existe.
- A etapa 3 só fica disponível para uma simulação com estado `generated`; mantém-se a diferença entre proposta gerada, gravação e aprovação oficial.
- Sem alterações ao algoritmo, aos critérios de validação, à persistência ou a dados importados.
- Testes WebKit verificam a acessibilidade das etapas e o bloqueio de consulta sem proposta.

## 2026-11-10 — PR55 · experiência de geração de horários

- Introduzido percurso visual de três etapas: preparação das datas e contexto, simulação com diagnóstico, e consulta da proposta.
- Seletores rápidos de 7, 14 ou 28 dias alteram apenas as datas e invalidam a declaração exterior anterior; não executam a geração automaticamente.
- Apresentados estado de prontidão e resumo de resultados com métricas condicionais: turnos só se a solução estiver validada. Regras técnicas e notas detalhadas consultáveis sem dominarem o ecrã.
- Preservadas as confirmações obrigatórias, os limites do motor, a proteção de períodos oficialmente aprovados, o outbox de recuperação, a gravação de propostas imutáveis e a revisão de refeições.
- Componentes adaptados para portátil, tablet e telemóvel. Aceitação WebKit confirma que presets não contornam o bloqueio por contexto por confirmar.
- Nenhuma alteração ao algoritmo de geração, regras, Supabase ou modelo de dados.

## 2026-11-10 — Gestão diária: consulta por pessoa e refeições

- Redesenhada a consulta diária com cartões por colaborador e campos separados para presença, intervalo de refeição e horas efetivas.
- Conservada a semântica de turno contínuo com uma única pausa; sem fabricação de folgas a partir de turnos ausentes.
- Navegação anterior/seguinte limitada ao mês carregado para evitar mostrar datas de histórico ainda não verificadas.
- Consulta diária de propostas com várias versões permite escolher um snapshot guardado, sem o alterar.
- Estados históricos e propostas mantêm rótulos distintos; a interface diária continua somente de consulta. Edição de propostas arquivadas e aprovações exigem os fluxos controlados existentes.
- Testes de apresentação e de WebKit cobrem os novos elementos sem modificar dados nem SQL.

## 2026-11-10 — Calendário mensal: experiência visual v2

- Reorganizado o ecrã do calendário para priorizar a grelha mensal: informações gerais resumidas com explicação detalhada opcional; avisos de erro e dados incompatíveis permanecem sempre visíveis.
- Consolidado o aviso de panorama com propostas independentes e sobreposições, sem fingir que existe uma escala mensal aprovada.
- Acrescentados indicadores mensais para dias com propostas, histórico factual, dias por planear, encerrados e por confirmar. Dados não carregados ou desconhecidos **não** são contabilizados como folgas ou ausência de planeamento.
- Melhoradas tipografia, espaços, sinalizadores de estado, leitura do calendário e comportamento em tablets/telemóveis.
- Mantida a distinção entre propostas, histórico factual e aprovações; sem alterações no scheduling core, nas regras ou nos registos do Supabase.
- Testes de regressão em WebKit incluem informação recolhível, métricas do mês e largura móvel.

## 2026-11-09 — Application Shell responsiva

- Substituídos os quatro separadores horizontais e o cabeçalho excessivamente alto por navegação lateral persistente, cabeçalho compacto e localização da área atual.
- No tablet e telemóvel, navegação em painel recolhível com controlo acessível; o conteúdo preserva a mesma lógica operacional e os mesmos dados.
- Mantidas as sete vistas existentes (calendário, geração, operação, presença, pessoas, disponibilidades e regras), sem alterar o algoritmo, a persistência, as aprovações ou os factos históricos.
- Sem declarar PWA ou aplicação nativa implementadas: esta entrega cobre apenas a experiência Web responsiva e a estrutura visual inicial.
- Regressões automatizadas da hierarquia de navegação e da utilização real em WebKit em desktop e telemóvel simulado.

## 2026-11-09 — Consulta de histórico factual no calendário

- Corrigida lacuna entre dados importados nas tabelas `schedule_engine_history_*` e o ecrã mensal, que anteriormente apenas consultava propostas geradas.
- O calendário apresenta dias com ocorrências importadas como **Histórico factual**, não como propostas nem como aprovação oficial. O detalhe do dia mostra os colaboradores, trabalho contínuo, refeição, folga, férias, feriado e nome da fonte.
- A ausência de registo nunca é classificada como folga. O histórico não sobrepõe propostas persistidas nem altera o motor de scheduling, os vínculos ou os registos oficiais.
- Leitura autenticada por proprietário com RLS; regressões de integridade e apresentação sem escrita.
- A importação factual de janeiro já tinha sido executada na base de dados; esta alteração integra apenas a **consulta na interface**, sem nova importação.

## 2026-11-09 — Rollout histórico Supabase PR48/PR49

- Aplicadas as duas migrações históricas à instância operacional após pré-verificação de 0 fontes, 0 factos e 0 ledgers oficiais.
- Atribuídos pelo Supabase os números efetivos `20261109230651` (classificação) e `20261109230719` (verificador de vínculo), agora refletidos nos nomes dos ficheiros para preservar a linhagem.
- Confirmados `occurrence_type NOT NULL`, duas constraints de classificação, RPC acessível apenas ao serviço privilegiado, 15 propostas preservadas e 3 estados de configuração preservados.
- Nenhum turno histórico importado, nenhuma aprovação inicializada e nenhuma Edge Function publicada nesta operação.
- Auditoria de segurança: apenas aviso preexistente relativo à proteção de palavras-passe comprometidas, não associado às migrações.

# Changelog

## 2026-11-09 — PR49: vínculos por data e edição da refeição

- Pessoa mantém identificador permanente e períodos de vínculo sem sobreposição;
  entrada/saída não é inferida pela mera presença no Excel.
- Geração e validação final impedem trabalho fora do vínculo.
- Histórico exige cobertura apenas em dias de vínculo e rejeita turnos
  anteriores à entrada ou posteriores à saída.
- Editor permite alterar o início da refeição de uma proposta gerada,
  mantendo o turno contínuo e recertificando todas as hard constraints;
  a alteração cria uma nova proposta em vez de modificar o arquivo.
- Inicialização de histórico oficial passa a exigir períodos de vínculo
  explícitos para todos os colaboradores relevantes. Edge Function lê
  `occurrence_type` e valida evidência no âmbito dos vínculos.
- Não foram importados os Excel, alterados utilizadores reais ou ativadas
  aprovações oficiais. Migrações pendentes de rollout controlado.

## 2026-11-09 — Classificação explícita de ocorrências históricas

- O arquivo de factos históricos por pessoa/dia passa a exigir `occurrence_type`: `worked`, `day_off`, `vacation` ou `holiday`.
- As restrições PostgreSQL impedem trabalho sem turnos e ausências com turnos; ausência de linha mantém-se como desconhecido.
- Testes de migração verificam persistência das classificações, combinações inválidas e impossibilidade de inserir factos sem tipo.
- Regras específicas para Excel janeiro/2026 registadas em `docs/decisions/history-occurrence-classification-2026-11-09.md`.
- Nenhum histórico real importado, nenhum ledger oficial criado e nenhuma aprovação ativada.

## 2026-11-09 — PR47: proteção de períodos aprovados e aceitação final

- Gerador condicionado rejeita pedidos que coincidam com períodos oficialmente aprovados (incluindo dias fechados ou sem turnos).
- UI consulta o ledger do titular antes de gerar; falha de leitura bloqueia em segurança, sem tratar histórico ausente como completo.
- Módulo de leitura isolado preserva o limite arquitetural entre interface e comandos de aprovação; testes de regressão adicionados.
- CI 42639795765 aprovou validate, migration-contract e webkit-acceptance.
- Responsável confirmou no Safari propostas sobrepostas independentes, além dos seis outros cenários funcionais.
- Proteção contra aprovação oficial sobreposta validada automaticamente, **sem ensaio end-to-end com horário oficial real no Safari**.
- Responsável autorizou o merge com limites de evidência expressos, importação histórica posterior e risco Auth Free aceite.

## 2026-11-08 — PR47: versão v3 segura, CAS de configuração e HTTPS real

- API de aprovação `official-schedules-v2` atualizada para v3. Prontidão de aprovação certificada independentemente, fuso e âncora de histórico derivados de dados do servidor; CORS e JWT obrigatórios.
- SQL `20261108234026` aplicado e validado: a aprovação oficial verifica em transação a **mesma revisão da configuração** usada no cálculo, não apenas a versão do ledger; chamada de escrita antiga revogada ao serviço.
- O domínio revalida jornadas curtas integrais e dias de trabalho obrigatório por disponibilidade, além de todas as restrições anteriores. Testes de regressão e `deno check` aprovados.
- Teste HTTP de produção via GitHub Actions validou 401 sem JWT nos dois serviços, em GET/POST, e resposta correta ao preflight CORS.
- Mantidas 8 propostas de três contas, nenhum horário oficial e nenhuma importação histórica; única advertência Supabase: proteção de palavras-passe comprometidas (plano gratuito).


## 2026-11-08 — PR47: publicação segura da API v2 e provas SQL reais

- Publicada Edge Function `official-schedules-v2` v1 (JWT obrigatório, CORS), sem reativar a API antiga v6 e sem criar qualquer horário oficial.
- RLS real ensaiado como `authenticated` para as contas de teste A e B: 1 estado por conta, 1 proposta A e 3 B; sem visibilidade cruzada.
- Ensaio real de CAS com atualização transitória, rejeição de escrita obsoleta (`40001`) e `ROLLBACK` integral.
- Histórico 2026 continua por importar; autorização de aprovação oficialmente bloqueada até à certificação do contexto. Único aviso Supabase remanescente: proteção de passwords comprometidas dependente do plano.


## 2026-11-08 — PR47: histórico verificado e fronteira de aprovação preparada

- Aplicadas as migrações Supabase `20261108141507` (fontes, dias históricos, verificação RLS), `20261108142521` (CAS de revisões oficiais) e `20261108144725` (inicialização de ledger exclusivamente após prova de cada pessoa/dia).
- Bloqueada a inicialização antiga do ledger que declarava indevidamente completo o intervalo 2020–2100. Nenhum registo histórico ou oficial foi fabricado; persistem 4 propostas guardadas.
- Revalidação de aprovação reforçada para 28 dias, ausências, dias obrigatórios, limites contratuais, descanso e turnos históricos sem dupla contagem.
- Reintroduzido o domínio de revisões parciais com versão anterior imutável, motivo administrativo e substituição certificada.
- Serviço de aplicação confiável e endpoint Edge v2 preparados, com pedidos de intenção mínima; UI de aprovação adicionada atrás de feature flag desligada. **Ainda não existe deploy de Edge v2 nem aprovações oficiais operacionais**, porque os horários reais desde janeiro de 2026 foram expressamente adiados para importação posterior.
- CI executa motor, integridade de arquivo, regras, verificação de RLS/SQL, aprovação, revisão, bundle e HTTP simulado; estes ensaios **não substituem** Auth real, Safari e validação de dependências externas.
- PR47 continua em draft, sem merge. Um aviso externo de leaked-password protection continua ativo no plano Supabase gratuito.


## 2026-10-26 — P6.4: restringir escrita de horários aprovados

- D040: apenas o proprietário autenticado solicita aprovação, cancelamento ou substituição;
- RPC de snapshots deixa de conceder `EXECUTE` ao cliente autenticado na migração preparatória;
- escrita permanece bloqueada enquanto não existir um executor confiável com revalidação de domínio;
- sem deployment SQL nem alteração de dados; permissões reais e concorrência ainda por testar.

## 2026-10-26 — P6.4: persistência separada de escalas aprovadas (incremento preparatório)

- teste do núcleo aprovado localmente (`test:approved-schedules`);
- nova migração SQL **ainda não aplicada** para ledgers e histórico de
  horários aprovados, preservando integralmente o estado de configuração v4;
- proposta de armazenamento por utilizador com RLS de SELECT e gravação
  apenas por RPC transacional, com compare-and-swap entre sessões;
- bootstrap sem atestar automaticamente contexto completo e exigência
  de confirmação explícita para primeira atestação;
- repositório de persistência isolado que valida snapshots recebidos,
  bloqueia dados malformados e preserva o resultado desconhecido sem registo;
- testes do adaptador com mock de duas abas, dois proprietários, histórico
  imutável, controlo de versões e confirmação explícita;
- pendente validação real do SQL e de autoridade de regras de domínio
  antes de disponibilizar ações de aprovação em produção.

## 2026-10-26 — P6.4: núcleo independente de aprovação de horários (PR #17)

- introduzidos ledger e horários aprovados com estados `approved`,
  `cancelled`, `superseded`, ID imutável e versão do ledger;
- aprovação explícita com revalidação de cobertura, disponibilidade,
  elegibilidade, refeição, descanso e limites diários/semanais;
- cancelamento histórico sem compromissos ativos; substituição
  transacional em memória, validando antes de desativar a origem;
- consultas de contexto exterior ao período P6.3 a partir dos
  compromissos aprovados, sem assumir zero horas sem contexto completo;
- detetor de versão obsoleta para futura persistência com transação
  e controlo de concorrência;
- testes de conflitos, transições, semanas, descanso, entradas
  inválidas, segurança do histórico e imutabilidade;
- **sem alteração da interface, Supabase ou dados de produção**.

## 2026-10-26 — Ponto 6.3: preview de período com contexto explícito

- terceiro modo experimental na interface para gerar vários dias
  com refeição, descanso de 11h e limite semanal de 40h;
- datas e fuso IANA explícitos, apresentação de pausas e diagnósticos;
- como não há turnos aprovados persistidos, exige-se confirmação
  expressa de inexistência de turnos já atribuídos fora do período
  no intervalo de contexto completo;
- sem confirmação, não há geração global; alteração de dados/datas
  invalida a confirmação e o resultado;
- testes do adaptador de contexto e limites civis, sem suposições de
  horas livres a partir de base de dados vazia;
- mantém os modos de gerador V0, o esquema de persistência e
  os dados do Supabase inalterados.

## 2026-10-26 — Ponto 6.3: gerador de períodos com backtracking (PR #15)

- pesquisa conjunta de turnos diários, refeições e alternativas em dias
  anteriores quando uma escolha não respeita o descanso de 11h;
- limitação a 40h efetivas semanais avaliada durante a pesquisa,
  incluindo turnos conhecidos antes e depois das datas selecionadas;
- pesquisa com limite global de nós, sem reiniciar a cada dia/alternativa,
  e resultado atómico após validação final independente;
- contexto exterior completo confirmado obrigatório para certificar
  dias e semanas, evitando assumir horas inexistentes;
- testes de descanso dentro/fora do período, limites semanais com
  registos anteriores/posteriores, falta de contexto, refeições e
  casos sem alternativas;
- o núcleo é isolado: sem alterações ao gerador da interface ou a
  pessoas, Supabase e persistência.

## 2026-10-26 — Ponto 6.3: gerador diário experimental com refeições (PR #14)

- novo `generateMealAwareDaySchedule` puro e separado do gerador diário anterior;
- turnos com 8h de trabalho efetivo e pausa de refeição de 60min
  representam 9h de presença total;
- pesquisa discreta conjunta de pessoas, horários de início e posições
  de pausa, com cobertura real descontada durante a refeição;
- verificação independente de regras locais e disponibilidade antes
  de devolver uma solução diária;
- geração atómica com estados de insuficiência, pesquisa sem solução
  e limite de nós, sem confundir com prova de impossibilidade;
- testes de cobertura 1/2/1, refeições desfasadas, operação curta
  e partida, arquivados, limites e casos inválidos;
- `validationScope: "daily_work_and_coverage_only"`: sem validação
  de descanso e horas semanais — gerador multi-dia ainda pendente;
- nenhuma alteração à UI, persistência ou dados Supabase.

## 2026-10-26 — Ponto 6.3: modelo de trabalho efetivo e validadores independentes

- aprovados 8h efetivas diárias, máximo de 40h semanais e 11h de descanso;
- aprovada pausa obrigatória de 60 min em turnos com mais de 6h efetivas,
  posicionável após 3–5h de trabalho efetivo;
- introduzido modelo aditivo de turno datado com intervalo de presença e refeição;
- validador puro de pausas, limites diários, semanais e descanso, com
  distinção entre violações, entrada inválida e contexto exterior incompleto;
- semanas civis de segunda a domingo, com turnos conhecidos fora do período;
- fuso horário IANA explícito; descanso em minutos reais, incluindo mudanças
  da hora legal, com rejeição de horas locais inexistentes ou ambíguas;
- teste unitário dos casos-limite; sem alterações a Supabase ou à interface;
- acrescentado `checkPresenceForWorkShifts` para excluir períodos de refeição
  da cobertura mínima, reutilizando o algoritmo de presença existente;
- introduzido `checkPresenceForWorkingIntervals` para preservar uma única
  pessoa com vários segmentos não sobrepostos e impedir dupla contagem;
- testes de refeições simultâneas e desfasadas, limites de fases e
  equivalência com validador antigo quando não existem pausas;
- testes locais de regras de trabalho e cobertura com refeições confirmados;
- testes, verificação de tipos e build aprovados no GitHub Actions;
- gerador anterior ainda não aplica os novos limites (integração pendente).

## 2026-10-26 — Ponto 6.2: gerador de períodos V0 (em validação)

- orquestra vários dias consecutivos através do gerador diário já validado;
- intervalo de datas inclusivo, limitado a 14 dias e calculado sem erros de fusos horários;
- preserva os diagnósticos por data e os casos de dias fechados;
- só devolve a lista de atribuições quando todos os dias cumprem as regras diárias;
- distingue claramente validação **diária** de viabilidade global/contratual;
- testes automatizados para exceções, períodos incompletos e datas de fronteira;
- criado modo «Vários dias · V0» na interface existente de geração, com seleção
  de intervalo, cartões por data, turnos e diagnósticos de cobertura;
- períodos incompletos mostram dias validados isoladamente, mas nunca publicam
  atribuições parciais como horário do período;
- avisos explícitos de que descansos, horas semanais e contratos não são
  verificados; simulação apenas em memória, sem escrita de turnos no Supabase;
- sem mudanças ao esquema ou formato persistido.
- validação funcional manual concluída com dados reais: semana 26/10–01/11
  corretamente incompleta (0 dias com turnos, 1 fechado, 6 falhas),
  diagnóstico de cobertura de segunda-feira e fecho de domingo;
- cenário de sucesso 31/10–01/11 com exceção de presença 1/1/1:
  Anabela 09:00–13:00 no sábado e domingo fechado, 0 falhas;
- eliminação da exceção de teste confirmou retorno ao diagnóstico
  de insuficiência de sábado (09:30–12:30, 1 de 2 pessoas)
  e não publicação de turnos parciais. Dados temporários repostos.

## 2026-10-26 — Ponto 6.1: gerador diário V0 (em desenvolvimento)

- gerador puro de turnos contínuos para uma única data;
- pesquisa de candidatos determinística, limitada e verificada pelos validadores existentes;
- diagnósticos distintos para configuração inválida, capacidade insuficiente,
  ausência de solução encontrada e limite atingido;
- testes automáticos para duração, horários partidos, dias curtos e arquivos;
- sem alterações ao Supabase ou ao esquema dos dados persistidos.
- adicionada área experimental «Gerar horário», com calendário, estado de pesquisa,
  turnos por colaborador e diagnóstico de insuficiências;
- simulação apenas em memória; não altera as configurações nem persiste resultados;
- resultados anteriores ficam obsoletos se a configuração for alterada;

## 2026-10-25 — Ponto 5: janelas de presença de 30 minutos (em validação)

- abertura: primeiros 30 minutos após a abertura do primeiro período operacional;
- fecho: últimos 30 minutos anteriores ao fim do último período operacional;
- período central: restante tempo aberto, sem incluir intervalos de encerramento;
- mínimos independentes: configurações 1 / 2 / 1 passam a ser válidas;
- operações partidas e dias curtos têm regras explícitas, incluindo sobreposição
  de janelas com aplicação do mínimo mais exigente;
- pré-verificação de disponibilidade e validador de atribuições utilizam
  os mesmos limites horários, com testes de fronteiras;
- interface passa a mostrar as janelas exatas de cada dia;
- formato persistido v4 não se altera; sem migração de base de dados.

## 2026-10-25 — Supabase: persistência remota (em validação)

- esquema PostgreSQL com estado v4 em JSONB por utilizador;
- RLS e autenticação obrigatória;
- função de gravação transacional que rejeita revisões obsoletas e remoção acidental de todos os colaboradores;
- histórico de versões no PostgreSQL;
- migração inicial do `localStorage`, com recuperação de pessoas de backups e v1;
- importação bloqueada quando já existem dados na cloud;
- testes simulados de concorrência, persistência, autenticação e migração;
- validação real com projeto Supabase ainda pendente.

## 2026-10-23 — Ponto 5: Requisitos mínimos de presença

- três mínimos independentes: abertura, operação e fecho;
- padrão semanal e exceções por data;
- ausência de configuração distinta de mínimo zero;
- validação de mínimos e exceções duplicadas;
- validador puro de presença sobre turnos propostos com varrimento de intervalos;
- dias curtos e operações partidas tratados sem duplicar pessoas;
- interface semanal compacta e exceções;
- persistência atualizada para v4 com migrações v1–v3;
- adicionada pré-verificação necessária de capacidade baseada em disponibilidade;
- criada CI para testes, TypeScript e build;
- adicionados testes do domínio e da persistência;
- Ponto 5 permanece em validação, sem gerador nem curva horária.

## 2026-10-23 — Ponto 4 fechado

- regras de trabalho validadas funcionalmente na aplicação;
- turnos contínuos confirmados;
- ajuste automático em dias mais curtos confirmado;
- testes de calendário, pessoas, disponibilidade, regras de trabalho e persistência aprovados localmente;
- typecheck aprovado localmente;
- Ponto 4 considerado concluído.

## 2026-10-23 — Ajuste de duração em dias curtos

- duração padrão passa a representar a duração normal pretendida;
- dias com menos horas de funcionamento deixam de ser tratados como erro;
- o turno é reduzido ao período operacional contínuo disponível;
- operações partidas continuam sem permitir que um turno atravesse o fecho;
- pré-visualização semanal reorganizada numa grelha compacta.

## 2026-10-23 — Ponto 4: Regras de trabalho e turnos contínuos

- abandonado o protótipo de cobertura por intervalos antes de merge;
- introduzida duração padrão de turno configurável;
- duração ausente permanece explicitamente não configurada;
- turnos diários passam a ser contínuos por construção;
- adicionados cálculos de turno de abertura e de fecho;
- turnos não podem atravessar períodos de operação fechada;
- validação reutiliza calendário operacional e disponibilidade;
- criada interface própria com pré-visualização;
- persistência atualizada para versão 3 com migração v2 → v3;
- adicionados testes de regras de trabalho e persistência.

## 2026-10-22 — Ponto 3 fechado

- disponibilidade validada funcionalmente na aplicação;
- integração com calendário operacional confirmada;
- testes de calendário, pessoas, disponibilidade e persistência aprovados localmente;
- typecheck aprovado localmente;
- Ponto 3 considerado concluído.

## 2026-10-22 — Disponibilidade respeita calendário operacional

- tempo escalável passa a ser a interseção entre funcionamento e disponibilidade;
- dias fechados no calendário operacional ficam bloqueados na disponibilidade semanal;
- exceções de disponibilidade respeitam o funcionamento efetivo da respetiva data;
- seletores de horas ficam limitados ao intervalo operacional;
- adicionados testes para operação fechada, limites horários e abertura excecional.

## 2026-10-22 — Ponto 3: Disponibilidade

- introduzida disponibilidade semanal por pessoa;
- zero intervalos representa indisponibilidade;
- adicionadas exceções de disponibilidade por data;
- adicionada resolução da disponibilidade efetiva;
- adicionada validação de intervalos totalmente contidos;
- disponibilidade definida como hard constraint;
- criado separador próprio na interface;
- pessoas arquivadas preservam os dados mas deixam de ser selecionáveis;
- persistência atualizada para versão 2;
- migração automática preserva calendário e pessoas guardados na versão 1;
- adicionados testes de disponibilidade e migração.

## 2026-10-22 — Persistência automática local

- criada uma porta assíncrona de persistência independente do motor;
- implementado adaptador versionado de `localStorage`;
- calendário, exceções e pessoas são carregados automaticamente no arranque;
- alterações são guardadas automaticamente com debounce;
- adicionado indicador visual de estado da gravação;
- estrutura preparada para substituição futura por API/base de dados;
- adicionados testes do adaptador de persistência.

## 2026-10-22 — Separação por áreas

- calendário operacional e pessoas passam a existir em separadores próprios;
- cada separador mostra apenas os indicadores relevantes para o seu contexto;
- removido o empilhamento das áreas na mesma página;
- alteração limitada à interface, sem mudança no domínio.

## 2026-10-22 — Ponto 2: Pessoas

- introduzido modelo mínimo de pessoa com `id`, `name` e `active`;
- adicionadas funções puras para criar, renomear, arquivar, reativar e filtrar pessoas;
- adicionados testes do domínio de pessoas;
- adicionada gestão visual de pessoas à aplicação;
- arquivo preserva a entidade em vez de a eliminar;
- mantidos fora do modelo cargos, contratos, disponibilidade, folgas e turnos.

## 2026-10-22 — Ponto 1 fechado

- calendário operacional considerado funcionalmente concluído;
- melhorias de múltiplos intervalos, validação adicional e persistência passam para backlog;
- próximo conceito do motor será definido antes de nova implementação.

## 2026-10-22 — Refinamento visual e seleção de horas

- substituída a introdução manual de horas por dropdowns em intervalos de 15 minutos;
- fecho disponível apenas depois da hora de abertura;
- seleção automática de um fecho válido quando a abertura muda;
- reorganizada a grelha semanal em colunas Dia / Estado / Abertura / Fecho;
- simplificados os indicadores de resumo;
- refinado o painel de exceções e os estados aberto/fechado.

## 2026-10-22 — Calendário operacional contínuo

- removido o conceito de período de planeamento global;
- mantido o padrão semanal de funcionamento como configuração contínua;
- mantidas exceções por data;
- atualizado o núcleo para resolver horários por data;
- reorganizada a interface para um painel de configuração mais profissional;
- adicionados indicadores de resumo semanal;
- documentação alinhada com a nova decisão.

## 2026-10-22 — Reinício pelo Ponto 1

- removido o protótipo de pessoas e turnos A/B/C;
- removidos gerador e validador do V0 anterior;
- introduzido horário semanal de funcionamento;
- introduzidas exceções por data;
- criada resolução do calendário operacional;
- interface reduzida à configuração temporal;
- documentação alinhada com a nova fundação.
