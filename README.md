# Borja Reis · Horários v2

Projeto novo, à parte do `borja-reis-horarios` que já tinhas. Fase 1: só vista semanal +
colaboradores — mas com o motor de geração automática já a funcionar por baixo.

## Arrancar (primeira vez)

Este é um projeto novo — ainda não tem as dependências instaladas. Num Terminal:

```bash
cd ~/Desktop/borja-reis-horarios-v2   # ou onde tiveres descompactado o zip
npm install
npm run dev
```

Depois abre o link que aparece no Terminal (normalmente `http://localhost:5173`).

Nas próximas vezes só precisas de `npm run dev` (o `npm install` só é preciso uma vez, ou sempre
que eu adicionar uma dependência nova).

## O que já funciona

- **Vista semanal** — uma linha por colaborador, uma coluna por dia. Clicar numa célula abre o
  editor (tipo de dia + horário).
- **Colaboradores** — botão "Colaboradores" no topo para adicionar/remover. Cada um tem uma
  equipa principal (Vendas/Caixa), função secundária opcional, e **dia fixo de folga** opcional
  (ex: Anabela = sempre à Quarta).
- **Cobertura hora a hora** — a loja está aberta 08:30–19:00 (seg-sáb) mas ninguém tem de lá estar
  o dia todo. O motor escalona os turnos: 1 pessoa por equipa "abre" (08:30–18:30), 1 "fecha"
  (09:00–19:00), e o resto fica só no miolo (09:00–18:30) — sempre entre 8h30 e 9h de trabalho.
  As pontas do dia (08:30–09:00 e 18:30–19:00) só exigem 1 pessoa por equipa; o miolo exige o
  mínimo cheio (`COVERAGE_CONFIG`). Ao domingo/feriado não há isto — é um turno único que já
  cobre a loja toda. Os avisos (ver abaixo) já dizem qual bloco falhou (abertura/miolo/fecho).
- **"Gerar semana automaticamente"** — decide folgas e horários para a semana em que estás,
  respeitando por esta ordem: cobertura mínima por equipa → dia fixo de cada um (quando definido)
  → fim de semana completo em rotação → distribuição justa do que sobra. Grava logo; podes sempre
  editar qualquer célula à mão depois.
- **Fim de semana completo** — o motor escolhe, por rotação (quem há mais tempo não teve),
  uma pessoa de cada equipa para ter Sábado E Domingo de folga na mesma semana, em vez do seu dia
  fixo habitual. O painel "Fim de semana completo" mostra quem tem essa semana e deixa trocar —
  troca volta a gerar a semana inteira (pede confirmação se já havia alterações feitas).
- **Régua de cobertura** (por cima da grelha) e **avisos** (por cima da régua) — mostram, ao
  vivo, qualquer INSTANTE em que Vendas ou Caixa fiquem abaixo do mínimo, seja por decisão
  automática ou por uma edição tua. Corrigido para olhar hora a hora aos horários reais de cada
  célula (não só "esta pessoa cobre o bloco inteiro sozinha") — importante para quando transcreves
  horários antigos com horas variadas que não seguem os padrões do motor.
- **Sugestão ao editares uma célula** — grava a alteração e, se houver algo a resolver, aparece
  um aviso com "Aceitar"/"Recusar": tirar alguém do trabalho e isso deixar a cobertura curta
  sugere quem (de folga nesse dia, na mesma equipa ou com função secundária) foi quem teve folga
  mais recentemente, para reforçar; pôr alguém a trabalhar num dia que era folga sugere compensar
  dando-lhe folga noutro dia da mesma semana, sem piorar a cobertura desse dia. Nunca aplica nada
  sozinho — só ao carregares em "Aceitar".
- **Função secundária** — alguém com "Vendas + Caixa" só é chamado a reforçar a outra equipa nos
  dias em que ela não bate o mínimo sozinha.
- **Data de entrada/saída por colaborador** — em Colaboradores. Quem ainda não chegou à data de
  entrada, ou já passou a data de saída, não aparece na vista semanal nem entra na cobertura
  desse período — sem precisares de os remover. "Marcar inativo" define a data de saída como hoje
  (editável) e tira a pessoa das semanas atuais/futuras; "Remover definitivamente" é a única ação
  que apaga o histórico, por isso pede confirmação.
- **Justiça de folgas por "há quantos dias não tem folga"** — corrigido depois de um bug real:
  a versão anterior (folgas ÷ total de dias) fazia gente com pouco histórico saltar para o topo
  do ranking com uma única folga, e gente com muito histórico ficar "presa" no fundo sem se mexer
  — nalguns casos a mesma pessoa acabava de folga a semana inteira. A nova conta só olha para as
  últimas 8 semanas, nunca antes da data de entrada da pessoa, e nunca inclui a própria semana que
  está a ser gerada — "Gerar de novo" passa a dar sempre o mesmo resultado com os mesmos dados.

