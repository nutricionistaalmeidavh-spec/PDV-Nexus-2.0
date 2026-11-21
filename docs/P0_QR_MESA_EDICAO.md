# P0 — Edição individual e QR Code da mesa

## Escopo implementado

- Edição em `POST /api/orders/:orderId/lines/:lineId/edit`: quantidade 1–100, observação e `modifierIds`; mantém o `lineId`, snapshot de preço-base, revisão otimista, `commandId` idempotente e histórico imutável.
- Cancelamento em `POST /api/orders/:orderId/lines/:lineId/cancel`: motivo obrigatório, sem apagar a linha original, sem cobrar nem baixar estoque do item. Cancela o ticket associado, deixando aviso de correção no KDS por 12h.
- Eventos em `GET /api/orders/:orderId/line-history`; o caixa e o KDS exibem a alteração. Preparos iniciados exigem supervisor local ou gerente LAN; vendas encerradas nunca são alteradas.
- `POST /api/tables/:id/qr` gera capability criptográfica por comanda, com somente SHA-256 persistido, expiração em 12h e rotação. Emissão não é reexecutada por `commandId`: replay responde conflito sem invalidar o QR anterior.
- `GET /api/public/table/:token` oferece cardápio/modificadores da mesa. `POST /api/public/table/:token/requests` aceita 1–20 linhas, quantidades, notas e variações, com retry por `clientRequestId`.
- `GET /api/public/table/:token/requests/:requestId` retorna status; o operador visualiza fila e aceita/rejeita em `/api/table-requests/:id/(accept|reject)`.
- Por padrão, pedidos ficam `PENDING`. O supervisor pode ativar `autoAccept` ao emitir QR: nesse caso a comanda é confirmada e os tickets aparecem no KDS automaticamente.
- Ações são transacionais no SQLite local e não criam bancos ou provedores externos. O público **nunca** acessa as APIs de caixa/administrativas.

## Uso no restaurante

1. No desktop, abra a mesa e sua comanda em **Mesas**.
2. Configure o portal de clientes opcionalmente no mesmo PC: `PDV_PUBLIC_PORT=3435 npm start`, escutando **somente** `127.0.0.1` na porta 3435.
3. Para permitir acesso por celular na LAN, publique **somente** o portal 3435 com proxy reverso HTTPS self-hosted (ex.: Caddy ou Nginx). Nunca publique a porta administrativa 3434 para clientes. Configure certificado confiável nos celulares; DNS de rede local e CA privada podem ser usados sem serviços pagos.
4. Em **Gerenciar mesa → QR Code**, informe a origem HTTPS do portal, por exemplo `https://menu.restaurante.local/`; selecione aprovação manual ou automática e gere o QR.
5. Mostre ou imprima o QR. O cliente acessa `/table.html?token=...`, personaliza itens e acompanha o status, sem login nem pagamento externo.
6. Em modo manual, o atendente usa **Gerenciar mesa → Solicitações** para aprovar ou rejeitar cada solicitação; aprovação envia direto ao KDS.
7. Ao fechar ou transferir a mesa, o QR anterior fica inválido; gerar novo QR revoga o anterior. Tokens são sigilosos: não incluir links em logs ou material público além da própria mesa.

## Restrições e segurança

- O portal de clientes é opt-in e separado do cardápio delivery. A funcionalidade de QR da mesa não habilita delivery público.
- HTTPS confiável é necessário para os celulares; HTTP é aceito **somente** em localhost para desenvolvimento.
- Não existe fila de escrita offline em celulares: se a rede cair antes da confirmação do host, o cliente deve repetir a mesma solicitação (mesmo ID). O frontend preserva esse ID até obter resposta ou alterar o pedido.
- Não há captura de pagamento ou NFC-e/NF-e; o escopo fiscal permanece exportação externa e comprovante não fiscal.
- A emissão de QR não persiste token bruto, inclusive na tabela de idempotência. O valor exibido uma única vez deve ser salvo/imprimido pelo responsável.
- Relatórios, exportações e consumo de estoque ignoram itens cancelados, mas histórico e auditoria preservam cada ação.
- A evolução usa migration aditiva `019_table_qr_line_edits.sql` com snapshot seguro pré-upgrade e restauração compatível.

## Testes de aceite

`npm test`, `npm run ui:test`, `npm run ui:build`; API real SQLite com QR manual/automático, tokens inválidos/rotacionados, reenvio idempotente, edição/cancelamento por lineId, revisão otimista, KDS, backup/restore e suites anteriores.

**Homologação física pendente:** abrir QR e imprimir em PC Windows + celular real na LAN HTTPS, validar roteador/Wi-Fi intermitente e impressora de cozinha. Passagem na CI é diferente de homologação comercial.

Core R$0, self-hosted, open source. Nenhuma conta, assinatura, nuvem, token de API externo ou serviço pago é obrigatório.
