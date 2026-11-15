# Schedule Engine — V2: base visual do produto

A V2 é uma reconstrução independente do código V0/V1. A identidade visual da aplicação foi mantida, mas as páginas estão a ser desenvolvidas como ecrãs de produto final, sem etiquetas de protótipo, desenvolvimento ou demonstração.

## Rotas

- `/` — página de acesso com formulário de início de sessão e identidade visual em dois painéis.
- `/horarios` — calendário mensal com navegação e seleção de datas. O calendário ainda não tem dados operacionais.
- `/configuracao` — estado vazio de definições da organização.
- `/horarios/gerar` — rota da versão anterior: regressa à página inicial.

## Regra obrigatória de UI

Qualquer conteúdo visível deve fazer sentido para o utilizador final. Mensagens sobre versões, branches, testes, demos, PRs ou funcionalidades futuras pertencem apenas à documentação técnica, nunca ao produto.

O layout tem de se adaptar a desktop, tablet e smartphone, incluindo ecrãs com largura de 320px. O design preserva o estilo azul-escuro e teal, navegação acessível, foco visível e redução de animações quando o sistema pede.

## Estado funcional real

O formulário de acesso **ainda não tem provedor de autenticação**. Submeter o formulário não grava, envia ou autentica credenciais e apenas apresenta uma indisponibilidade de sessão. Não se simula autenticação. A navegação direta para `/horarios` está aberta apenas enquanto não existe backend nem dados privados.

Não existem ainda motor de scheduling, regras, colaboradores, turnos, aprovações, Supabase nem persistência. Os ecrãs não devem inventar resultados. Um dia sem turno nunca é automaticamente marcado como folga.

## Verificação

```bash
npm ci
npm test
npm run build
npm run dev
```

Testar os percursos no Safari e, antes de integrar o PR, verificar visualmente as resoluções 320px, 375px, 768px, 1024px e desktop largo. Os testes automáticos verificam a lógica do calendário, as rotas e contratos estáticos de linguagem e CSS, mas não substituem a inspeção visual nos dispositivos.

A versão anterior está preservada na `main` e no PR70. A branch da V2 é `v2/clean-foundation`; o PR71 permanece Draft até aceitação no Mac.
