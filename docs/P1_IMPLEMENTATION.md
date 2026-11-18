# P0 + P1 — fluxo de restaurante, segurança e limites

## Entregue nesta PR (base: P0 / PR #10)

- **Mesas/comandas:** cadastro/renomeação, mesa única ocupada, abertura/reuso, transferência com revisão otimista, liberação após pagamento/cancelamento.
- **Adicionais:** preço histórico agregado à linha e snapshot nominal; validação por produto e preço em centavos.
- **Observações para cozinha:** cada linha preserva texto do garçom e adicionais; cozinha apresenta os dois.
- **KDS:** fila persistente em `kitchen_ticket` vinculada a `order_line`, `UNIQUE(line_id)` evita tickets duplicados, etapas `PENDING→PREPARING→READY→SERVED`, cancelamento, revisão otimista e auditoria. Novos itens em comanda aberta geram novos tickets.
- **Garçom:** interface responsiva `/restaurant.html`, separada do caixa e instalada como PWA quando HTTPS e certificado confiável. Ações de garçom só são confirmadas após resposta do host.
- **Cozinha:** `/kitchen.html`, exibição por etapas e polling local a cada 4 s. Sem dependência externa.
- **Pagamento de mesa:** abrir comanda no histórico do caixa, confirmar e fechar via meios divididos (uma operação atômica).
- **Devolução integral (manual):** somente venda encerrada, trilha separada `order_refund`, baixa em caixa corrente quando dinheiro, confirmações externas manuais explícitas, comando idempotente. Não presume reembolso via banco.
- **LAN opt-in:** TLS obrigatório, tokens fortes e escopos de `waiter`, `kitchen`, `manager`. Modo normal continua escutando exclusivamente `127.0.0.1`.

## Rodar localmente

```sh
npm test
npm start
# browser: http://127.0.0.1:3434/ , /restaurant.html , /kitchen.html
```

O caixa gera comprovantes não fiscais e exportações para o processo de emissão externa. A ausência de NFC-e integrada não impede a operação do PDV.

## Ativar rede LAN de forma segura (opcional, self-hosted, zero assinatura)

1. Gere um certificado TLS para o IP/nome da máquina host usando `mkcert` (open source) ou uma CA administrada pela empresa. Instale a CA nos celulares que forem usar o sistema; certificado autoassinado não confiável pode impedir PWA e acesso.
2. Gere 3 tokens independentes com `node -p "require('node:crypto').randomBytes(32).toString('hex')"` (um para cada perfil).
3. Na máquina do host, defina explicitamente `PDV_LAN_HOST=0.0.0.0`, `PDV_LAN_CERT=/.../host.crt`, `PDV_LAN_KEY=/.../host.key`, `PDV_LAN_WAITER_TOKEN`, `PDV_LAN_KITCHEN_TOKEN`, `PDV_LAN_MANAGER_TOKEN` e `PDV_PORT=3434` no ambiente de inicialização, **não no Git**.
4. Abra `https://IP-DO-HOST:3434/restaurant.html` ou `/kitchen.html` no celular e informe o token correspondente em “Acesso do dispositivo”. Firewall deve permitir a porta somente na rede local confiável.

Não há login cloud, assinatura ou API paga. Tokens ficam somente em `sessionStorage` do navegador do dispositivo; não são persistidos no servidor nem no service worker. A troca/rotação de tokens exige reiniciar o host com novos valores. Não exponha `PDV_LAN_HOST` à internet pública.

O service worker guarda **apenas arquivos estáticos**. Perda da LAN interrompe alterações; não existe fila offline para operações feitas em outros dispositivos. Isso evita aceitar pedidos sem confirmação.

## P0 — validações pendentes

- **Fiscal:** escopo fixo nesta versão é comprovante não fiscal + exportação CSV/JSON para processamento fiscal externo. Não há emissão NFC-e/NF-e no PDV e ela não bloqueia o caixa. O escritório/fornecedor externo deve validar o arquivo e cumprir as obrigações legais aplicáveis.
- **Hardware:** TCP ESC/POS testável, porém impressão real/USB, gaveta, balanças e páginas de código precisam de testes físicos e adaptadores específicos. Não marcar #5 como concluída.
- **Desktop:** validação do instalador com Windows/Linux reais e antivírus/SmartScreen ainda não comprovada. Build não publica release.
- **Autenticação de operador no próprio caixa:** a interface local funciona sem login no host; é necessário definir papéis por operador para produção.
- **Devoluções eletrônicas:** só registra restituição que o operador confirma que já foi realizada externamente; não chama adquirente/Pix.

## Testes e QA exigidos antes de qualquer merge/release

- `npm test` e CI Windows/Linux com status verde; regressão de idempotência, caixa, snapshots, banco real e KDS.
- Teste presencial de mesa, perda de Wi-Fi, retorno, contingência, backup/restauração, hardware, devolução e ausência de tickets duplicados.
- Credenciais/fiscal não podem entrar no repositório ou em log.
- Não publicar release ou integrar `main` sem autorização explícita.
