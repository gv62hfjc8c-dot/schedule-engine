# PR47-17 — Continuidade histórica antes da aprovação oficial

**Decisão confirmada em 2026-11-08.** O utilizador dispõe de horários
reais desde o início de 2026 que ainda não estão no Schedule Engine.
A importação será realizada mais tarde. O motor deverá considerar todo
o histórico disponível, e nunca inferir dias livres a partir de um arquivo
vazio ou de documentos ainda não importados.

## Invariantes

1. **Factos separados de propostas.** Um horário anterior importado não
   passa retroativamente a ser uma aprovação emitida pelo Schedule Engine.
   Guardar proveniência, datas civis, fuso, pessoa, turnos/pausas e tipo
   de facto (planeado, aprovado no sistema de origem, ou efetivamente
   trabalhado), conforme a evidência fornecida.
2. **Cobertura explícita, por pessoa e data.** Conhecer só os dias com
   turnos não prova que os restantes foram folgas. Só uma importação
   verificada ou atestação fundamentada pode marcar um intervalo como
   completamente conhecido, incluindo dias sem turno.
3. **História por importar = desconhecida.** O ledger vazio não significa
   ausência de trabalho. Na ausência de cobertura verificada, as operações
   que dependem da história devolvem `incomplete_context`; não geram
   aprovações aparentemente válidas.
4. **Identidade estável.** Os colaboradores antigos e atuais precisam
   de um mapeamento inequívoco de IDs. Homónimos, mudanças de função e
   saídas da empresa não podem misturar pessoas diferentes.
5. **Datas e limites atravessam períodos.** Descanso entre jornadas,
   horas da semana, limites individuais, ciclos de 28 dias e distribuição
   equitativa devem consultar a história relevante, também quando atravessa
   mês, ano ou período de aprovação.
6. **Não reescrever o passado.** Ficheiro original, lote de importação,
   identidade verificada, revisão e eventual correção devem ser rastreáveis.
   Correções geram novas versões; não apagam silenciosamente os factos
   anteriores. Alterações retroativas exigem recertificar propostas futuras
   afetadas e nunca manter aprovação anterior como válida sem nova prova.
7. **Independência.** O núcleo recebe datas, pessoas, factos e uma prova
   explícita de cobertura. CSV, Excel, PDF, Supabase, React e outras fontes
   são adaptadores externos, não dependências do motor.

## Implementação incremental

- O núcleo de aprovação já rejeita `complete=false` e exige cobertura
  suficiente nas fronteiras de descanso/semana. O limite da validação de
  aprovação foi alinhado aos 28 dias do gerador condicionado.
- `src/utils/historicalWorkContext.ts` recebe períodos verificados por
  pessoa com origem identificada; permite um início histórico configurável
  (no caso atual, `2026-01-01`) e rejeita lacunas, fontes não verificadas,
  turnos duplicados e tentativas de gerar sobre turnos existentes.
- O contexto resultante só é declarado `completeOutsideTarget=true`
  quando toda a cobertura exterior requerida está realmente confirmada.
  A integração de teste fornece um turno histórico tardio ao gerador e
  demonstra a necessidade de descanso na jornada seguinte.
- **Ainda não implementado:** importação real, armazenamento versionado
  da história, reconciliação entre histórico importado e ledger oficial,
  cálculo de equidade anual, e endpoint confiável de aprovações. O helper
  puro não autentica a origem; cabe ao futuro adaptador de importação.
- **Não criar** um ledger com `complete=true` para 2026 só porque o
  banco de dados ainda não contém horários. A Edge Function antiga está
  inerte; o novo serviço Edge v2 está publicado mas não pode aprovar
  sem histórico verificado. O novo serviço de aprovação não deve arrancar com um
  `bootstrap` de 2020–2100 vazio.

## Regra operacional enquanto o histórico não foi importado

- Permitir consulta e conservação de propostas já guardadas, sempre
  identificadas como **não oficiais** e sem afirmar validade global.
- Não ativar o botão de aprovação oficial nem o fornecimento de contexto
  exterior como certificado se existirem lacunas relevantes.
- O historial de 2026 só poderá entrar nas contas definitivas depois de
  importação, correspondência de pessoas, verificação de cobertura e
  certificação das dependências.
- Quando o utilizador disponibilizar os horários antigos, determinar o
  formato real dos documentos e construir o adaptador mais simples possível;
  não presumir colunas, pausas ou horários trabalhados que os documentos
  não contenham.

**Aceitação pendente:** ensaios de importação com ficheiros reais,
registos históricos versionados, aprovação/revisão segura, RLS real e
validação final no Safari. Até lá o ponto 17 permanece **aberto**.

## Atualização 08/11/2026 — endpoint v3 e CAS de configuração

A API publicada utiliza a âncora temporal do próprio ledger verificado, certifica a proposta contra as regras operacionais atuais e exige a mesma revisão de configuração e do ledger na transação de gravação. A importação externa permanece adiada; não existe autorização implícita para considerar dias de 2026 sem trabalho.


## Decisão reiterada e fechada — 09/11/2026

O responsável confirmou novamente que **incluirá os horários reais mais tarde**. Não voltar a pedir a importação como condição de conclusão do PR47. A funcionalidade de aprovação oficial que exige histórico completo permanece deliberadamente bloqueada até existir prova de pessoa/dia. Os testes com histórico sintético validam o algoritmo e o serviço, **não são história real**. A decisão de aceitação de risco do plano Free e o gate de merge estão em `pr47-scope-and-residual-risks-2026-11-09.md`.
