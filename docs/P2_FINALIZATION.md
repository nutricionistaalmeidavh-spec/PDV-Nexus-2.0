# P2 — Encerramento técnico: consolidação multiunidade, privacidade e delivery seguro

## Estado e limites

Este marco implementa **consolidação manual e opt-in** de indicadores financeiros entre instalações self-hosted. Não existe replicação automática de pedidos, produtos, fichas técnicas, estoque, saldos de caixa ou dados de clientes entre lojas. Cada loja permanece dona do seu banco SQLite, sem multiwriter distribuído. A sincronização operacional bidirecional contínua requer arquitetura própria e pertence a um marco posterior; não deve ser anunciada como entregue no P2.

Os módulos existentes de estoque, receitas, CMV, margem bruta e delivery continuam funcionando offline e sem serviços pagos. O escopo fiscal continua exclusivamente **comprovante não fiscal e exportador CSV/JSON para emissão externa**.

## Consolidação de unidades — fluxo real

1. Cada instalação possui `installation_identity.unit_id` estável. No painel **Unidades**, um supervisor exporta o resumo JSON do próprio caixa. O pacote contém `schemaVersion`, `unitId`, `revision`, `previousHash`, dias agregados e `hash` SHA-256.
2. O pacote contém **somente** data, quantidade de pedidos, faturamento bruto, devoluções, CMV e faturamento líquido. Não inclui nomes, telefones, endereços, itens nem dados de pagamento individual.
3. Outro supervisor importa o arquivo na unidade consolidora. O sistema valida o formato, limites, sequência, hash, data e integridade aritmética. A primeira importação de um par é bootstrap; as seguintes precisam ser a revisão sucessora, ligada ao hash anterior.
4. Repetir a mesma revisão não duplica valores. Revisão antiga, diferente ou salto de histórico é recusado com conflito registrado sem sobrescrever a versão anterior. O alerta pode ser descartado manualmente; isso **não força uma sobrescrita**.
5. `/api/sync/units` mostra a unidade local e os resumos importados, calculando o total consolidado sem inserir pedidos fictícios. Se duas lojas tiverem preços ou cardápios diferentes, seus dados operacionais não são alterados.

**Rotas locais autenticadas do supervisor:** `GET /api/sync/export`, `POST /api/sync/import` (`commandId` + `snapshot`), `GET /api/sync/units`, `GET /api/sync/conflicts` e `POST /api/sync/conflicts/:id/dismiss`. Operador de caixa não tem acesso. Exportação e importação não exigem API externa, DNS, cloud ou internet. O arquivo JSON **não é assinatura digital**, comprovante bancário ou documento fiscal: hash detecta integridade de conteúdo, mas não autentica a origem de terceiros. Troque arquivos apenas por canal confiável.

**Operação crítica:** unidades locais não devem usar o mesmo arquivo SQLite nem tentar sincronizar gravações de estoque/cash/order. Não existe conflito financeiro silenciosamente resolvido.

## Delivery sem solicitações duplicadas

O formulário público envia `clientRequestId` UUID. A chave é mantida entre tentativas da mesma solicitação e gravada no banco, com hash dos dados enviados. Uma repetição retorna o protocolo original; reutilizar a chave com conteúdo diferente resulta em conflito. Solicitações antigas sem a chave ainda são aceitas para manter compatibilidade.

O cardápio permanece desligado por padrão, com acesso por portal isolado em `127.0.0.1` e proxy HTTPS opt-in. O cliente nunca cria venda paga diretamente. O supervisor aceita ou recusa cada solicitação.

## Privacidade e retenção

- Uma solicitação rejeitada pode ser anonimizada após decisão. Uma solicitação aceita exige entrega encerrada/cancelada e pedido associado encerrado/cancelado. Uma solicitação pendente não pode ser anonimizada por engano.
- A ação substitui nome/telefone/endereço por marcadores não identificadores, limpa observações e motivo de recusa armazenado e remove texto livre do log de auditoria da recusa; preserva IDs, totais, status, itens e vínculo contábil. Operação auditável e idempotente.
- O supervisor pode executar manualmente limpeza de solicitações elegíveis com prazo de 30–3650 dias. A cada operação são processados até 500 registros, sem tarefas ocultas ou acesso a terceiros.
- A retenção legal, informação ao titular e publicação da política de privacidade devem ser configuradas pelo responsável do estabelecimento antes da exposição do delivery à internet.

**Rotas:** `GET /api/delivery/privacy/report`, `POST /api/delivery/requests/:id/anonymize` e `POST /api/delivery/privacy/purge` (parâmetro `olderThanDays`).

## Testes e implantação

- Testes integração com dois bancos independentes, repetição de pacote, chain hash, alteração de payload, cargo do operador, estoque sem mutação remota, estado financeiro e anonimização.
- Teste de retry do cardápio com UUID, verificando não duplicar pedidos em caso de envio repetido.
- CI Linux/Windows, Playwright Chromium com telas **Unidades** e **Proteção de dados**, e build de instalador Windows unsigned em branch, sem GitHub Release.
- Antes de distribuir a clientes: teste instalação e restauração em Windows real, dispositivos de impressão/balanças e Wi-Fi, proxy HTTPS seguro e adequação LGPD, com validação do exportador contábil externo.

## Política de custo

O núcleo não exige assinatura ou API paga. Infraestrutura pública, certificado/domínio ou adquirente são escolhas **opcionais**, nunca criadas silenciosamente como dependência. Nenhum segredo e nenhum token ficam no Git.
