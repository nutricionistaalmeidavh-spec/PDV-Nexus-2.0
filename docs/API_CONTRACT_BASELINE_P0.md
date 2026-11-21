# P0 — Inventário de contratos e invariantes do PDV Nexus 2.0

Base auditada: `main@5deef752` (PR #25). Objetivo: preservar comportamento HTTP e efeitos duráveis antes do refactor P1. Este inventário descreve superfícies reais no código; nenhuma rota fiscal é ativada.

## Superfícies HTTP existentes

| Domínio | GET (consulta) | POST/PATCH (comandos existentes) | Arquivos de origem |
|---|---|---|---|
| Autenticação local | `/api/auth/status` | `/api/auth/setup`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/operators` | `operator-auth.mjs` |
| Catálogo e categorias | `/api/products`, `/api/categories`, `/api/products/:id/modifiers`, `/api/combos/:id`, `/api/catalog/barcode` | `/api/products`, `PATCH /api/products/:id`, `/api/categories`, `PATCH /api/categories/:id`, `/api/products/:id/modifiers`, `/api/combos` | `server.mjs`, `categories.mjs`, `restaurant.mjs`, `restaurant-extras.mjs` |
| Pedidos | `/api/orders`, `/api/orders/:id`, `/api/orders/:id/split` | `/api/orders`, `/api/orders/:id/lines`, `/api/orders/:id/confirm`, `/api/orders/:id/close`, `/api/orders/:id/cancel`, `/api/orders/:id/split`, `/api/orders/:id/refund` | `server.mjs`, `restaurant-extras.mjs`, `refunds.mjs` |
| Mesas e cozinha | `/api/tables`, `/api/restaurant/summary`, `/api/kitchen/tickets`, `/api/kitchen/events` (SSE) | `/api/tables`, `PATCH /api/tables/:id`, `/api/tables/:id/open`, `/api/orders/:id/transfer-table`, `/api/kitchen/tickets/:id/status` | `restaurant.mjs`, `server.mjs` |
| Caixa | `/api/cash/current` | `/api/cash/open`, `/api/cash/movements`, `/api/cash/close` | `cash-service.mjs`, `server.mjs` |
| Estoque e compras | `/api/stock/ingredients`, `/api/stock/report`, `/api/stock/batches`, `/api/suppliers`, `/api/purchases`, `/api/reports/margin` | `/api/stock/ingredients`, `/api/stock/ingredients/:id/receive`, `/api/stock/ingredients/:id/adjust`, `/api/stock/recipes/:productId`, `/api/suppliers`, `/api/purchases`, comandos de recebimento/cancelamento | `inventory.mjs`, `retail-supply.mjs`, `purchases.mjs` |
| Impressão e hardware | `/api/printer`, `/api/print/jobs`, `/api/hardware/scale/parse`, `/api/hardware/scale/label` | `/api/printer`, `/api/print/jobs/:id/send` | `server.mjs`, `retail-hardware.mjs` |
| Delivery | `/api/public/menu`, `/api/delivery/settings`, `/api/delivery/requests`, `/api/delivery/requests/:id`, `/api/delivery/orders`, `/api/delivery/privacy/report` | `/api/public/delivery/requests`, `/api/delivery/settings`, aceite/rejeição de solicitações, status da entrega e purge LGPD | `delivery.mjs`, `delivery-privacy.mjs`, `server.mjs` |
| Instalação e manutenção | `/api/system/config`, `/api/system/version`, `/api/system/update/check`, `/api/system/backups`, `/api/system/identity`, `/api/health` | `/api/system/config`, `/api/system/backup` | `server.mjs`, `install-identity.mjs`, `system-maintenance.mjs` |
| Multiunidade | `/api/sync/export`, `/api/sync/units`, `/api/sync/conflicts`, `/api/sync/operational/export`, `/api/sync/operational/peers`, `/api/sync/operational/status` | `/api/sync/import`, `/api/sync/operational/import`, `/api/sync/operational/pull`, resolução de conflito | `multiunit-sync.mjs`, `operational-mirror.mjs`, `server.mjs` |
| Relatórios e exportação | `/api/reports/financial`, `/api/exports/status`, `/api/exports/sales.csv`, `/api/exports/sales.json` | Sem emissor fiscal interno | `retail-finance.mjs`, `server.mjs`, `sales-export.mjs` |
| LAN e dispositivos | `/api/pairing/devices`, `/api/pairing/qr.svg` | `/api/pairing/start`, `/api/pairing/redeem`, `/api/pairing/revoke` | `server.mjs`, `device-pairing.mjs`, `lan-security.mjs` |

A tabela agrupa comandos de subrotas e não substitui revisão individual de autorização por método. `/api/fiscal/*` deliberadamente não possui implementação. O frontend é servido por `/ui/`; `/`, `/index.html`, `/restaurant.html` e `/kitchen.html` somente redirecionam para React.

## Baseline versionada: contratos de pedidos

| Verbo e rota | HTTP sucesso | Regras e efeitos |
|---|---|---|
| `POST /api/orders` | 201 `{order}` | Pedido DRAFT, revisão 0, comando idempotente, mesa única |
| `POST /api/orders/:id/lines` | 200 `{order}` | UUID por linha; snapshot de preço, nome e adicional; revisão otimista; estoque por receita em snapshot |
| `POST /api/orders/:id/confirm` | 200 `{order}` | Estado OPEN, tickets únicos de KDS vinculados a lineId |
| `POST /api/orders/:id/close` | 200 `{order,changeCents}` | Exige caixa aberto, pagamento exato, baixa de estoque atômica, ledger e outbox não fiscal únicos |
| `POST /api/orders/:id/cancel` | 200 `{order}` | Exige motivo e revisão; comanda confirmada exige supervisor; produção iniciada/pagamento presente impedem cancelamento |
| `GET /api/orders/:id` | 200 `{order}` | Projeção canônica de linhas, modificadores, combos, pagamentos, status e totais |

**Erros e garantias existentes:** 400 `INVALID_INPUT` para payload inválido, 403 `SUPERVISOR_REQUIRED` para cancelamento não autorizado, 404 `NOT_FOUND`, 409 `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `CASH_CLOSED` e proteção de KDS/pagamentos. Falha transacional não grava `command_receipt`, pagamento, outbox ou movimento parcial.

## Fonte oficial, acesso e escopo

- Uma única SQLite WAL por instalação, `order_line.id` como identidade durável; comprovante, KDS e rateio referenciam essa linha.
- Código de preço e estado de pedido isolado no domínio puro `packages/core/src/order.ts`; sem segundo estado financeiro.
- Pedidos + caixa respeitam autenticação local ou autorização LAN conforme `allowedOperator` e `roleAllows`.
- Auditoria usa `actor_id` do operador autenticado e não o usuário genérico; retries não gravam outra auditoria.
- Impressão é assíncrona e não fiscal. Falha de hardware não desfaz venda já fechada.
- O sistema local continua **R$ 0 / open source / self-hosted**. Não há mudança em secrets, migração de schema ou novas dependências.

## Matriz de testes existente + P0

| Domínio | Arquivos |
|---|---|
| Domínio e estado | `packages/core/test/*` |
| Contratos snapshots e efeitos de pedido | `apps/server/tests/test_p0_contract_snapshots.test.mjs` |
| API, idempotência e impressão TCP | `apps/server/tests/test_api.test.mjs` |
| Mesas, KDS, revisão e autorização | `apps/server/tests/test_restaurant.test.mjs`, `test_artisys_regressions.test.mjs` |
| Estoque, receitas e rollback | `apps/server/tests/test_p2_inventory.test.mjs` |
| Caixa, usuários e auditoria | `apps/server/tests/test_hardening.test.mjs`, `test_artisys_regressions.test.mjs` |
| Persistência, backup e schema | `apps/server/tests/test_maintenance.test.mjs`, testes Python de migração |
| Hardware/ESC-POS e comprovantes | `apps/server/tests/test_hardware_simulation.test.mjs`, `test_non_fiscal_receipt.test.mjs` |
| UI desktop/mobile | `scripts/qa-react-browser.mjs`, `scripts/qa-parity-browser-v2.mjs` |

**Gate P1:** os testes P0 passam antes da extração e continuam passando depois; CI Linux/Windows, Playwright e instalador só podem ser reportados como aprovados quando a revisão final for executada. Instalação e periféricos físicos continuam exigindo homologação separada.
