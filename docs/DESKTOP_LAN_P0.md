# LAN HTTPS no aplicativo Electron — P0
A configuração padrão do instalador continua **100% local**, na interface 127.0.0.1 com uma porta livre. Nenhum serviço pago, proxy público ou domínio é exigido.

Para habilitar acesso de garçom, KDS e tablets pela rede local, o administrador deve criar o arquivo `network-config.json` no diretório `app.getPath('userData')` do Electron (pasta de dados por usuário do aplicativo). **Esse arquivo é local e não deve ser versionado nem compartilhado**.

## Pré-requisitos
- Certificado TLS e chave privada PEM **confiáveis pelos dispositivos que se conectarão**; o certificado precisa incluir 127.0.0.1 e o IP/DNS LAN do computador nas SANs. Ferramentas livres como mkcert/OpenSSL podem gerar uma autoridade certificadora privada; distribua somente o certificado público da CA aos dispositivos que confiarão nela.
- Uma porta local disponível (padrão 3434) e regra de firewall Windows para rede **privada**, limitada à sub-rede do estabelecimento. Não expor na internet.
- Tokens independentes, aleatórios e com no mínimo 32 caracteres para cada perfil. Os tokens são segredos: armazene o JSON somente na pasta privada do perfil Windows. O aplicativo lê esses valores e mantém hashes dos tokens de acesso nas validações.

## Configuração (exemplo ilustrativo, substitua caminhos e tokens)
```json
{
  "port": 3434,
  "lan": {
    "enabled": true,
    "certPath": "C:\\Users\\usuario\\AppData\\Roaming\\PDV Nexus 2.0\\lan-cert.pem",
    "keyPath": "C:\\Users\\usuario\\AppData\\Roaming\\PDV Nexus 2.0\\lan-key.pem",
    "tokens": {
      "waiter": "SUBSTITUA_POR_UM_TOKEN_UNICO_ALEATORIO_32_OU_MAIS",
      "kitchen": "SUBSTITUA_POR_OUTRO_TOKEN_UNICO_ALEATORIO_32_OU_MAIS"
    }
  },
  "publicMenuEnabled": false,
  "operationalSync": {
    "peers": [],
    "intervalMs": 60000
  }
}
```

O aplicativo, após reiniciar, hospeda **HTTPS** no endereço LAN da máquina e mantém o banco SQLite no próprio computador. Se houver certificado inválido, ausente, token duplicado ou configuração incorreta, a inicialização LAN deve **falhar explicitamente**, nunca cair para HTTP aberto. O navegador e o Electron devem validar a confiança do certificado; não desabilitar validação TLS.

Para operação totalmente local não crie o arquivo. O espelhamento entre peers é opcional e somente leitura; para configurar, use `operationalSync.peers` com origem HTTPS e token `mirror` do destino. O core do PDV não depende de conexão externa.

## Validação antes da distribuição
1. Reiniciar o instalador em Windows com e sem `network-config.json`.
2. Validar certificado, hostname, firewall e tokens em um celular real na mesma LAN.
3. Testar controle de perfis de garçom/KDS e que o acesso anônimo a APIs administrativas é negado.
4. Desligar Wi-Fi, reiniciar o caixa e comprovar que vendas e estoque continuam locais.
5. Não liberar para cliente antes de validar o pacote real e CA privada em dispositivo físico.
