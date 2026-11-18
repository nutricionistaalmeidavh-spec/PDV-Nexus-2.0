# PDV Nexus 2.0

PDV **offline-first** de balcão para restaurantes e lanchonetes, com núcleo 100% local, gratuito e sem serviços pagos obrigatórios.

**Estado: P0 em protótipo de demonstração (NÃO FISCAL). Não usar comercialmente como emissor de NFC-e.**

## Iniciar localmente

Requer Node.js 22.16+ e Python 3 para os testes legados de esquema SQLite.

```bash
npm test
npm start
```

Abra http://127.0.0.1:3434/ no próprio computador. O host armazena dados no SQLite local (padrão `~/.pdv-nexus-2/nexus.db`). Sem SaaS, login na nuvem ou internet.

Para usar em uma janela Electron após baixar dependências de desenvolvimento open source:

```bash
npm install
npm run desktop
```

O instalador Windows ainda depende de QA real. O workflow de empacotamento é exclusivamente manual e **não publica release**.

## O que funciona em demonstração

- Cardápio e preços em centavos, cadastro local e persistência após reinício.
- Pedidos de balcão com snapshots, idempotência de comandos e revisão por pedido.
- Recebimento manual em dinheiro, Pix e cartão, troco, caixa aberto/fechado, suprimento e sangria.
- Histórico e auditoria básica, fila de impressão ESC/POS TCP em rede privada.
- Backup/restauração consistente, ambos sem serviços externos.
- Emissão fiscal intencionalmente indisponível. A aplicação recusa modo de produção.

## Limitações

Sem NFCE homologada, sem hardware USB/balança validado, sem login/perfis, sem API LAN para garçom/KDS e sem build desktop testado em Windows real. O design inicial da interface utiliza recursos web locais sem React (base P0 de dependências mínimas); planeja-se incorporar um frontend de componentes posteriormente se necessário.

Veja [documentação da P0](docs/P0_IMPLEMENTATION.md), [arquitetura](docs/ARCHITECTURE.md) e [roadmap](docs/ROADMAP.md). A PR de fundação M0.1 é dependência desta entrega. **Merge e release somente após autorização.**
