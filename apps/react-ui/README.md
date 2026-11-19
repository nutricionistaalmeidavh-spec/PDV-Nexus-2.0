# PDV Nexus 2.0 — UI React (direção visual v1)

Front-end React 19 + Vite 8, **R$ 0 / self-hosted**, com dependências open source e código React sob licença MIT. **A licença da raiz ainda é `UNLICENSED` e deve ser definida antes de declarar todo o produto como open source.** Implementação separada das telas existentes. Não altera rotas públicas, SQLite, Electron, backend ou fiscal existente.

## Rodar localmente

Em um terminal, a partir da raiz do repositório:

```bash
node --experimental-strip-types apps/server/src/index.mjs
```

Em outro terminal:

```bash
cd apps/react-ui
npm install --no-audit --no-fund
npm test
npm run dev
```

Acesse `http://127.0.0.1:5173`. Vite encaminha **somente `/api`** para o host local `http://127.0.0.1:3434`. A autenticação por operador é a mesma API local, baseada em sessão. Sem host, a UI entra **explicitamente** em modo visual e nenhuma ação é gravada. Para testar a autenticação, rode o servidor primeiro e recarregue.

## O que está integrado ao backend existente

- Login/configuração inicial de supervisor, produtos e categorias;
- Criar, confirmar, consultar, cancelar e receber pedido de balcão;
- Adicionais já cadastrados pelo backend e observação do item;
- Sessão de caixa: abertura, suprimento/sangria, fechamento;
- Pedidos, mesas e comandas, tickets KDS e operadores;
- Configuração de impressora TCP, pareamento e exportação CSV/JSON;
- Todos os fluxos com comandos usam `commandId`, revisão quando aplicável e aguardam resposta antes de confirmar sucesso visual.

**Importante**: não presumir que todo fluxo está homologado; QA de hardware e Windows real continua necessário. Garçom móvel React é interface de leitura/seleção; operação LAN autenticada permanece no PWA existente até validar paridade. Fechamento dividido é **prévia matemática**, pagamento é registrado no caixa. Estoque avançado, financeiro, relatórios e integrações são páginas com conteúdo de estrutura, sem inventar endpoints nem dados.

## Estado e limitações

- Cada ação mantém estado React imutável, sem atualizar banco diretamente pelo navegador.
- Sem hospedar app, sem CDN, sem SaaS de pagamento nem emissão fiscal integrada.
- Documentos fiscais exigidos legalmente devem ser emitidos externamente; os recibos gerados pelo core são não fiscais. O sistema **somente exporta** CSV/JSON.
- Esta PR inclui o **frontend fonte** e testes unitários; ainda não substitui `apps/web/public` nem compõe o instalador Electron. Essa troca exige build e homologação de fluxo completo, em PR posterior.

## Telas cobertas

Nova venda, Personalização de item, Pagamento, Venda concluída, Pedidos, Produtos/cardápio, Controle de caixa, Primeiro acesso, Mesas/comandas, Cozinha KDS, Garçom mobile, Fechamento de mesa, Gestão geral, Estoque, Financeiro, Relatórios, Usuários/permissões, Integrações, Dispositivos LAN, Impressão e Exportação fiscal externa.

## Testes

`npm test` verifica dinheiro em centavos, divisão sem perda, limites de pagamento e imutabilidade. `npm run build` verifica que o app React compila. CI específica em `.github/workflows/ui-react-qa.yml`. Não fazer merge/release automático.
