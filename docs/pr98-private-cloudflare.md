# PR98 — Ambiente privado no Cloudflare

**Estado: preparado em código, ainda NÃO publicado.** PR99 tratará da persistência da configuração real, após demonstrar que a aplicação está privada.

## Invariantes de segurança

1. O Worker chama-se schedule-engine-private e nasce sem URL: workers_dev=false, preview_urls=false, nenhuma route definida.
2. Todos os ficheiros (HTML, JS, CSS, imagens) passam pelo Worker ANTES de ser servidos: assets.run_worker_first=true. A opção normal sem isso deixaria ficheiros públicos.
3. O Worker valida o JWT Cf-Access-Jwt-Assertion do Cloudflare Access: assinatura RS256, issuer exato, audience exata, validade temporal e email EXATO do único proprietário.
4. Configuração ausente, outra identidade, token falso ou falha da consulta das chaves públicas => 403 ou 503; nunca fallback público.
5. Segredos, emails pessoais, nomes de colaboradores e configurações reais não entram no repositório, no HTML nem nas variáveis VITE_. Os três valores de acesso são Secrets no Worker.
6. O Cloudflare Access deve proteger o WORKER INTEIRO no modo All traffic, com política Allow para um único endereço de email, sem Bypass nem permissões amplas. Exigir MFA no fornecedor de identidade.
7. Todos os URLs e projetos antigos Pages/Workers devem ser auditados. Esta aplicação privada não desativa automaticamente um eventual deployment público anterior.

## 1. Preparação no Mac

Antes de mudar de branch, garantir que as alterações locais estão salvaguardadas.

    git fetch origin
    git switch feature/private-cloudflare-environment
    git pull --ff-only origin feature/private-cloudflare-environment
    npm ci
    npm test
    npm run build
    npx wrangler@4 login
    npx wrangler@4 whoami

Não configurar GitHub Actions para publicar automaticamente no PR98.

## 2. Primeiro deploy sem URL pública

O ficheiro wrangler.jsonc está deliberadamente sem rotas. Executar:

    npx wrangler@4 deploy

Verificar no Dashboard: workers_dev continua desligado, previews desligados e nenhum hostname público configurado. Se o Wrangler pedir para ativar workers.dev, responder NÃO.

Esta implantação inicial existe apenas para criar o Worker necessário para configurar Access. Ainda não transporta dados reais. A app nega todos os pedidos por omissão, porque os segredos ainda não existem.

## 3. Cloudflare Access para o Worker completo

No Dashboard, com Zero Trust ativo:

**Workers & Pages → schedule-engine-private → Access → Protect this Worker behind Access**.

- Escolher **All traffic** (produção e previews), NÃO Previews only.
- Criar política Allow que inclua **um só email exato**, o proprietário.
- Não escolher Email domain, Everyone, Cloudflare account genérico nem Bypass.
- Não autorizar service tokens adicionais.
- Configurar autenticação multifator no fornecedor de identidade.
- Guardar e ir a Zero Trust → Access → Applications; copiar o Application Audience (AUD) Tag e o Team Domain.

O Access ao nível do Worker protege todos os domínios e rotas do próprio Worker, ao contrário de uma regra para um único hostname. A validação JWT na aplicação continua obrigatória, mesmo com Access ligado.

Fontes oficiais:
- https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/workers/static-assets/binding/

## 4. Definir Secrets, nunca os enviar ao Git

Executar individualmente no Mac e digitar cada valor apenas no prompt interativo:

    npx wrangler@4 secret put ACCESS_TEAM_DOMAIN
    npx wrangler@4 secret put ACCESS_APPLICATION_AUD
    npx wrangler@4 secret put ACCESS_OWNER_EMAIL

Valores:
- ACCESS_TEAM_DOMAIN: https://TEU-TEAM.cloudflareaccess.com
- ACCESS_APPLICATION_AUD: tag AUD da aplicação criada
- ACCESS_OWNER_EMAIL: único email autorizado por Access

Não usar ficheiros versionados, variáveis VITE_ ou ficheiros públicos para os segredos. O comando secret put pode publicar uma versão do Worker; permanece sem domínio público até ser adicionada uma rota.

## 5. Associar um único endereço, depois de proteger

Só após Access e Secrets confirmados, adicionar um domínio CONTROLADO pelo utilizador no Dashboard à aplicação protegida. Manter workers_dev=false e preview_urls=false. Nunca assumir que existe domínio disponível.

A conta Cloudflare não está acessível através desta conversa para ações administrativas. A criação de Access/Secrets/rota requer sessão do proprietário. Este PR NÃO demonstra, sozinho, privacidade real na Cloudflare.

## 6. Aceitação funcional e de segurança

Testes no Safari, com o domínio configurado:

1. Visitante sem autenticação: /, /horarios e /assets/app.js devem ser bloqueados ou redirecionados para login Access, não revelar conteúdo do Schedule Engine.
2. Email diferente: acesso negado.
3. Proprietário com MFA: login permitido, /horarios funciona, configuração e PDF acessíveis.
4. Token falso, expirado, sem assinatura ou destinado a outra aplicação: 403 pelo Worker; verificar sem servir CSS/JS.
5. Falta de um Secret: 503, nunca fallback público.
6. Verificar todos os domínios alternativos, eventuais deployments Pages antigos, workers.dev e previews.
7. Confirmar que o próprio browser/PC não oferece o armazenamento local a terceiros: acesso físico ao perfil do navegador fica fora do âmbito Access.
8. Confirmar que **a configuração atual ainda está no localStorage do browser de origem**. O PR98 não presume que ela está já guardada numa base de dados online.

A aceitação depende de testes positivos e negativos comprovados; não basta a UI carregar numa sessão autorizada.

## 7. Critérios de conclusão

- CI: npm test e npm run build verdes.
- Worker criado; proteção All traffic verificada.
- Apenas um email real autorizado com MFA.
- Segredos instalados na Worker Settings, sem valores no Git.
- Teste anónimo e segundo-email negado; proprietário autorizado.
- Endereços alternativos auditados, sem vias públicas.
- Nenhuma configuração pessoal ou comercial transferida sem autorização e teste de restauro.

## PR99 — Preservação definitiva do cenário

A configuração de novembro de 2026 (empresa, equipa, horários de funcionamento, regras, descansos e horários) continua a ser local. O PR99 tratará de importação consentida, armazenamento em servidor, snapshots imutáveis, exportação/backup e restauro. Access é só a porta de entrada: não é persistência nem autoriza sozinho operações no banco de dados.

**Nota técnica:** o router de Static Assets não propaga ctx.access ao código do Worker; por isso usamos validação criptográfica direta do JWT. A aplicação ainda tem um formulário de entrada fictício na rota raiz, que o Worker privado evita redirecionando sessões autenticadas para /horarios.
