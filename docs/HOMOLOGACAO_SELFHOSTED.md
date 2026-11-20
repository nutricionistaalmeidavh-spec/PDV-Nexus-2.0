# Homologação self-hosted — múltiplas unidades, HTTPS, Windows e periféricos

Atualizado em 20/11/2026. O core é R$ 0, local e sem assinatura; não ativa serviços pagos. As instruções abaixo **não representam homologação com equipamentos físicos**.

## 1. Espelhos automáticos de pedidos, catálogo e estoque (sem multiwriter)

Cada unidade é proprietária do próprio banco SQLite e de seus pagamentos. A opção de espelho consulta outras unidades em **HTTPS privado** (LAN ou WireGuard self-hosted), mediante token exclusivo `mirror` de no mínimo 32 caracteres. Somente são transportados: IDs, categorias, produtos, status/itens e total de pedidos, saldos/custos de ingredientes. **Não são transmitidos** nomes, telefones ou endereços de clientes, credenciais, pagamentos unitários ou observações livres.

A unidade receptora guarda um espelho **somente de leitura**: nenhuma venda, movimento, ficha técnica ou caixa remoto pode ser alterado ou contabilizado como local. Mudanças criam revisão e hash; reimportação idêntica não duplica. Revisões antigas e divergentes são recusadas; um salto de revisões de snapshot completo fica sinalizado para revisão.

**Servidor da unidade remota**, variáveis do processo (exemplo com valores fictícios, substitua por segredo forte; não salvar segredos no Git):

```bash
PDV_LAN_HOST=0.0.0.0
PDV_LAN_CERT=/etc/nexus/tls/server.crt
PDV_LAN_KEY=/etc/nexus/tls/server.key
PDV_LAN_MIRROR_TOKEN=SUBSTITUA_POR_SEGREDO_ALEATORIO_FORTE_DE_48_CHARS
npm start
```

**Unidade consolidora**, em rede VPN/LAN privada:

```bash
NODE_EXTRA_CA_CERTS=/etc/nexus/tls/ca.crt
PDV_OPERATIONAL_PEERS_JSON='[{"url":"https://10.20.0.2:3434","token":"TOKEN_READ_ONLY_DA_OUTRA_UNIDADE_COM_48_CHARS"}]'
PDV_SYNC_INTERVAL_MS=60000
npm start
```

- `NODE_EXTRA_CA_CERTS` deve conter o certificado da autoridade **confiável**. Não usar `NODE_TLS_REJECT_UNAUTHORIZED=0`, nem desativar validação TLS.
- O certificado remoto deve conter o IP privado/nome `.local` em SAN. Firewall deve liberar a porta 3434 **somente aos IPs confiáveis da VPN/LAN**, nunca à internet pública.
- `PDV_OPERATIONAL_PEERS_JSON` é opcional e não é persistido no SQLite. Sem ele, nenhum polling ocorre.
- Intervalo aceito: 30–3600 segundos. Máximo de 8 peers por instalação. Dados maiores que 4 MiB não são cortados silenciosamente: exportação retorna erro explícito. Grandes redes precisam de paginação/protocolo dedicado.
- O supervisor acompanha a aba **Unidades > Espelhos automáticos**. A API do host oferece `GET /api/sync/operational/status`, `/peers`, `/export`, `POST /import` e `POST /pull`, com autenticação por papel.
- O token `mirror` permite somente **GET /api/sync/operational/export** da unidade remota. Não permite criar pedidos, editar estoque, consultar dados administrativos ou exportações fiscais.
- Sem `PDV_LAN_MIRROR_TOKEN` no servidor remoto, a coleta falha fechada; sem permissões de supervisor local, o espelho não é acessível.

**Importante:** esta é sincronização **automática de espelhos de leitura**, não replicação bidirecional de escrita. Troca/transferência de estoque entre unidades e atendimento centralizado precisam de regras de alocação e propriedade, protocolo próprio e homologação separada.

## 2. Delivery público com Caddy open source (opcional)

