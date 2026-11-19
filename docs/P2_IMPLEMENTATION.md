# P2 — Gestão de estoque, delivery e expansão self-hosted

Atualizado em 18/11/2026. Código nesta branch; **homologação física e de exposição pública não concluídas**.

## Implementado

### Estoque canônico e ficha técnica

- SQLite permanece **o único banco operacional e único writer**; migração `009_inventory_ledger.sql`.
- Ingredientes com unidade `g`, `ml` ou `unit`, quantidade inteira em milésimos da unidade e valores em centavos; sem ponto flutuante em dinheiro.
- Livro de movimentações `stock_movement` com entrada, ajuste auditado, custo de entrada, baixa por venda e valor do saldo. Operações transacionais e comandos idempotentes.
- Fichas técnicas por produto, com snapshot da receita no momento de adicionar cada linha do pedido. Combos somam as fichas de seus componentes, sem banco paralelo.
- Fechamento da venda aplica baixa e pagamento na **mesma transação SQLite**. Estoque insuficiente retorna conflito e **não registra pagamento nem encerra a venda**; não ocorre baixa dupla em replay.
- Relatório operacional de saldo, alerta mínimo, custo da mercadoria vendida (CMV) e margem bruta estimada das vendas fechadas. Devoluções reduzem receita líquida; **não fazem reposição automática de estoque**, pois isso depende da condição física do item.

### Cardápio digital e delivery

- Migrations `010_delivery_requests.sql`, `011_delivery_settings.sql`; cardápio público **desligado por padrão**, ativado manualmente pelo supervisor no painel.
- Interface administrativa de estoque, ficha técnica, relatórios, solicitações, aceite/rejeição e etapas de entrega. Interface pública responsiva em `/menu.html`.
- Solicitação remota fica como **PENDING**, sem fechar venda ou registrar pagamento. Preços e produtos são congelados na solicitação; o operador precisa aceitar, gerando pedido `DRAFT`, confirmá-lo e posteriormente receber pagamento no fluxo existente.
- Restrição básica de quantidade por solicitação/IP, sem dependência de CAPTCHA ou nuvem. Dados do cliente (nome, telefone e endereço) ficam no SQLite local e **não aparecem na resposta pública**.
- Portal público isolado é **opt-in**, escuta em `127.0.0.1` em outra porta, sem rotas de autenticação/caixa. Um proxy reverso HTTPS self-hosted pode publicar somente esse portal, nunca a porta administrativa.
- `PDV_PUBLIC_PORT=3435 npm start` inicia o portal separado, que permanece no loopback. `PDV_PUBLIC_MENU_ENABLED=true` habilita o cardápio inicialmente; a preferência também pode ser controlada no painel e persiste em SQLite.

### Preparação para múltiplas unidades

- Migração `012_installation_identity.sql` gera identificador persistente diferente para cada banco local. `GET /api/system/identity` informa identidade e `syncEnabled:false`.
- Existe **consolidação multiunidade manual opt-in**: pacotes JSON sem PII com revisões/hash, detecção de divergência e importação idempotente de resumos financeiros. Não há replicação automática de caixa, pedidos, fichas ou estoque entre lojas, nem gateway de pagamento obrigatório. Consultar [P2_FINALIZATION.md](P2_FINALIZATION.md).
- Todos os pagamentos eletrônicos atuais continuam registros manuais de confirmação; integrações pagas serão somente opt-in explícito.

## Finalização técnica

- Migrations 013–015: histórico de exportações/importações de unidades, registro de conflitos, anonimização de delivery e chave de reenvio idempotente por solicitação.
- Gestão na interface: aba **Unidades**, exportação JSON, importação local e visualização de conflitos; em **Delivery**, anonimização de finalizados e limpeza manual por prazo.
- A sincronização operacional entre lojas, replicação automática e integrações bancárias continuam explicitamente fora do escopo entregue.

## QA de código

- `npm test`: domínio TS, schema SQLite e testes de API, incluindo rollback de venda por estoque insuficiente, snapshot da ficha, baixa idempotente, custo médio, permissões, portal público restrito e aprovação do delivery.
- GitHub Actions: CI Linux/Windows, execução Playwright Chromium P2 e compilação Windows unsigned sem publicação. Verificar os resultados do commit na PR antes de merge.
- O Playwright navega pelo fluxo supervisor → cardápio → estoque → ficha técnica → venda → CMV/margem → cardápio público → pedido cliente → aceite. Imagens estão nos artifacts do workflow.

## Requisitos operacionais antes de exposição externa

- [ ] Validar HTTPS, DNS e proxy reverso self-hosted com configuração real; nunca expor o admin nem o banco SQLite diretamente.
- [ ] Fazer avaliação de privacidade/LGPD, retenção e descarte de nome, telefone e endereço; acrescentar política pública antes de operar via internet.
- [ ] Validar desempenho, abuso, limites, backup e restauração com carga real.
- [ ] Instalação Windows em ambiente físico, impressoras/balanças reais, dispositivos móveis com Wi-Fi instável.
- [ ] Revisar integração do exportador CSV/JSON com o emissor fiscal externo do estabelecimento. **Não há NFC-e integrada.**
- [ ] Desenhar regras de identidade, versão, conflitos e deduplicação para replicação entre lojas antes de habilitar qualquer sincronização.

## Core e custos

Todo o núcleo funciona localmente sem serviço pago, assinatura, dependência cloud ou taxa por transação obrigatória. O portal público pode ser servido com proxy open source instalado pelo próprio usuário. Registro de domínio, infraestrutura pública e provedores de pagamento podem ter custos **apenas se o usuário escolher**.

**Sem publicação de release automática.**