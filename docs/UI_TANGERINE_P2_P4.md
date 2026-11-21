# PDV Nexus 2.0 — Tangerine P2 + P3 + P4

## Base e limites

Esta etapa depende da PR #28 (P0/P1 Mantine + Lucide) e foi feita na branch
`feat/nexus-tangerine-p2-p4-20261121`, PR #32, voltada à branch-base P0/P1.
Não há migração de dados, serviços obrigatórios pagos, alterações de secrets,
novos servidores, rotas de API ou permissões de pagamento.

Pacotes **R$ 0/open source**, resolvidos por `npm ci`:
- Mantine UI 9.8.2 / `@mantine/charts` 9.8.2, licença MIT.
- Mantine DataTable 9.8.1, licença MIT.
- Recharts 3.10.1, licença MIT.
- Lucide React 1.77.0, licença ISC.
- Todas as fontes e imagens da aplicação permanecem locais.

## P2: restaurante

- `RestaurantTangerine.jsx`: mapa de mesas com busca/filtro e situação livre/ocupada;
  KDS com colunas **Novos → Em preparo → Prontos → Entregar**;
  garçom com seleção de mesa e catálogo de consulta;
  rateio de conferência sem liquidação automática.
- `TableOrderPanel.jsx`: superfícies Mantine, informações da comanda e seus controles existentes;
  as ações continuam registradas por `commandId` e `expectedRevision`.
- `nexus-restaurant.css`: desktop, tablet e celular, sem barras de navegação sobrepondo conteúdo.
- Fluxos `/api/orders/:id/lines`, `confirm`, `split`, `transfer-table`,
  KDS e `onCheckout` preservados.
- O garçom não lança produtos por uma cópia de estado: abre a comanda canônica no host.

## P3: gestão

- `ManagementTangerine.jsx`: DataTable para ingredientes, compras, vendas diárias,
  sessões de caixa e pedidos recentes, com charts de receita, CMV e mix de pagamentos.
- `BusinessPanels.jsx`: dados obtidos exclusivamente de `/api/stock/ingredients`,
  `/api/purchases` e `/api/reports/financial`.
- `App.jsx`: visão geral financeira e tabela de pedidos, carregadas por `React.lazy`.
- Nada inventa receita quando a API não oferece dados: gráficos usam estados vazios.
- As quantias são recebidas em centavos inteiros e convertidas para reais **somente para visualizar**;
  pagamentos e operações de estoque continuam no servidor.

## P4: testes e capturas

- `apps/react-ui/test/tangerine-p2-p4.test.mjs`: contratos de navegação,
  dependências open source, comandos canônicos e módulos financeiros.
- `scripts/qa-react-browser.mjs`: F3, venda, checkout em diferentes dimensões,
  persistência após reload e fluxo mobile.
- `scripts/qa-parity-browser-v2.mjs`: SQLite temporário, estoque, receitas,
  mesa, comanda, divisão, transições KDS, pagamento, delivery, financeiro,
  relatórios, gestão geral, tabelas, periféricos, prints e vídeo.
- `.github/workflows/qa-browser.yml`: CI de navegador com Chromium local, sem release.

Artefatos:
`artifacts/qa/parity-p2-*.png`, `parity-p3-*.png`,
`parity-p4-*.png` e `artifacts/qa/videos/parity-journey.webm`.
O workflow envia um ZIP de artefatos de QA para download.

Critérios de aceite antes de integrar à main:
1. `npm ci --prefix apps/react-ui --ignore-scripts --no-audit --no-fund`
2. `npm run ui:test` e `npm run ui:build`
3. `npm test` e `npm run test:api` em Linux e Windows
4. Browser QA com duas jornadas no SQLite temporário
5. Revisão de screenshots desktop e 390px, sem corte e sem erros de console
6. Compatibilização com a main atual e autorização de integração.
