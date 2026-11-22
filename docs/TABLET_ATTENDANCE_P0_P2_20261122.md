# PDV Nexus: atendimento de mesa, tablets fixos e Painel Central (P0–P2)
Data: 2026-11-22. Implementação em branch; não publicar release sem QA.

## Dois planos comerciais; Core MIT inalterado

- **Essencial:** uma unidade, PDV, caixa, mesas/comandas, KDS, delivery, estoque e cardápio QR **para visualização**, com pedido registrado pelo garçom.
- **Pro:** tudo do Essencial, mais **tablet fixo pareado por mesa**, início do atendimento pelo cliente, escolha entre aprovação manual ou envio automático ao KDS, solicitação de conta com bloqueio de pedidos, painel central de retiradas, auditoria e ferramentas avançadas.
- O **Core R$ 0** continua self-hosted e open source, não é um terceiro plano. Recursos já publicados sob licença MIT não serão bloqueados ou removidos. A implementação deste módulo no repositório MIT não cria por si só exclusividade comercial; a empacotação dos planos e os serviços adicionais deverão ser definidos separadamente.
- Nenhum provedor externo obrigatório; tablets, KDS e caixa usam o SQLite do host como única fonte canônica. Na LAN é obrigatório HTTPS com certificados locais configurados.

## Auditoria do código existente

Antes desta branch já existiam: `sales_order`, `order_line`, `payment`, `kitchen_ticket`, QR com aprovação, idempotência `command_receipt`, autenticação local, pareamento de garçons/KDS e fechamento de mesa por pagamento integral. O fechamento não removia tickets; faltava apresentar e rastrear explicitamente os pedidos pagos ainda em preparo. Não duplicar essas tabelas nem manter estado financeiro derivado no tablet.

## P0 — segurança e integridade

1. Identificador imutável da visita: **`sales_order.id`**. A mesa pode voltar a ficar livre quando o pedido é `CLOSED`, mesmo que ainda haja tickets pendentes. O KDS apresenta `attendanceId`, `paid`, mesa de origem e garçom.
2. Estados independentes: pagamento (`OPEN/CLOSED`) e produção (`PENDING/PREPARING/READY/SERVED`). `CLOSED` não exclui tickets nem permite cobrar novamente.
3. Estado `close_requested_at` bloqueia novos itens no tablet, pedidos QR públicos/pendentes e rota normal de inclusão de itens. Reabertura exige garçom identificado ou supervisor e motivo auditado.
4. `order_waiter` guarda **um responsável atual**, transferível. `order_line.waiter_device_id` guarda o responsável quando o item foi criado. Eventos de troca mantêm os atores originais no `audit_log`. Os IDs vêm do pareamento nominal de dispositivo; não vincular várias pessoas a um dispositivo compartilhado.
5. Pedido `READY` sem responsável aparece no painel central. Garçom pode assumir uma única vez, com `UNIQUE(ticket_id)`, sem opção de devolver. Entrega conclui `SERVED`, registrada com autor e hora.
6. O caixa mostra aviso quando há preparo pendente; recebe normalmente e libera a mesa após pagamento integral. Pagamentos parciais não marcam `CLOSED`.
7. Migração 022 é aditiva e possui backup SQLite anterior para bancos existentes abaixo da versão 22.

## P1 — autoatendimento fixo

