# Schedule Engine

Motor de scheduling reutilizável e independente de qualquer empresa específica.

## Estado atual

A fundação está a ser construída de forma incremental.

Estão implementados:

1. **calendário operacional** — quando a operação funciona;
2. **pessoas** — quem pode participar em horários;
3. **disponibilidade** — quando cada pessoa pode trabalhar;
4. **regras de trabalho** — duração padrão e turnos diários contínuos;
5. **requisitos mínimos de presença** — abertura, operação e fecho.

Ainda não existe geração automática de horários.

## Princípios atuais

O motor não está preso a uma janela global de planeamento.

Calendário e disponibilidade usam padrões semanais contínuos com exceções por data.

Uma pessoa só pode trabalhar na interseção entre calendário operacional e disponibilidade.

Um turno diário é um único intervalo contínuo. Turnos repartidos não fazem parte do modelo atual.

A duração padrão do turno é configuração explícita; o motor não assume uma duração quando ela ainda não foi definida.

Os mínimos de presença são hard constraints configuráveis por dia e exceção. Não modelam a afluência horária nem limitam o número máximo de pessoas escaladas.

O núcleo dispõe de um validador da presença em atribuições contínuas propostas e de uma pré-verificação de disponibilidade. Nenhum destes dois mecanismos gera horários ou garante viabilidade integral.

## Persistência

A aplicação guarda automaticamente:

- calendário operacional;
- exceções de calendário;
- pessoas;
- disponibilidades;
- regras de trabalho;
- requisitos mínimos de presença e exceções.

O armazenamento atual usa `localStorage`, isolado atrás de um contrato assíncrono de persistência.

O formato é versionado e suporta migração automática entre as versões introduzidas.

## Executar

```bash
npm install
npm run dev
```

## Verificar

```bash
npm run typecheck
npm test
npm run build
```

O mesmo conjunto de verificações é executado automaticamente em pull requests.

## Desenvolvimento

A regra de evolução é:

```text
decisão → implementação → teste → validação → próxima decisão
```

O núcleo do scheduling deve permanecer independente da UI, persistência e aplicação consumidora.
