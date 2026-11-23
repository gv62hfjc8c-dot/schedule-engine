# PR98 — Ambiente privado sem cartão: Workers Free + GitHub OAuth

**Estado:** implementação preparada em código, ainda **não publicada nem testada num endereço real**. O objetivo continua a ser guardar o cenário atual só após proteger o acesso; a importação/cloud storage será tratada no PR99.

## Decisão

- Cloudflare Workers **Free**, já confirmado ativo na conta. Sem Cloudflare Zero Trust, Cloudflare Access ou subscrição paga.
- Hospedagem inicial no domínio gratuito `*.workers.dev` do próprio Worker. **O endereço é público, mas o conteúdo não**: a rota de entrada mostra só o ecrã de autenticação, e o Worker recusa HTML, JS, CSS, APIs e demais recursos sem sessão autorizada.
- Identidade verificada pelo OAuth do GitHub; o único utilizador permitido é o **ID numérico imutável** da tua conta GitHub, obtido da API autenticada do GitHub. Não basta conhecer o email ou nome de utilizador.
- O OAuth usa `state` assinado, PKCE SHA-256, cookies Secure/HttpOnly/SameSite=Lax e sessões HMAC com 8h de validade. O token GitHub só é usado para consultar o ID e é descartado imediatamente.
- O Worker recusa qualquer pedido se faltarem variáveis, houver erros de validação ou o pedido chegar através de outro hostname. Não existe senha pré-definida.
- `assets.run_worker_first=true` é obrigatório. Sem esta opção os ficheiros estáticos poderiam contornar a autenticação.
- `preview_urls=false` impede as URLs automáticas de preview. Qualquer outra publicação antiga (Pages, Workers, domínio pessoal) precisa de auditoria independente.
- Não serão guardados dados reais no Git, em `VITE_*`, em variáveis públicas ou em HTML. Nada dos horários é enviado à cloud nesta fase.

## 1 — Preparação no Mac

Confirmar primeiro que não existem alterações locais por guardar:

    cd ~/schedule-engine
    git status --short
    git fetch origin
    git switch feature/private-cloudflare-environment
    git pull --ff-only origin feature/private-cloudflare-environment
    npm ci
    npm test
    npm run build
    npx wrangler@4 whoami

Se o Wrangler ainda não reconhecer uma sessão, executar `npx wrangler@4 login` e autorizar no Safari. Não selecionar upgrades.

## 2 — Criar o Worker Free (sem segredos e sem dados)

    npx wrangler@4 deploy

A configuração `wrangler.jsonc` ativa `workers_dev:true`, porque precisamos de um domínio gratuito para o callback do GitHub. O deploy cria uma URL semelhante a:

    https://schedule-engine-private.<subdominio-da-conta>.workers.dev

**Antes de instalar os segredos, esse endereço deve responder 503 (serviço privado não configurado). Não deve revelar o Schedule Engine.** Se aparecer algum pedido de upgrade, cobrança ou cartão, parar e não o aceitar.

Guardar só a URL do Worker, sem caracteres adicionais.

## 3 — Criar a OAuth App gratuita no GitHub

1. Abrir https://github.com/settings/developers e selecionar **OAuth Apps → New OAuth App**.
2. Application name: `Schedule Engine Private`.
3. Homepage URL: a URL HTTPS exata devolvida pelo Wrangler.
4. Authorization callback URL: a mesma URL seguida de `/auth/callback`.
5. Registar a aplicação; copiar Client ID e gerar Client Secret.
6. **Não selecionar nem conceder scopes adicionais**, nomeadamente acesso a repositórios. A app só necessita de ler o ID público autenticado no endpoint `GET /user`.
7. O GitHub poderá pedir confirmação de identidade ou 2FA. Ativar 2FA na conta GitHub antes de avançar.

A OAuth App é apenas para autenticar. Não concede ao Schedule Engine permissões de editar repositórios, nem substitui o GitHub ligado ao ChatGPT.

## 4 — Identificar a conta autorizada

Precisamos do **ID numérico da conta pessoal** que faz login no GitHub, não do nome do repositório nem do endereço de email. Uma maneira prática é abrir:

    https://api.github.com/users/TEU_USERNAME_GITHUB

