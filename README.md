# Schedule Engine

Motor de geração automática de horários, independente de qualquer empresa específica.

## Estado atual

A fundação do domínio é construída incrementalmente.

Estão implementados:

1. **calendário operacional contínuo** — quando a operação funciona;
2. **pessoas** — quem pode participar em horários;
3. **disponibilidade** — quando cada pessoa pode trabalhar;
4. **cobertura necessária** — quantas pessoas são necessárias em cada período.

Ainda não existe geração automática de horários.

## Princípios atuais

O motor não está preso a uma janela global de planeamento.

Calendário, disponibilidade e cobertura usam padrões semanais contínuos com exceções por data.

Disponibilidade e cobertura são limitadas pelo calendário operacional.

O tempo em que uma pessoa é efetivamente escalável é a interseção entre funcionamento e disponibilidade.

Cobertura ausente não significa zero pessoas. Um período operacional sem cobertura definida é configuração incompleta.

## Persistência

A aplicação guarda automaticamente:

- calendário operacional;
- exceções de calendário;
- pessoas;
- disponibilidades;
- cobertura;
- exceções de cobertura.

O armazenamento atual usa `localStorage`, isolado atrás de um contrato assíncrono de persistência.

O formato é versionado e suporta migração automática entre as versões já introduzidas.

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

## Desenvolvimento

A regra de evolução é:

```text
decisão → implementação → teste → validação → próxima decisão
```

O núcleo do scheduling deve permanecer independente da UI, persistência e aplicação consumidora.
