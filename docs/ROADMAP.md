# Roadmap — PDV Nexus 2.0 (restaurantes e lanchonetes)

Status em 18/11/2026. **CHECKED** significa código + teste automatizado implementados, não homologação comercial.

## M0.1 — Fundação (PR #1)

- [x] Domínio puro, SQLite migrations, idempotência e outbox
- [x] Testes de domínio/estrutura e CI
- [ ] Merge autorizado na main

## P0 — Operação de balcão (PR #10 + complementos PR #11)

- [x] Shell Electron, API HTTP local, SQLite WAL e backup/restauração offline
- [x] Catálogo, carrinho, snapshot, pedido idempotente, histórico, revisão otimista
- [x] Caixa e pagamentos manuais, troco, duas formas de pagamento, sangria e suprimento
- [x] Devolução integral **manual**, ledger financeiro auditável, sem supor reembolso automático via Pix/adquirente
- [x] ESC/POS **TCP simulado**, fila persistente e falha de impressão sem desfazer venda
- [x] Rede LAN opt-in exigindo HTTPS + tokens por perfil; sem exposição por padrão
- [ ] Windows/Linux: validar instalador assinado/não assinado e restauração em máquinas reais
- [ ] USB/balanças/gaveta/leitores: drivers, impressoras reais, diagnósticos e testes
- [ ] Login e permissões por operador **no caixa local**
- [ ] NFCE/SAT/outros fiscais conforme UF: integração, certificados, CSC e homologação — **bloqueador de lançamento comercial**
- [ ] Decidir migração de interface para React/Vite (o protótipo é web nativo)

## P1 — Restaurante e lanchonete (PR #11)

- [x] Cadastro/renomeação, abertura, reuso e transferência de mesas sem conflito
- [x] Comanda única por mesa e revisão otimista
- [x] Adicionais, observações, snapshots e preço efetivo por item
- [x] KDS por linha, deduplicação e estados `PENDING→PREPARING→READY→SERVED`
- [x] Garçom responsivo, PWA instalável sob HTTPS confiável e perfis LAN
- [x] Pagamento dividido em duas formas e liberação de mesa após fechamento
- [x] Testes reais de API SQLite, LAN HTTPS/TLS e papéis com CI Linux/Windows
- [ ] Validar no celular físico, certificado confiável, impressora de cozinha e Wi-Fi intermitente
- [ ] Pareamento guiado por QR/PIN (hoje usa token colado pelo operador)
- [ ] Atualização push em tempo real de tickets (hoje KDS consulta a cada 4 s)
- [ ] Combos, adicionais com estoque e divisão de conta por convidado/item (hoje split é por **meio de pagamento**)

## P2 — Expansão

- [ ] Fichas técnicas e estoque por ingrediente
- [ ] Multiunidade e sincronização opt-in com protocolo de conflitos
- [ ] Delivery/cardápio público, integrações comerciais opt-in

## Gates obrigatórios

**Sem merge, release, publicação nem licença de produção sem autorização.** Nenhuma chave/secret pode entrar no Git. `npm test` precisa passar. QA de hardware/fiscal não pode ser inferido de testes simulados. O core permanece gratuito, open source na stack e self-hosted, sem serviços pagos obrigatórios.
