# PDV Nexus 2.0

PDV **local-first para restaurantes e lanchonetes**, sem assinatura, cloud, APIs pagas ou dependências proprietárias obrigatórias. Um host SQLite atende caixa, mesas e cozinha; garçom/KDS acessam por rede local HTTPS com credenciais por perfil.

> **ESCOPO FISCAL DEFINIDO: COMPROVANTES NÃO FISCAIS + EXPORTADOR.** Não existe emissão integrada de NF-e/NFC-e, e sua ausência não bloqueia o funcionamento do caixa. Ainda faltam validações presenciais de hardware e instalador antes da distribuição.

## Início rápido no host

Requer Node.js >= 22.16.0. Python 3 é utilizado **apenas nos testes históricos de esquema**, não no aplicativo distribuído.

```bash
npm ci --no-audit --no-fund
npm ci --prefix apps/react-ui --ignore-scripts --no-audit --no-fund
npm run ui:build
npm test
npm start
```

A instalação inicial baixa dependências de código aberto (incluindo `qr` 0.7.2 para QR Code local). **O funcionamento posterior não requer internet, API de QR, serviço pago ou assinatura.**

Abrir no próprio computador:

- **Caixa:** http://127.0.0.1:3434/
- **Interface única do PDV (React):** http://127.0.0.1:3434/ui/?embedded=1
- **Garçom (dispositivo pareado):** https://SEU-HOST-LAN:3434/ui/?device=waiter
- **Cozinha/KDS (dispositivo pareado):** https://SEU-HOST-LAN:3434/ui/?device=kitchen
- As URLs históricas `/`, `/restaurant.html` e `/kitchen.html` redirecionam para a UI React, sem servir as antigas telas. Garçom/KDS usam PIN de 6 dígitos e HTTPS na rede local; sem configuração TLS, a interface remota não é liberada.

O banco padrão é `~/.pdv-nexus-2/nexus.db`. Os pedidos e pagamentos são gravados em transações com chave idempotente. Não compartilhe o arquivo SQLite por rede.

## Primeiro acesso e operadores

Ao abrir o caixa pela primeira vez, cadastre o **supervisor** com usuário e senha de no mínimo 12 caracteres. Os logins são locais e a senha é protegida por `scrypt` com salt individual. A interface permite criar operadores do tipo caixa; estes não podem editar cardápio, cadastrar operadores, configurar impressoras, exportar ou registrar devoluções.

As sessões são locais e expiram ou se invalidam com reinício do serviço. Não existe recuperação de senha na nuvem. Guarde o backup e as credenciais do supervisor com segurança.

## Implementação entregue

- Catálogo com categorias ativas/arquivadas, cadastro, edição e desativação de produtos, adicionais e observações por item, preços históricos, pedidos balcão/mesa/retirada/entrega.
- Mesas ocupadas exclusivamente por comanda ativa; transferências com revisão otimista.
- Cozinha com ticket por linha, estados de preparo, histórico e deduplicação persistente; eventos em tempo real SSE e reconexão com atualização de segurança a cada 30 segundos.
- Combos fixos usando o mesmo cardápio, com componentes preservados; divisão da comanda por cliente/quantidade com resumo individual, sem pagamento parcial em etapas separadas.
- Caixa, sangria, suprimento, troco, pagamentos divididos e devolução integral **manual** com registro financeiro separado.
- Impressora ESC/POS em TCP privado com fila persistente; sucesso de envio TCP **não prova** impressão física.
- Backup/restauração offline, testes automatizados Linux/Windows e PWA com cache apenas de arquivos estáticos.
- HTTPS LAN opcional, token de gerente e pareamento de cada garçom/cozinha por QR de URL + PIN de 6 dígitos (2 minutos), com credenciais individuais válidas por 30 dias e revogáveis. O host, por padrão, escuta **somente** `127.0.0.1`.

### Acesso opcional por celulares na LAN (sem SaaS)

É necessário fornecer certificado TLS confiável para IP/nome do host e ao menos um token de gerente robusto, com `PDV_LAN_HOST`, `PDV_LAN_CERT`, `PDV_LAN_KEY` e `PDV_LAN_MANAGER_TOKEN`. Os tokens estáticos do garçom/cozinha continuam opcionais, mas o pareamento via PIN individual é preferível. Veja o passo a passo e regras de segurança em [P1_IMPLEMENTATION.md](docs/P1_IMPLEMENTATION.md). Sem HTTPS e token válido não há acesso remoto à API.

O PWA usa cache apenas para interface estática; **não cria pedidos offline** se o host estiver inacessível. Não exponha o host na internet.

## Desktop opcional

```bash
npm install
npm run desktop
```

`npm run build:win` e `npm run build:linux` geram pacotes locais com `--publish never`. O instalador real e os dispositivos USB/balanças ainda exigem QA presencial; não há publicação automática.

## Validações operacionais e decisões pendentes

