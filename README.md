# Schedule Engine — V2 (fundação)

Recomeço controlado do Schedule Engine. Esta branch contém uma base autónoma:
interface React + TypeScript + Vite, inspirada na identidade visual anterior.
A implementação V0/V1 continua preservada no histórico e noutras branches.

## O que já existe

- Página inicial em / com o mesmo conceito visual de dois painéis.
- /horarios: calendário civil mensal sem dados (o utilizador pode navegar e selecionar dias).
- /configuracao: estrutura visual da primeira etapa futura.
- /horarios/gerar NÃO existe nesta versão; um endereço antigo volta à raiz.
- Testes pequenos e independentes para as rotas e o calendário.

## O que ainda NÃO existe

- Autenticação real: campos de login bloqueados, e não são recolhidas credenciais.
- Supabase, persistência, colaboradores, turnos, regras, cobertura ou algoritmo de geração.
- Sem dados de demonstração fictícios apresentados como reais.

## Como experimentar no Mac

A partir da pasta local já existente do repositório:

    git status --short
    git fetch origin
    git switch --track origin/v2/clean-foundation
    npm ci
    npm test
    npm run build

Se a branch local já existir, usar git switch v2/clean-foundation e git pull --ff-only.
Não fazer switch com modificações locais sem primeiro as verificar.
Se o Vite já estiver ativo, confirmar a página em http://localhost:5173/.
Se não estiver, executar npm run dev e abrir o endereço apresentado.

## Próximo passo

Definir o **funcionamento da empresa**, sem antecipar as necessidades do algoritmo.
Cada nova funcionalidade exige finalidade clara, teste no motor e verificação na UI.
