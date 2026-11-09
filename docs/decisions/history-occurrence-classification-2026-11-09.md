# ADR — Classificação explícita de dias históricos (09/11/2026)

## Decisão

O histórico importado guarda uma **ocorrência tipificada por pessoa e dia**,
se e só se existe evidência no documento de origem para esse dia.

| `occurrence_type` | Significado | `shifts` |
| --- | --- | --- |
| `worked` | Trabalho efetivamente prestado (regra de interpretação acordada para os Excel históricos) | Array não vazio |
| `day_off` | Folga explicitamente identificada | `[]` |
| `vacation` | Férias explicitamente identificadas | `[]` |
| `holiday` | Feriado sem trabalho para colaborador já integrado na equipa | `[]` |

**Ausência de linha** = desconhecido / não aplicável; nunca provar trabalho
zero, folga nem férias. **Não criar uma ocorrência `not_employed`**:
a data de entrada/saída pertence ao modelo temporal de vínculos, não
a um dia de trabalho. O importador não deverá criar ocorrências antes da
entrada de cada colaborador.

### Interpretação específica — Excel de janeiro de 2026

- Importar 29/12/2025 a 01/02/2026, corrigindo os anos inconsistentes nos
  cabeçalhos das semanas 2–5 com base na confirmação do responsável.
- `F` = férias.
- Célula sem horas, preenchida a amarelo = folga.
- Célula sem horas e sem amarelo = colaborador ainda não integrado,
  sem ocorrência importada.
- Duas horas (entrada e saída) = turno contínuo, sem refeição.
- 01/01/2026 = feriado, apenas para colaboradores já na equipa nessa data.
  Lídio começou em 05/01/2026, não recebe ocorrência em 01/01/2026.
- Floriberto só começou em fevereiro (dia exato apurado no Excel seguinte):
  não inferir entrada de janeiro.
- Sandro do Excel deve ser completamente excluído; **não é** o Sandro Borba
  já existente na conta. Não associar, apagar ou alterar Sandro Borba.
- Conta de destino: `diogojmguedes@gmail.com`. Confirmar titular autenticado
  na operação real; não confiar apenas no email do ficheiro.

### Segurança e qualidade

A migração acrescenta `occurrence_type` com restrições PostgreSQL.
A tabela histórica está protegida por RLS; o browser não recebe permissões
de escrita. A importação definitiva será comando de servidor confiável,
idempotente, com revisão humana da pré-visualização e sem substituir dados
existentes silenciosamente.

O arquivo da fonte e os factos históricos **não** criam automaticamente
`history_verifications`; a cobertura verificada exige prova separada.
O modelo de turnos do gerador não deve confundir férias e folgas com trabalho.

A migração intencionalmente falha caso já existam factos históricos na
base de dados: são potencialmente ambíguos e exigem classificação explícita,
não um backfill presumindo que `shifts=[]` significa folga. Na conta
principal foram confirmados 0 factos históricos antes deste trabalho.

**Âmbito deste PR:** classificação e testes. Não inclui importador Excel,
gravação de janeiro, vínculo temporal completo nem ativação de aprovações.