- **Exportador:** disponível em CSV/JSON na tela "Exportar vendas", com data inicial/final opcional. A emissão de documentos fiscais, quando necessária, é externa e não faz parte do escopo do PDV. A exportação não é XML fiscal autorizado.
- Testes físicos de impressora térmica, USB, balança, gaveta e escopo de dispositivos por modelo.
- Login local de operador implementado; faltam recuperação local assistida de acesso e validação do instalador em PCs reais.
- Estoque por ingrediente, fichas técnicas e custo médio disponíveis no P2. Combos de escolha dinâmica, conciliação financeira avançada e sincronização entre unidades ainda não foram implementados.
- A interface operacional atual usa React/Vite compilado e servido pelo host local, sem CDN; rotas históricas redirecionam para a UI canônica. O servidor, Electron e o SQLite continuam self-hosted, sem dependência de nuvem.

Consulte o [checklist de QA](docs/QA_RUNBOOK.md), [status/roadmap](docs/ROADMAP.md), [P0](docs/P0_IMPLEMENTATION.md), [P1](docs/P1_IMPLEMENTATION.md), [P2](docs/P2_IMPLEMENTATION.md) e [arquitetura](docs/ARCHITECTURE.md). Fundação, P0 e P1 foram integrados à `main` com autorização. **Não publicar release sem autorização.**

## P2 — Estoque e delivery (self-hosted)

O painel inclui **Estoque & fichas** e **Delivery**. Ingredientes, receitas, entradas, quebras, custo médio e baixa transacional na venda usam o **mesmo banco SQLite**. Se faltar saldo de ingrediente previsto na ficha, o fechamento do pedido falha antes de gravar pagamento.

O cardápio digital `/menu.html` fica **desativado por padrão**. O supervisor pode habilitar no painel e revisar solicitações; pedidos externos são apenas pré-pedidos pendentes, sem gateway ou pagamento automático.

Para publicar **apenas** o portal de cardápio no próprio host:

```bash
PDV_PUBLIC_PORT=3435 npm start
```

A porta `3435` escuta somente `127.0.0.1`. Para acesso externo use um proxy reverso HTTPS gratuito e self-hosted e configure DNS/TLS separadamente. **Nunca exponha a porta administrativa 3434 à internet.** Ativar o cardápio exige ação explícita no painel ou variável de ambiente `PDV_PUBLIC_MENU_ENABLED=true`. Não compartilhe o banco SQLite entre servidores.

O identificador de instalação é persistente para planejamento futuro, porém **há consolidação manual de indicadores por pacotes JSON versionados**, sem replicação operacional de pedidos/estoque/caixa. Não requer nem integra serviços fiscais ou pagamentos pagos. Veja [escopo completo do P2](docs/P2_IMPLEMENTATION.md) e [protocolo multiunidade, privacidade e QA final](docs/P2_FINALIZATION.md).

### P2 — Consolidação de unidades e privacidade

A aba **Unidades** permite exportar e importar resumos financeiros sem compartilhar bancos SQLite ou dados pessoais: o pacote contém dias agregados, ID de instalação, revisão e hash. Reimportar o mesmo pacote não duplica valores; versões divergentes são bloqueadas para revisão manual. **Não há sincronização operacional automática entre lojas.** O caixa, estoque e pedidos continuam locais.

Em **Delivery**, o supervisor pode anonimizar solicitações rejeitadas ou atendimentos encerrados, e executar limpeza manual de dados antigos com retenção mínima de 30 dias. Tentativas repetidas de envio de pedidos usam uma chave idempotente para evitar duplicações após quedas de rede.

Nenhum gateway de pagamento, emissão NFC-e ou serviço pago é necessário para o núcleo. A implantação pública exige a configuração de proxy HTTPS e revisão de privacidade pelo estabelecimento.

### Opcional: espelhos operacionais de outras unidades

O supervisor pode habilitar consultas automáticas por HTTPS à LAN/VPN privada para visualizar pedidos, produtos e saldos de **outras** unidades. São espelhos de leitura, sem lançar vendas ou estoque no banco local e sem API paga. O recurso permanece desativado por padrão; use tokens específicos de leitura, certificados confiáveis e configure peers fora do Git. Veja [guia de homologação](docs/HOMOLOGACAO_SELFHOSTED.md).


## Consolidação P0–P3 (21/11/2026)

- **P0:** raiz e interface MIT; lockfiles raiz/React versionados e `npm ci` nos builds; páginas React de estoque, financeiro e relatórios conectadas às APIs reais; assistente salva estabelecimento/terminal em transação idempotente.
- **P1:** EAN-13, consulta de etiquetas Toledo/Filizola e TCP/serial/Winspool RAW opcionais; leitura física de balança e compatibilidade de cada impressora ainda exigem testes no modelo real.
- **P2:** fornecedores, compras com confirmação de recebimento, lotes e validade FEFO, ficha técnica/custo médio e relatórios sem duplicar ledger.
- **P3:** backup manual autenticado, snapshot pré-migração, inspeção/restauração offline, verificação de releases opt-in e QA automatizado (sem release automática).

O core permanece **R$ 0, self-hosted, open source e não fiscal**. Veja [licenciamento](docs/LICENSING.md), [restauração e atualização](docs/RESTAURACAO_E_ATUALIZACAO.md), [extensões comerciais](docs/RETAIL_EXTENSIONS_20261121.md) e [roadmap e pendências de hardware](docs/ROADMAP.md).