O portal é um serviço separado, acessível apenas em `127.0.0.1:3435` no servidor. O backend do caixa não deve ser disponibilizado na internet. Use Caddy self-hosted, com **domínio próprio opcional** e TLS configurado; a operação local continua gratuita sem domínio.

Exemplo de Caddyfile para um domínio que você já controla:

```caddyfile
menu.example.org {
    encode gzip
    header {
      Referrer-Policy "no-referrer"
      X-Content-Type-Options "nosniff"
      Strict-Transport-Security "max-age=31536000"
    }
    reverse_proxy 127.0.0.1:3435 {
      header_up X-Real-IP {remote_host}
    }
}
```

**Somente** a porta HTTPS do Caddy deve ficar exposta. O `X-Real-IP` precisa ser sobrescrito pelo proxy, nunca repassado cegamente a partir de clientes externos. O host do aplicativo aceita este cabeçalho apenas no socket de loopback do proxy. Comece com `PDV_PUBLIC_PORT=3435` e mantenha o cardápio **desativado** até o supervisor optar por ativá-lo no sistema.

Checklist antes de ativar na internet:

- [ ] DNS, TLS, política de privacidade e bases legais de tratamento definidas pelo estabelecimento (LGPD).
- [ ] Verificar que `https://dominio/api/orders`, `/api/auth/login`, `/ui/` e `/index.html` retornam 404 no portal público.
- [ ] Garantir que não existam redirecionamentos externos ou domínio não confiável.
- [ ] Testar 8 solicitações por cliente/10 min e 429 apenas para esse cliente; validar que o Caddy sobrescreve `X-Real-IP`.
- [ ] Validar anonimização de clientes encerrados e retenção; liberar apenas com autorização.
- [ ] Prever defesa adicional para ataques distribuídos se a exposição for pela internet.

## 3. Windows e hardware — distinção entre QA automatizado e teste presencial

Ações automatizadas:
- [x] Testes do domínio/API Linux e Windows, migrations e persistência SQLite.
- [x] Simulador TCP ESC/POS com dados reais de uma venda, cabeçalho/corte e deduplicação de envio.
- [x] Backup SQLite e restauração de histórico de venda, pagamento e fila em processo independente.
- [ ] Instalação silenciosa NSIS em runner Windows, verificada na CI da branch atual.
- [x] Playwright/Chromium: login, caixa, mesas, cozinha, estoque, delivery e Unidades.

**Exigem teste no local do cliente e não podem ser encerrados pelo CI:**

| Equipamento / cenário | Evidência mínima exigida | Estado |
|---|---|---|
| Impressora ESC/POS TCP real | Modelo, firmware, página de código, corte, erro e reenvio sem impressão duplicada | Pendente |
| Impressora térmica USB/Windows | Porta/driver, serviço de spooler, caracteres e retomada após desconexão | Pendente |
| Gaveta de dinheiro | Acionamento real na impressora conectada e autorização de abertura | Pendente |
| Leitor de código de barras | Testar HID/USB com códigos do cadastro e foco do caixa | Pendente |
| Balança por modelo | Protocolo e cabo, unidade decimal, estabilidade e falha de leitura | Pendente |
| Windows instalado | Instalação inicial, atualização sobre dados anteriores, SmartScreen, perfil sem administrador, recuperação pós-reinício | Pendente |
| Mobile LAN | Android/iOS, certificado confiável, pareamento, queda e retorno de Wi-Fi, KDS sem tickets duplicados | Pendente |

Registre fabricante/modelo/versão, Windows, driver, evidência visual e falhas no ticket de homologação. Sem esses dados físicos, não afirmar que o PDV está homologado para qualquer modelo.

## 4. Fiscal e pagamento

O PDV produz **comprovantes não fiscais** e exporta CSV/JSON para emissão fiscal externa. **Não existe NFC-e/NF-e integrada**, nem bloqueio por isso. Pix e cartão permanecem com confirmação manual, sem vínculo a adquirente. APIs comerciais e custos externos são opcionais, nunca parte obrigatória do core.
