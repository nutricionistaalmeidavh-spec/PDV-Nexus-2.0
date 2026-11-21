# PDV Nexus 2.0 — avaliação comercial de 3 dias

## Edições

- **Núcleo MIT livre:** funciona em rede local/self-hosted, sem Cloudflare, licença, assinatura, chave API ou e-mail obrigatório.
- **Instalador comercial opt-in:** inclui manifesto explícito `commercialActivation:true` e chave pública ECDSA P-256. A edição comercial consulta a Central ArtiSys para registrar avaliações e verificar suspensão/renovação. A senha do operador e os dados operacionais não saem do computador do cliente.
- Não habilitar licenciamento comercial por padrão em builds livres. Nenhum serviço pago entra como dependência.

## Jornada comercial

1. Na instalação comercial sem licença, a UI apresenta o formulário de e-mail e emite pedido de confirmação à Central.
2. O e-mail recebe código de 6 dígitos com validade de **15 minutos**. Há bloqueio de tentativas, limite de reenvio e limite por origem.
3. O cliente confirma o código; a Central grava uma única licença `PDV_NEXUS_2`, tipo `TRIAL`, origem `AUTO_SIGNUP`, com expiração em 72 horas exatas a partir da confirmação. O registro aparece no painel existente junto ao Oficina.
4. O Nexus valida o comprovante **ECDSA P-256** contendo produto, e-mail, instalação persistente, datas e ID de licença; só então autoriza a criação do operador local e o uso comercial. O mesmo comprovante sobrevive à reinicialização.
5. A Central envia e-mail transacional de boas-vindas com data de vencimento. Falha de e-mail não apaga a licença e é sinalizada.
6. A cada 15 minutos em operação, o cliente verifica o status online. Sem rede, o comprovante assinado autoriza até o vencimento. Suspensão/cancelamento só é conhecido ao reconectar.
7. Após expiração, a edição comercial não aceita **novas operações mutáveis**. Permanece permitido autenticar-se, consultar informações existentes e gerar backup; atualização da licença exige conexão.
8. Um cliente pode fornecer código comercial já emitido pelo administrador. A Central reaproveita a política antiga de códigos com validade de 48 horas; reativação manual pode vincular uma instalação à licença comercial. O administrador pode converter o registro `TRIAL` existente sem apagar dados.

## Chaves e implantação

Não preencher segredos no repositório nem no instalador.

- Gerar **fora do repositório** um par ECDSA P-256 (JWK público e JWK privado).
- Guardar **apenas a chave privada** no secret runtime `NEXUS_LICENSE_SIGNING_JWK` do Worker Central ArtiSys.
- Guardar um `NEXUS_TRIAL_PEPPER` aleatório (20+ caracteres) como secret runtime exclusivo.
- Em `NEXUS_LICENSE_PUBLIC_JWK_FILE`, informar o caminho do arquivo contendo **apenas** `kty`, `crv`, `x` e `y`. Nunca incluir o campo `d` em arquivos enviados a clientes.
- O canal de e-mail da Central usa o relay já existente `oficina-mail.artisys.dev`, com configuração de remetente `contato@artisys.dev` e binding de envio existente; sem configurar o binding, o fluxo falha explicitamente.
- Fazer staging da Central e validar com banco D1 anonimizado. **Não modificar secrets reais nem publicar diretamente na main.**
- Em produção, publicar a Central e o relay de e-mail **antes** de distribuir instaladores comerciais.

### Geração do instalador

```sh
# Edição livre sem licença e sem chaves:
npm run build:win

# Edição comercial explícita:
NEXUS_LICENSE_PUBLIC_JWK_FILE=/caminho/seguro/public-jwk.json npm run build:commercial:win
```

Os scripts geram `apps/desktop/edition-manifest.json` temporariamente, incluem no pacote apenas durante o build e removem em `finally`; esse arquivo está no `.gitignore` e não deve ser commitado.

## Testes

```sh
npm run ui:test
npm test
node --test apps/server/tests/test_commercial_license.test.mjs apps/server/tests/test_commercial_license_api.test.mjs
```

Cenários: cadastro com e-mail, código inválido, duplicidade, assinatura adulterada, chave incorreta, vencimento exato, uso offline, relógio retrocedido, suspensão, conversão comercial, preservação de consulta/backup, modo livre sem licença, impressão/caixa não afetados no núcleo MIT. Teste de entrega real de e-mail e instalação Windows limpa é obrigatório antes de produção.