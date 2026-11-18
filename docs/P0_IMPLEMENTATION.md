# P0 — Demonstração de balcão: inventário das entregas

## Estado em 17/11/2026

> Esta implementação **não é um PDV comercial homologado**. Não emitir cupom como se fosse fiscal.

| Issue | Implementado e testável | Pendente para marcar como concluído |
|---|---|---|
| #2 | HTTP loopback, SPA local, Electron shell, SQLite WAL com migrations, backup API e restauração offline | teste E2E real de desktop instalado, Windows/Linux, API LAN autenticada/pareada |
| #3 | Catálogo CRUD básico, pedido balcão, snapshot, histórico, revisão otimista, comandos idempotentes | combos/modificadores, gestão completa de categorias, interface de edição de produto, testes de corrida multicaixa |
| #4 | Caixa aberto/fechado, sangria/suprimento, dinheiro/troco, Pix/cartão por confirmação manual, pagamento dividido via API, auditoria | estorno/devolução, relatórios avançados, impressão detalhada de fechamento, adquirentes de cartão |
| #5 | Outbox durável e ESC/POS TCP para IP privado, fila manual, bloqueio de reenvio de job concluído, tests com socket falso | USB, balanças, gaveta, drivers específicos, teste físico, compatibilidade de code page; prova de entrega física |
| #6 | Bloqueio explícito de emissão NFC-e, gate comercial fail-closed e texto de conformidade | adapter fiscal real, homologação UF, certificado, XML assinado, NFC-e, inutilização quando legalmente aplicável, DANFE, contingência, cancelamento |

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
- Modo operacional **demo obrigatório**; `operationMode='production'` falha antes de abrir o banco.
- HTTP escuta só `127.0.0.1`; PWA LAN exige autenticação e pareamento futuros. Não expor 0.0.0.0/portas da máquina na internet.
- API local bloqueia origins externos e aceita mutações só com JSON e comando idempotente, quando apropriado.
- Pix e cartão são **registro manual de recebimento confirmado**, não processadores de pagamento.

## Fontes para fiscalização

- SEFAZ/SP: https://portal.fazenda.sp.gov.br/servicos/nfce — NFC-e obrigatória ao varejo paulista desde 01/01/2026.
- MOC NF-e/NFC-e: https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=ndIjl+iEFdE%3D — utilizar regras e NT vigentes da UF antes de homologar.

## QA ainda necessário

- Windows: teste de instalador unsigned, SmartScreen, banco no `userData`, restart/backup e ausência de perda de dados.
- Linux e Chromebooks: compatibilidade a validar separadamente; terminal ChromeOS não executa instalador Windows.
- ESC/POS físico: diferentes fabricantes, páginas de código e interface de conexão.
- Segurança: autenticação de usuários e permissões por operador antes de comercialização.