- **Vista "Resumo"** — alterna com o botão "Semanal"/"Resumo" no topo. Mostra, por trimestre
  (navegável com ‹ ›): horas trabalhadas por pessoa em cada semana, a média semanal do trimestre
  (a vermelho se estiver abaixo da meta, laranja se acima — `WEEKLY_TARGET_HOURS` em
  `constants.ts`, 40h para todos por agora), quantos Domingos de folga e quantos fins de semana
  completos cada um teve. Semanas ainda não geradas aparecem como "—"; semanas com Férias ou
  Licença aparecem como "Férias/Lic." (a roxo) em vez de um número de horas, para ficar claro que
  não entram na média — só de olhar para a tabela, sem precisares de adivinhar. Continua a mostrar
  colaboradores inativos nas semanas em que estiveram cá.
- **Férias / Licença** — dois tipos de célula separados de Folga e Falta (editor da célula, no
  botão de tipo). Semanas com Férias ou Licença ficam de fora da média de horas — nem puxam para
  cima nem para baixo. Folga e Falta continuam a contar normalmente, como uma semana de trabalho
  qualquer.
- **Leitor único de células** (`utils/cells.ts`) — corrigido um bug real: uma célula gravada antes
  de uma saída (ou antes de uma entrada) já não conta para nada — horas, cobertura, Resumo — a
  partir do momento em que ajustas a data, mesmo que o horário já tivesse sido gerado com a pessoa
  ainda ativa nessa altura. Não é preciso apagar nem regenerar nada à mão.

- **Exportar / Importar** — botões no topo. "Exportar" descarrega um `.json` com tudo o que está
  guardado (colaboradores, semanas, tudo) — guarda isto de vez em quando como cópia de segurança,
  principalmente antes de fazeres alterações em massa. "Importar" lê um desses ficheiros e
  substitui os dados atuais (pede confirmação antes, porque apaga o que lá estava).

## O que ainda falta (próximas fases)

- Continuidade com o padrão do mês anterior (por agora, cada semana nova é decidida do zero, sem
  olhar para o histórico — exceto o dia fixo e a rotação de fim de semana, que já olham para trás).
- Ajustar horas ao alvo semanal de cada pessoa — a vista Resumo já mostra que, com os números
  atuais, a Vendas (5 pessoas, mínimo 3) tem mais folga disponível que a Caixa (4 pessoas, quase
  sempre no mínimo), por isso a média sai desequilibrada — Vendas ronda as 33h/semana, Caixa ronda
  as 43h/semana, os dois longe das 40h em direções opostas. É esta fase que vai corrigir isso.
- Caso especial por resolver: quem tiver folga fixa ao Sábado (seja quem for, é definido pelo
  campo "Dia fixo" em Colaboradores, não por nome) já tem esse dia garantido
  todas as semanas — quando ganha a rotação do "fim de semana completo", só devia receber o Domingo
  a mais, não voltar a "gastar" o Sábado que já era dele. Ainda não está corrigido no motor.
- Vista mensal, exportação Excel/WhatsApp — nada disto existe ainda, de propósito.

## Verificar o motor sem abrir o browser

```bash
npx tsx scripts/verificar-motor.mts 2026 7 8
```

Corre o gerador semana a semana a partir de julho de 2026, 8 semanas seguidas (podes trocar os
três números), e confirma que não há violações de cobertura, mostrando a rotação de fins de
semana completos. `DEFAULT_STAFF` está vazio de propósito (a app começa sem ninguém) — para usar
este script, edita-o temporariamente em `src/constants.ts` com alguns colaboradores de exemplo.

## Configuração

- **Cobertura mínima** — `src/constants.ts`, `COVERAGE_CONFIG` (hoje: 3 Vendas + 3 Caixa em dia
  útil, 2 Vendas + 3 Caixa ao domingo/feriado).
- **Colaboradores de partida** — nenhum. A app abre vazia; adicionas toda a gente tu próprio em
  "Colaboradores". `DEFAULT_STAFF` em `src/constants.ts` só é usado por `scripts/verificar-motor.mts`
  para testar o motor sem abrir o browser — não afeta o que vês na app.
- **Horário-base** — `src/constants.ts`, `DEFAULT_SHIFT_WEEKDAY` / `DEFAULT_SHIFT_REDUCED`.

Os dados ficam guardados no localStorage do browser (chave `borja-reis-horarios-v2`) — específico
deste browser/computador, tal como a app antiga.
