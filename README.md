# PDV Nexus 2.0

PDV local-first para **restaurantes e lanchonetes**, com atendimento no balcão e, por módulo, mesas, comandas, garçons e cozinha (KDS).

> **Estado atual: M0.1 – fundação de domínio, schema e arquitetura.** Ainda não existe tela desktop, API, impressão, emissão fiscal nem checkout operacional. Não usar em produção.

## Princípios

- Núcleo **R$ 0 / self-hosted / open source**. Pagamentos externos e serviços em nuvem são integrações opcionais e explícitas.
- **Um processo host grava no SQLite**; outros terminais/garçons/KDS acessam serviço autenticado pela rede local.
- Domínio de pedido único para balcão, mesa, retirada e delivery; sem duplicar modelos por canal.
- Dinheiro sempre em **centavos inteiros** e preço do item fotografado no pedido.
- Transações atômicas, comandos idempotentes, revisão otimista e outbox persistente para eventos externos.
- Auditoria de ações sensíveis, migrations versionadas e backup consistente (SQLite Backup API).
- Commits na branch de trabalho; merge, publicação e release somente após revisão e autorização.

## Estrutura

```text
apps/server/migrations/   # Schema SQLite, um arquivo por versão
apps/server/tests/        # Testes de integridade do schema
packages/core/src/       # Domínio puro, sem dependência de interface, banco ou Electron
packages/core/test/      # Testes do domínio
.github/workflows/ci.yml # Execução automatizada dos testes
 docs/                   # Arquitetura, decisões, plano de entregas
```

## Validação local (zero dependências de terceiros neste marco)

Requer Node.js >= 22.16 e Python 3 com SQLite >= 3.37.

```bash
npm test
```

O teste de domínio usa temporariamente o suporte de execução de TypeScript do Node 22 com `--experimental-strip-types`; a próxima etapa adotará compilação TypeScript padronizada no monorepo. O teste SQL usa `unittest` e `sqlite3` da biblioteca padrão do Python; **Python não será necessário no aplicativo distribuído**.

## Próximos marcos

1. **M0.2:** estrutura de apps desktop/server, Electron seguro + React, adapter SQLite e comando de demonstração persistido.
2. **M1:** catálogo, pedido/atendimento, pagamento e fechamento de caixa, com testes de queda/retry.
3. **M2:** impressão térmica e fila persistente, integração com balanças e leitores.
4. **M3:** módulo fiscal isolado e validado conforme UF e regime tributário, antes de uso comercial fiscal.
5. **M4:** mesas, comandas, garçons e KDS com sincronização local e permissões.
6. **M5:** integrações opcionais, delivery e servidor remoto próprio.

Veja [arquitetura](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md) e [ADR 0001](docs/adr/0001-offline-first-single-writer.md).
