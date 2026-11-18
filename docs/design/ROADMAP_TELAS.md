# PDV Nexus 2.0 — roadmap de telas

Base: restaurantes e lanchonetes; primeira operação = venda de balcão; mesma entidade de pedido para balcão, mesa, retirada e entrega. Referência: [Direção visual v1](DIRECAO_VISUAL.md).

## Primeira rodada — desenhar antes de codificar (P0)

| Ordem de design | Tela | Trabalho principal | Estados/decisões a prototipar | Dependência no código |
|---|---|---|---|---|
| 01 | **Nova venda — Caixa** | Buscar, filtrar e adicionar produtos ao pedido | Vazio, com itens, produto indisponível, salvando, erro recuperável | Layout React/Electron + catálogo SQLite |
| 02 | **Detalhes do item** | Selecionar tamanho, adicionais, remoções e observações | Obrigatório/opcional, limite, preço atualizado, editar item | Modificadores/snapshots ainda não modelados |
| 03 | **Pagamento** | Escolher meios e concluir venda | Dinheiro/troco, Pix/cartão manual, pagamento combinado, insuficiência, erro e retry idempotente | `payment` no schema; adapter/serviço ausente |
| 04 | **Venda concluída / comprovante** | Compreender resultado, imprimir ou iniciar novo pedido | Gravado/impresso/pendente de impressão; repetição segura | Comando de fechamento, spooler de impressão |
| 05 | **Pedidos** | Localizar e retomar pedido, cancelar com justificativa | Rascunho, aberto, fechado, cancelado, filtros | `sales_order`, `order_line` |
| 06 | **Produtos e categorias** | Cadastrar cardápio, preços e disponibilidade | Ativo/inativo, edição, pesquisa e prevenção de perda | `menu_category`, `menu_product` |
| 07 | **Abertura e fechamento de caixa** | Iniciar turno, sangria, suprimento, conciliar vendas | Aberto/fechado, diferença, autorização e histórico | Tabelas/serviço de sessão de caixa ainda ausentes |
| 08 | **Primeiro uso / estabelecimento e terminal** | Configurar negócio e terminal sem editar arquivos | Dados mínimos, teste, falha e retomar configuração | `restaurant`, `terminal`, serviço ainda ausente |
| 09 | **Impressão e diagnóstico** | Configurar impressora, testar e reimprimir | Offline, falha, fila, sucesso confirmado | Outbox existe como schema, spooler ausente |

**Próximo mockup a produzir: 02 — Detalhes do item**, mantendo a tela Caixa como contexto (modal/painel). Na sequência: 03 Pagamento e 04 Confirmação, para fechar um fluxo ponta a ponta.

## Restaurante — segunda rodada (P1)

| Ordem | Tela | Trabalho |
|---|---|---|
| 10 | Salão / mapa de mesas | Identificar ocupação e abrir mesa ou comanda |
| 11 | Detalhe da mesa / comanda | Adicionar pedidos e consultar consumo |
| 12 | KDS — painel da cozinha | Receber tickets, marcar preparo e entrega |
| 13 | Garçom PWA | Abrir mesa, buscar cardápio, enviar pedido pelo celular |
| 14 | Fechamento de mesa | Dividir conta por pessoa/itens/valor e reconciliar pagamentos |
| 15 | Retirada e delivery | Endereço/retirada, status operacional, formas de entrega |

## Gestão — terceira rodada (P2)

| Ordem | Tela | Trabalho |
|---|---|---|
| 16 | Estoque e fichas técnicas | Movimentação canônica, ingredientes e produção |
| 17 | Relatórios / financeiro | Vendas, recebimentos, conciliação e desempenho |
| 18 | Operadores e permissões | Acesso por papéis e trilha de auditoria |
| 19 | Servidor LAN, pareamento e backups | Configurar rede, dispositivos, backup e restauração |
| 20 | Configuração fiscal por UF | Homologação, emissão e tratamento de contingência conforme obrigação aplicável |

## Contratos e atenção

- Tela de finalização deve respeitar o modelo `DRAFT -> OPEN -> CLOSED` ou `CANCELLED`, sem mudar estados por estética.
- `payment` já tem estado `PENDING/CONFIRMED/REVERSED`, mas não há fluxo operacional de pagamento.
- Adicionais, descontos, divisão de conta, caixa e tickets de cozinha ainda exigem contratos próprios.
- A API LAN e os módulos de restaurante só devem prometer estados realmente persistidos pelo host.
- M0.2 e M1 da PR #1 continuam o marco técnico da primeira entrega; desenhar todas as telas não equivale a implementá-las.
- Emitir documento fiscal legalmente exigido não é substituído por comprovante não fiscal.

## Qualidade e governança

Critérios de UX: orientação imediata, ações previsíveis, feedback após persistência, recuperação sem perda de trabalho e navegação por teclado/toque. Implementar com testes de integração e E2E para venda duplicada, falha de persistência, reinício de processo e reimpressão. **Sem merge ou release sem autorização.**
