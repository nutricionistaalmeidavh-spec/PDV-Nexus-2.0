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
- [x] Consolidação multiunidade manual opt-in de resumos financeiros, com hash, revisão, idempotência e registro de conflitos
- [x] Anonimização auditável de dados de delivery e proteção contra pedidos duplicados em retry
- [ ] Sincronização operacional automática entre lojas e estoque compartilhado: não habilitada, demanda arquitetura própria
- [ ] Gateway de pagamento externo: integração opcional e explícita, sem bloquear core
- [ ] Validar implantação pública segura, privacidade e hardware físico

Detalhes e limites: [P2_IMPLEMENTATION.md](P2_IMPLEMENTATION.md) e [P2_FINALIZATION.md](P2_FINALIZATION.md).

## Gates obrigatórios

**Sem merge, release, publicação nem licença de produção sem autorização.** Nenhuma chave/secret pode entrar no Git. `npm test` precisa passar. QA de hardware não pode ser inferido de testes simulados. A responsabilidade por documentos fiscais legalmente exigidos permanece no fluxo externo. O core permanece gratuito, open source na stack e self-hosted, sem serviços pagos obrigatórios.


### Extensão de homologação — 20/11/2026

- [x] Espelhos operacionais automáticos **somente leitura**, opt-in e HTTPS, com papéis e validação de revisão (não são operações distribuídas de escrita).
- [x] Simulador de impressão TCP ESC/POS e backup/restauração de venda no CI.
- [ ] Periféricos físicos, instalação real Windows, mobile real e publicação HTTPS validada em ambiente do estabelecimento.
- [ ] Replicação bidirecional multiwriter de pedidos e estoque: **não implementada**, necessita arquitetura/escopo separado.

Instruções: [Homologação self-hosted](HOMOLOGACAO_SELFHOSTED.md).


## Fechamento de software P0–P3 — 21/11/2026

Esta seção consolida o escopo ampliado de confiabilidade, hardware, gestão e distribuição. Os checkboxes acima permanecem como histórico dos milestones anteriores.

- [x] **P0:** licenciamento MIT consistente; lockfiles npm versionados; CI Linux/Windows com `npm ci`; React estoque/financeiro/relatórios com dados de APIs canônicas; onboarding grava estabelecimento/terminal com idempotência; testes de pedidos/pagamentos mantidos.
- [x] **P1:** EAN-13 de produtos, diagnóstico de etiquetas de balança e parsing inicial Toledo/Filizola, impressão TCP/COM/Winspool opcional e testes de contratos simulados. Nada obriga drivers de balança ou serial em instalações sem equipamento.
- [x] **P2:** fornecedores, compras pendentes com recebimento único e transacional, lotes, vencimento FEFO, estoque por ingrediente, CMV e relatórios financeiros locais. Nenhum segundo saldo canônico.
- [x] **P3:** backup sob demanda validado, pré-migração SQLite com snapshot, restauração offline verificável, consulta manual a releases e workflows de QA Windows/navegador/instalador, sem publicação automática.
- [ ] **Homologação física obrigatória:** balança identificada por modelo/protocolo, USB/COM/driver de impressão, leitor físico, Wi-Fi e certificado em dispositivo móvel real, instalação sobre máquina do cliente, recuperação em falha de energia e avaliação de SmartScreen. CI e máquinas virtuais não comprovam esses itens.
- [ ] **Emissor fiscal integrado:** fora do escopo por decisão de produto. Mantidos comprovantes não fiscais e exportação CSV/JSON para fluxo externo.

Guia de recuperação: [RESTAURACAO_E_ATUALIZACAO.md](RESTAURACAO_E_ATUALIZACAO.md). Licença e custo: [LICENSING.md](LICENSING.md).

## Refatoração arquitetural P0/P1 — 21/11/2026 (PR #26)

- [x] **P0 — Proteção/contratos:** inventário de superfícies HTTP, snapshots de pedidos, KDS, caixa, comprovante e idempotência, testes de banco e trilha de auditoria. Documento: [API_CONTRACT_BASELINE_P0.md](API_CONTRACT_BASELINE_P0.md).
- [x] **P1 — Backend:** extração de pedidos, linhas, projeção SQLite, validações, autorização gerencial, idempotência e auditoria para serviços dedicados, preservando rotas e schema SQLite. Documento: [REFACTOR_P0_P1_20261121.md](REFACTOR_P0_P1_20261121.md).
- [x] **P2 — Restaurante:** separação de mesas, adicionais e KDS em serviços transacionais e testes concorrentes (PR #29).
- [x] **P3 — React:** telas extraídas, navegação por papel e hooks de host/KDS isolados (PR #29), sem segundo ledger.
- [x] **P4 — Homologação automatizada:** CI, Playwright para todas as abas desktop/mobile, vídeos, prints e manifesto (PR #29). **Homologação física real permanece pendente**, sem simulá-la.

Checklists [x] indicam alteração em código/teste da branch, **não** homologação física. A PR permanece separada da main até autorização de merge; workflow verde do commit final é obrigatório.

Detalhes de P2–P4: [REFACTOR_P2_P3_P4_20261121.md](REFACTOR_P2_P3_P4_20261121.md). As marcações [x] são entregas de branch, sujeitas à validação da PR final; não representam merge nem release.


## Complemento P3 — Correções da auditoria de operação (22/11/2026, PR #38)

Esta etapa não substitui a refatoração React P3 histórica da PR #29 nem marca QA físico como concluído. É a continuação da PR #37 (P0–P2).

- [x] **Electron:** cancelar pedidos, devolver vendas e editar nome/preço/EAN de produtos e categorias por diálogos React acessíveis, sem `window.prompt`. Confirmação e motivos são enviados à API canônica auditada.
- [x] **KDS:** eventos SSE por `fetch` autenticado (token de dispositivo no cabeçalho), com reconexão e polling de recuperação a cada 30 segundos. Nenhuma segunda fila ou pedido local.
- [x] **Balança:** recusar valor decimal em quadro sem unidade `kg` ou `g` para não converter inadvertidamente gramas em quilos.
- [x] **Comprovante:** manter natureza não fiscal e UUID curto de auditoria; exibir empresa, data/hora em São Paulo, mesa, pagamentos e troco do snapshot imutável, se fornecidos; arquivos legados seguem válidos.
- [x] **Documentação:** corrigir referências desatualizadas sobre React, versão de migração dinâmica e leitura por peso.
- [ ] **Gates finais na HEAD:** CI Linux/Windows, testes React, Playwright browser, diagnósticos Windows e instalador unsigned em runner descartável.
- [ ] **Homologação física:** impressão real, balança por modelo/protocolo, segurança LAN, tablets/PWA e instalação no PC dos clientes permanecem pendentes; não inferir de simuladores.

A PR #38 é **empilhada sobre a #37**, não deve ser mesclada diretamente na `main` antes da base. Nenhuma release é publicada automaticamente e não existe dependência de SaaS pago. O QR público de restaurante continua apenas visualização; pedidos usam garçom ou tablet fixo na mesa Pro.
