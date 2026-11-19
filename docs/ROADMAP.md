# Roadmap — PDV Nexus 2.0 (restaurantes e lanchonetes)

Status em 18/11/2026. **CHECKED** significa código + teste automatizado implementados, não homologação comercial.

## M0.1 — Fundação (PR #1)

- [x] Domínio puro, SQLite migrations, idempotência e outbox
- [x] Testes de domínio/estrutura e CI
- [x] Integrado à `main` por autorização do proprietário

## P0 — Operação de balcão (PR #10 + complementos PR #11)

- [x] Shell Electron, API HTTP local, SQLite WAL e backup/restauração offline
- [x] Catálogo, carrinho, snapshot, pedido idempotente, histórico, revisão otimista
- [x] Caixa e pagamentos manuais, troco, duas formas de pagamento, sangria e suprimento
- [x] Devolução integral **manual**, ledger financeiro auditável, sem supor reembolso automático via Pix/adquirente
- [x] ESC/POS **TCP simulado**, fila persistente e falha de impressão sem desfazer venda
- [x] Rede LAN opt-in exigindo HTTPS + tokens por perfil; sem exposição por padrão
- [x] Build unsigned do instalador Windows em GitHub Actions, sem publicar release
- [ ] Windows/Linux: validar execução instalada, reinício, SmartScreen e restauração em máquinas reais
- [ ] USB/balanças/gaveta/leitores: drivers, impressoras reais, diagnósticos e testes
- [x] Login de operador local, senha com scrypt, supervisor e caixa com permissões e sessões com expiração
- [x] Comprovantes não fiscais + exportação de vendas CSV/JSON para emissão fiscal externa; sem emissão integrada e sem travar o caixa
- [ ] Validação de aderência do arquivo ao fluxo do escritório contábil/fornecedor de emissão externa escolhido pelo estabelecimento
- [ ] Avaliar migração futura para React/Vite (a interface atual é web nativa, funcional sem CDN)
- [ ] QA E2E real de navegador e verificação de capturas: `Browser QA (headless, no release)`

## P1 — Restaurante e lanchonete (PR #11)

- [x] Cadastro/renomeação, abertura, reuso e transferência de mesas sem conflito
- [x] Comanda única por mesa e revisão otimista
- [x] Adicionais, observações, snapshots e preço efetivo por item
- [x] KDS por linha, deduplicação e estados `PENDING→PREPARING→READY→SERVED`
- [x] Garçom responsivo, PWA instalável sob HTTPS confiável e perfis LAN
- [x] Pagamento dividido em duas formas e liberação de mesa após fechamento
- [x] Testes reais de API SQLite, LAN HTTPS/TLS e papéis com CI Linux/Windows
- [ ] Validar no celular físico, certificado confiável, impressora de cozinha e Wi-Fi intermitente
- [x] Pareamento via QR local + PIN único de seis dígitos, credencial hash no SQLite, expiração e revogação
- [x] KDS com stream SSE em tempo real e reconexão; polling defensivo a cada 30 s
- [x] Combos de preço fixo com snapshot de composição e divisão da comanda por convidado/quantidade
- [ ] Pagamentos parciais independentes por pessoa, combos de escolhas dinâmicas e estoque de ingredientes

## Integração P0/P1

PRs #1, #10, #11, #12 e #13 integradas à `main` em 18/11/2026 com autorização explícita. Nenhuma release publicada. Compilação unsigned não comprova funcionamento de USB nem instalação em PCs reais.

## P2 — Estoque, delivery e expansão self-hosted

- [x] Estoque por ingrediente, livro auditável de entradas/saídas e fichas técnicas com snapshot
- [x] Baixa transacional no fechamento com idempotência e bloqueio por saldo insuficiente
- [x] CMV, margem bruta estimada e alertas de estoque mínimo
- [x] Cardápio público e delivery opt-in: pedidos pendentes exigem aprovação do operador
- [x] Portal público separado no loopback para proxy HTTPS self-hosted sem expor admin
- [x] Identificador persistente por instalação para futura multiunidade
- [ ] Sincronização multiunidade opt-in, versão/conflitos e deduplicação em rede — NÃO habilitada
- [ ] Gateway de pagamento externo: integração opcional e explícita, sem bloquear core
- [ ] Validar implantação pública segura, privacidade e hardware físico

Detalhes e limites: [P2_IMPLEMENTATION.md](P2_IMPLEMENTATION.md).

## Gates obrigatórios

**Sem merge, release, publicação nem licença de produção sem autorização.** Nenhuma chave/secret pode entrar no Git. `npm test` precisa passar. QA de hardware não pode ser inferido de testes simulados. A responsabilidade por documentos fiscais legalmente exigidos permanece no fluxo externo. O core permanece gratuito, open source na stack e self-hosted, sem serviços pagos obrigatórios.
