# PDV Nexus 2.0

PDV **local-first para restaurantes e lanchonetes**, sem assinatura, cloud, APIs pagas ou dependências proprietárias obrigatórias. Um host SQLite atende caixa, mesas e cozinha; garçom/KDS acessam por rede local HTTPS com credenciais por perfil.

> **ESTÁGIO: DEMONSTRAÇÃO NÃO FISCAL.** O protótipo funciona para QA técnico, mas NÃO está homologado para emissão fiscal nem validado em hardware comercial. `operationMode='production'` permanece bloqueado.

## Início rápido no host

Requer Node.js >= 22.16.0. Python 3 é utilizado **apenas nos testes históricos de esquema**, não no aplicativo distribuído.

```bash
npm test
npm start
```

Abrir no próprio computador:

- **Caixa:** http://127.0.0.1:3434/
- **Mesas e comandas:** http://127.0.0.1:3434/restaurant.html
- **Cozinha/KDS:** http://127.0.0.1:3434/kitchen.html

O banco padrão é `~/.pdv-nexus-2/nexus.db`. Os pedidos e pagamentos são gravados em transações com chave idempotente. Não compartilhe o arquivo SQLite por rede.

## Implementação entregue

- Catálogo, adicionais e observações por item, preços históricos, pedidos balcão/mesa/retirada/entrega.
- Mesas ocupadas exclusivamente por comanda ativa; transferências com revisão otimista.
- Cozinha com ticket por linha, estados de preparo, histórico e deduplicação persistente.
- Caixa, sangria, suprimento, troco, pagamentos divididos e devolução integral **manual** com registro financeiro separado.
- Impressora ESC/POS em TCP privado com fila persistente; sucesso de envio TCP **não prova** impressão física.
- Backup/restauração offline, testes automatizados Linux/Windows e PWA com cache apenas de arquivos estáticos.
- HTTPS LAN opcional, tokens por perfil (`waiter`, `kitchen`, `manager`). O host, por padrão, escuta **somente** `127.0.0.1`.

### Acesso opcional por celulares na LAN (sem SaaS)

É necessário fornecer um certificado TLS confiável para o IP/nome do host, tokens fortes e configurar explicitamente as variáveis de ambiente `PDV_LAN_HOST`, `PDV_LAN_CERT`, `PDV_LAN_KEY`, `PDV_LAN_WAITER_TOKEN`, `PDV_LAN_KITCHEN_TOKEN` e/ou `PDV_LAN_MANAGER_TOKEN`. Veja o passo a passo e regras de segurança em [P1_IMPLEMENTATION.md](docs/P1_IMPLEMENTATION.md). Sem HTTPS e token válido não há acesso remoto à API.

O PWA usa cache apenas para interface estática; **não cria pedidos offline** se o host estiver inacessível. Não exponha o host na internet.

## Desktop opcional

```bash
npm install
npm run desktop
```

`npm run build:win` e `npm run build:linux` geram pacotes locais com `--publish never`. O instalador real e os dispositivos USB/balanças ainda exigem QA presencial; não há publicação automática.

## Bloqueadores comerciais e decisões pendentes

- NFC-e: credenciamento, certificado, CSC, assinatura XML, SEFAZ homologação, contingência, cancelamento e regras vigentes da UF. **Não implementado**; endpoint devolve 501.
- Testes físicos de impressora térmica, USB, balança, gaveta e escopo de dispositivos por modelo.
- Login/PIN do operador local e validação do instalador em PCs reais.
- Combos/fichas técnicas avançadas e sincronização entre unidades ficam para marcos posteriores.
- Interface P0/P1 utiliza HTML/CSS/JS local, sem React/Vite; a possível migração deve ser uma decisão de produto explícita, não uma dependência oculta.

Consulte [status/roadmap](docs/ROADMAP.md), [P0](docs/P0_IMPLEMENTATION.md), [P1](docs/P1_IMPLEMENTATION.md), [arquitetura](docs/ARCHITECTURE.md). Branches de trabalho e PRs #1 → #10 → #11 são empilhadas. **Não fazer merge ou release sem autorização.**
