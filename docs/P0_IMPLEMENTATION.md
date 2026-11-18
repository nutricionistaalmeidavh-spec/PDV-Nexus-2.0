# P0 — Demonstração de balcão: inventário das entregas

## Estado em 17/11/2026

> Escopo fiscal aprovado: comprovantes não fiscais e exportação CSV/JSON para emissão externa. O caixa não depende de emissão integrada. Comprovante e exportação não são documento fiscal.

| Issue | Implementado e testável | Pendente para marcar como concluído |
|---|---|---|
| #2 | HTTP loopback, SPA local, Electron shell, SQLite WAL com migrations, backup API e restauração offline | teste E2E real de desktop instalado, Windows/Linux, API LAN autenticada/pareada |
| #3 | Catálogo com categorias e arquivamento, edição de preço/atividade, combos fixos, snapshots e comandos idempotentes | descontos avançados, estoque/fichas técnicas e testes E2E de múltiplos caixas reais |
| #4 | Caixa aberto/fechado, sangria/suprimento, dinheiro/troco, Pix/cartão por confirmação manual, pagamento dividido via API, auditoria | estorno/devolução, relatórios avançados, impressão detalhada de fechamento, adquirentes de cartão |
| #5 | Outbox durável e ESC/POS TCP para IP privado, fila manual, bloqueio de reenvio de job concluído, tests com socket falso | USB, balanças, gaveta, drivers específicos, teste físico, compatibilidade de code page; prova de entrega física |
| #6 | Exportação CSV/JSON de vendas fechadas, com detalhes, pagamentos, devoluções, período e aviso não fiscal | Adequar o mapeamento ao sistema contábil/emissor externo utilizado |

## Setup local

Instale Node.js >= 22.16 e Python 3. Em terminal:

```sh
npm test
npm start
```

Acesse **http://127.0.0.1:3434/**. O aplicativo funciona sem serviços de terceiros e sem internet, na máquina host. Todos os dados ficam em `~/.pdv-nexus-2/nexus.db` salvo configuração explícita de `PDV_DATA_PATH`.

A interface usa HTML/CSS/JavaScript local sem CDN para permitir prototipação e testes offline sem instalar bibliotecas; o uso de React/Vite permanece opção arquitetural futura e não é uma dependência do núcleo. O Electron é opcional apenas como empacotamento da mesma interface web.

Para testar o shell Electron na máquina de desenvolvimento:

```sh
npm install
npm run desktop
```

A geração do instalador Windows usa `npm run build:win` (ou workflow manual). Nenhuma etapa publica release automática. Não há QA validado ainda sobre uma versão instalada em computador real.

## Recuperação de dados

Durante a operação, `createApp().backup('/caminho/arquivo.db')` chama SQLite Backup API e valida `PRAGMA integrity_check`.

Para restaurar, **fechar o aplicativo e fazer cópia extra do arquivo original antes**; executar:

```sh
node apps/server/src/restore.mjs --offline ./backup.db ./nexus.db
```

A restauração exige integridade e versão compatível; recusa quando encontra WAL/SHM remanescentes no destino e preserva cópia `.pre-restore.bak` do arquivo substituído. Teste de restauração executado usando SQLite real.

## Regras que evitam regressões

- Escritor único, SQLite com transações `BEGIN IMMEDIATE`, FK e WAL; não compartilhar `.db` entre dispositivos.
- `commandId` e `request_hash` em `command_receipt` impedem repetir comando confirmado. Reutilizar ID com payload diferente retorna 409.
- Pedidos usam `expectedRevision` para detectar conflitos em alterações.
- Fechar pedido e pagamento insere auditoria/outbox de impressão na mesma transação. Falha na impressão não desfaz pagamento.
- Fila de impressão marca sucesso como **envio TCP** e não como prova de impressão física; uma falha física posterior pode exigir segunda via auditada.
- Modo operacional funciona sem emissão fiscal integrada; os comprovantes continuam não fiscais em qualquer modo.
- HTTP escuta só `127.0.0.1` por padrão; PWA LAN opcional usa HTTPS + pareamento por PIN, credencial individual e escopos. Não expor 0.0.0.0/portas da máquina na internet.
- API local bloqueia origins externos e aceita mutações só com JSON e comando idempotente, quando apropriado.
- Pix e cartão são **registro manual de recebimento confirmado**, não processadores de pagamento.

## Exportação para emissão externa

- O exportador fornece dados operacionais de vendas fechadas em CSV/JSON, inclusive devoluções; não é NF-e/NFC-e nem XML homologado.
- A emissão dos documentos fiscais legalmente aplicáveis é responsabilidade do processo externo utilizado pelo estabelecimento.

## QA ainda necessário

- Windows: teste de instalador unsigned, SmartScreen, banco no `userData`, restart/backup e ausência de perda de dados.
- Linux e Chromebooks: compatibilidade a validar separadamente; terminal ChromeOS não executa instalador Windows.
- ESC/POS físico: diferentes fabricantes, páginas de código e interface de conexão.
- Segurança: contas locais de operador com scrypt e permissões implementadas; validar UX de recuperação presencial de acesso e tentativas de login em máquinas reais.
