# Convenções do Projeto

## Objetivo

Este projeto pretende evoluir para um motor de geração de horários reutilizável, independente da interface gráfica.

A interface React é apenas uma forma de utilizar esse motor.

---

# Princípios

## 1. Responsabilidade Única (Single Responsibility Principle)

Cada ficheiro deve ter apenas uma responsabilidade.

Exemplos:

* Um componente apresenta informação.
* Um hook gere estado.
* Um serviço coordena operações.
* Um algoritmo implementa regras de negócio.
* O armazenamento apenas lê e guarda dados.

---

## 2. A interface não contém regras de negócio

Os componentes React não devem implementar regras de geração de horários.

Toda a lógica de negócio pertence ao motor da aplicação.

---

## 3. O armazenamento é abstrato

Nenhum componente deve aceder diretamente ao `localStorage`.

Todo o acesso ao armazenamento deve passar pela camada `storage`.

No futuro, esta implementação poderá ser substituída por IndexedDB, SQLite ou uma API sem alterar os componentes.

---

## 4. Hooks gerem estado

Os Custom Hooks existem para concentrar estado e comportamento relacionado.

Não devem conter código de apresentação.

---

## 5. Serviços coordenam operações

Os serviços ligam diferentes partes da aplicação.

Exemplos:

* chamar o motor de geração;
* guardar resultados;
* carregar dados.

---

## 6. Algoritmos são funções puras

Os algoritmos não devem:

* utilizar React;
* utilizar `useState`;
* utilizar `useEffect`;
* utilizar `localStorage`;
* modificar diretamente a interface.

Devem apenas receber dados e devolver resultados.

---

## 7. Componentes são simples

Os componentes devem limitar-se a:

* receber dados;
* emitir eventos;
* apresentar informação.

Sempre que possível, não devem conhecer detalhes da lógica de negócio.

---

## 8. Refatorações não alteram comportamento

Uma refatoração deve melhorar a estrutura do código sem alterar o comportamento observado pelo utilizador.

---

## 9. Commits pequenos

Cada commit deve representar uma alteração lógica completa.

Evitar commits com múltiplas alterações sem relação entre si.

---

## 10. Documentação faz parte do projeto

Sempre que uma decisão importante de arquitetura for tomada, deverá ser registada na pasta `docs`.