- Administrador vincula um tablet por mesa na configuração da cozinha e pizzaria, gera credencial hexadecimal aleatória de 256 bits e recebe o valor somente no ato do pareamento. No banco persiste apenas SHA-256. Novo pareamento revoga o dispositivo anterior.
- Tablet usa `/tablet.html` no **servidor LAN HTTPS local** e envia `Authorization: Bearer <token>`. Não tem acesso às rotas administrativas, a outras mesas ou ao banco diretamente.
- `POST /api/tablet/start` abre ou reutiliza exatamente uma comanda ativa e cria capacidade de pedido restrita àquela sessão. Idempotência por `commandId`; dupla abertura retorna a visita existente.
- `POST /api/tablet/orders` reaproveita validação de catálogo, valores, adicionais, QR e deduplicação `clientRequestId` do core. `autoAccept=false` exige aprovação do garçom; `true` aceita e despacha ao KDS.
- `POST /api/tablet/close-request` bloqueia novos itens, inclusive requisições diretas. O tablet passa a exibir "Conta solicitada"; reabertura auditada em `POST /api/orders/:id/reopen-service`.
- Após pagamento integral, a mesa fica livre, a sessão anterior não é reutilizada e o tablet volta à abertura. O pedido antigo segue no KDS pelo identificador de atendimento.

## APIs novas

| Rota | Papel |
|---|---|
| `POST /api/tables/:id/tablet/pair` | Supervisor: emitir credencial para tablet fixo |
| `GET/POST /api/tablet/settings` | Supervisor para escrita; seleção manual/automática por estabelecimento |
| `GET /api/tablet/state` | Tablet: mesa, sessão, cardápio e bloqueio |
| `POST /api/tablet/start` | Tablet: iniciar/reutilizar atendimento |
| `POST /api/tablet/orders` | Tablet: enviar pedido com idempotência |
| `GET /api/tablet/requests/:id` | Tablet: acompanhar aprovação |
| `POST /api/tablet/close-request` | Tablet: solicitar conta e bloquear |
| `POST /api/orders/:id/reopen-service` | Garçom/supervisor: cancelar solicitação com motivo |
| `POST /api/orders/:id/waiter` | Garçom responsável/supervisor: atribuir/transferir atendimento |
| `GET /api/attendance/me` | Garçom pareado: identidade de dispositivo |
| `GET /api/attendance/overview` | Solicitações de conta, tickets prontos, preparo pago |
| `POST /api/attendance/tickets/:id/claim` | Garçom: assumir ticket sem responsável |
| `POST /api/attendance/tickets/:id/deliver` | Responsável: confirmar entrega |
| `GET /api/attendance/analytics` | Indicadores read-only sobre os registros canônicos |

## P2 — o que está entregue e o que continua pendente

**Nesta branch:** endpoint read-only de métricas operacionais (tickets por etapa, preparados após pagamento, entregas registradas e pagamentos confirmados). Não é projeção de demanda nem BI preditivo.

**Futuro, sem simular conclusão:** dashboards gerenciais aprofundados, previsão de demanda e ruptura, compras sugeridas e painel de gestão centralizado online para múltiplas unidades. A sincronização operacional bidirecional não é implementada aqui; permanece o mecanismo de exportação/consolidação já existente no Core.

## Testes e aceitação

- Executar `npm test` e `npm run ui:test && npm run ui:build` em Node >=22.16.0, além do novo `apps/server/tests/test_attendance_tablet_p0_p2.test.mjs`.
- Repetir envio com mesmo `clientRequestId` não pode duplicar itens nem cobrança; mudar corpo mantendo ID deve causar conflito.
- Dois tablets/garçons tentando assumir o mesmo ticket: exatamente um sucesso.
- Após solicitação de conta, novas linhas e pedidos devem ser negados até reabertura auditada.
- Pagamento integral antes do preparo: pedido antigo continua KDS `paid=true`, nova visita na mesma mesa tem ID diferente.
- Rotação de credencial: token antigo recebe 401; tentativa de usar um token qualquer não expõe mesa.
- Testar restaurar SQLite antigo e executar migração 022; `PRAGMA integrity_check` e `foreign_key_check` sem falhas.
- QA manual em tablet Android/iPad com HTTPS LAN, offline do servidor, tela sensível ao toque, fluxo de caixa e entrega.

**Limites:** nenhuma release, merge ou migração em cliente foi executada por esta branch. Testes físicos (tablet, rede, impressora) não são substituídos pelos testes automatizados.