No JSON público, procurar o campo `"id"`. Outra opção, se o GitHub CLI já estiver autenticado:

    gh api user --jq .id

Este ID é guardado como um Secret do Worker, não é enviado ao chat. Não confiar apenas no username, que pode mudar.

## 5 — Configurar cinco Secrets no Worker

O Wrangler pede cada valor interativamente. Não incluir valores reais em comandos, histórico Git, screenshots nem chat.

    npx wrangler@4 secret put PUBLIC_ORIGIN
    npx wrangler@4 secret put GITHUB_CLIENT_ID
    npx wrangler@4 secret put GITHUB_CLIENT_SECRET
    npx wrangler@4 secret put GITHUB_ALLOWED_USER_ID
    npx wrangler@4 secret put SESSION_SECRET

- `PUBLIC_ORIGIN`: URL exata da etapa 2, com HTTPS e sem barra final.
- `GITHUB_CLIENT_ID`: ID da OAuth App do GitHub.
- `GITHUB_CLIENT_SECRET`: segredo da OAuth App (nunca partilhar).
- `GITHUB_ALLOWED_USER_ID`: o ID numérico inteiro do proprietário.
- `SESSION_SECRET`: pelo menos 32 bytes aleatórios **em base64url**. Podes gerar um valor novo no Mac com:

    node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"

Copiar o valor gerado para o prompt de `npx wrangler@4 secret put SESSION_SECRET`. Depois limpar o Terminal se necessário. Não guardar esse valor no repositório.

Cada `secret put` pode atualizar uma versão do Worker; se faltar um só Secret, o site continuará a responder 503. No final, não deve existir qualquer palavra-passe embutida no JavaScript de frontend.

## 6 — Aceitação de segurança no Safari

Após instalar os cinco Secrets:

1. Janela privada/anónima: abrir a URL do Worker. Deve mostrar apenas **Acesso privado / Entrar com GitHub**, e não o calendário.
2. Ainda sem login, visitar `/horarios`, `/configuracao`, `/assets/<ficheiro-real>.js` e `/index.html`. O Worker tem de responder **401** sem entregar conteúdo.
3. Clicar em Entrar com GitHub e entrar com a **conta pessoal autorizada**. O retorno deverá abrir `/horarios`.
4. Usar um segundo utilizador GitHub distinto (se possível): o login deve devolver **403 Conta GitHub não autorizada**.
5. Confirmar que os cookies são Secure/HttpOnly/SameSite=Lax e que o endereço da aplicação é o mesmo configurado em `PUBLIC_ORIGIN`.
6. Testar janela privada novamente para confirmar que o conteúdo continua protegido sem sessão.
7. Verificar qualquer projeto Pages/Workers anterior e desativar caminhos públicos alternativos que possam expor horários ou ficheiros.
8. Confirmar que **nenhuma configuração foi importada automaticamente** do browser antigo: a persistência local no Mac continua separada da nova implantação.

**Importante:** sem Cloudflare Access, a página de login é visível publicamente. Esta solução protege os **dados e ficheiros**, não oculta a existência do URL. Para um único utilizador é uma alternativa razoável, mas não é equivalente a um acesso de rede fechado. Não ativar qualquer API ou importação de dados antes de testar a autorização no servidor.

## 7 — Critérios de conclusão

-  Testes unitários e build de produção aprovados na CI.
-  Bundle Wrangler compilado via `deploy --dry-run`, sem deployment pela CI.
-  Login GitHub do proprietário autorizado, acesso anónimo a todos os recursos bloqueado.
-  Outro GitHub ID recusado, ainda que autenticado.
-  Secrets configurados no Worker e não expostos no Git.
-  Nenhum deployment alternativo público acessível.
-  Sem subscrição paga nem método de pagamento associado.

**Não fazer merge do PR98 nem importar dados pessoais até a aceitação funcional e a auditoria de acesso no Safari.**

## PR99

Depois da autenticação validada, importar **com consentimento explícito** o cenário de novembro de 2026 (empresa, equipa, funcionamento, regras, descansos e turnos), com snapshots de referência imutáveis, autorização backend, exportação de backup, restauro e testes de integridade. O Cloudflare Workers Free não cria por si só persistência de horários nem fornece backups. A escolha de armazenamento deve ser verificada separadamente, sem serviços que exijam cartão.
