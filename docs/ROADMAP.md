# Roadmap inicial — restaurantes e lanchonetes

## M0.1 Fundação de contrato e integridade — este PR

- [x] Arquitetura e decisão offline-first/escritor único
- [x] Domínio puro de pedido: balcão, mesa, retirada, entrega
- [x] Cálculo em centavos, snapshots de itens e transições básicas
- [x] Migração inicial SQLite com constraints, idempotência e outbox (estrutura apenas)
- [x] Testes unitários e schema automatizados com `npm test`
- [x] Workflow CI no PR
- [ ] PR revisada / QA remoto e merge autorizados

## M0.2 Aplicativo inicial (P0)

- [ ] Electron seguro + React/Vite + TypeScript + layout do caixa
- [ ] Application service + repositório SQLite + migrador transacional
- [ ] Servidor local Fastify apenas quando autorizado/pareado
- [ ] CRUD mínimo de itens de cardápio no banco real
- [ ] Teste de criação/reabertura após reiniciar aplicativo
- [ ] Backup/restauração consistente com prova automatizada

## M1 Venda de balcão (P0)

- [ ] Cardápio, pesquisa de produto, carrinho e adicionais
- [ ] Comando criar/adicionar/confirmar pedido idempotente (HTTP e IPC)
- [ ] Pagamento dinheiro/Pix manual/cartão manual e troco
- [ ] Sessão de caixa, sangria/suprimento, cancelamento auditado
- [ ] Simular interrupção de energia, retry, corrida simultânea e duplicidade

## M2 Hardware e operação (P0)

- [ ] Impressoras ESC/POS USB/rede; fallback, spooler e teste em aparelho real
- [ ] Gaveta, leitor de códigos; balanças só após definir modelos
- [ ] Tela de diagnóstico de hardware e fila com observabilidade

## M3 Fiscal e conformidade (P0 antes de operação sujeita a emissão)

- [ ] Definir UFs, regimes tributários, NFC-e/outros documentos aplicáveis
- [ ] Validar ambiente de homologação, contingência, cancelamento e fiscal de produção

## M4 Restaurante avançado (P1)

- [ ] Mesas e comandas, cozinha por tickets, divisão de contas
- [ ] Garçom PWA autenticado e KDS em rede local
- [ ] Modificadores/combos e envio parcial para cozinha

## M5 Expansão (P2)

- [ ] Estoque por receitas/fichas técnicas, relatórios e financeiro avançado
- [ ] Multiunidade e sincronização opt-in, servidor próprio remoto
- [ ] Delivery/cardápio online e integrações pagas **apenas opcionais**

## Regra de entrega

Cada PR precisa de teste automatizado, checagem de regressão, evidência do fluxo afetado, nenhum segredo alterado e **sem merge/release automático sem autorização**.
