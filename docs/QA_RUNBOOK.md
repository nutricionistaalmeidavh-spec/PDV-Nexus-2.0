# QA operacional e checklist de homologação — PDV Nexus 2.0

## Escopo e restrições

O core usa SQLite local e componentes open source. QR é gerado offline por biblioteca `qr` 0.7.2 (MIT/Apache-2.0), sem serviço externo. O sistema **não emite NF-e/NFC-e**: comprovantes não fiscais e arquivos CSV/JSON são enviados para emissão externa. Nenhuma release comercial automática.

## QA automatizado em CI

1. `npm test`: domínio, migrations SQLite, servidor e API de restaurante.
2. CI Windows: `npm run test:api` com banco SQLite.
3. `Browser QA (headless, no release)`: Playwright/Chromium Linux 24.04 percorre cadastro de supervisor, categoria, produto, abertura de caixa, venda, pagamento, exportação CSV, mesa/comanda e KDS; armazena screenshots de cada etapa como artifact sem publicação.
4. `Desktop Installer (manual, no release)`: instala dependências livres, roda testes e gera **NSIS Windows unsigned** como artifact de QA. Não há GitHub Release nem assinatura automática.

## Validação presencial obrigatória antes de distribuição

- [ ] Instalar em Windows 10/11 novo sem banco anterior; executar, reiniciar e reabrir pedidos e cadastro.
- [ ] Atualização sobre instalação anterior: preservar `userData/nexus.db`, WAL, migrations, login e histórico.
- [ ] Operador: cadastrar supervisor, logar, sair, bloquear caixa e comprovar permissões de operador; avaliar recuperação offline de senha.
- [ ] Backup via SQLite Backup API, restauração com app fechado, recuperação após queda de energia e disco cheio.
- [ ] Venda de balcão, mesa, transferência, cancelamento, reimpressão, pagamentos mistos, devolução manual auditada.
- [ ] ESC/POS real USB e TCP, gaveta, leitor, balanças e páginas de código conforme modelos efetivamente disponíveis.
- [ ] Instalar PWA em iOS e Android com CA/certificado HTTPS confiável; parear, revogar, deixar Wi-Fi cair e reconectar; confirmar ausência de pedidos fantasmas.
- [ ] KDS em cozinha com dois dispositivos simultâneos e queda/reconexão, sem tickets duplicados.
- [ ] Validar CSV/JSON com o contador e sistema externo de emissão utilizado pelo estabelecimento.
- [ ] Revisar SmartScreen e assinatura do instalador antes da distribuição pública.

## Critério de lançamento

CI verde não equivale a instalação homologada. Não liberar a versão a clientes antes da revisão da cadeia de PRs e autorização de merge/release. Serviços cloud, gateway pago e emissão fiscal dentro do PDV estão fora do core.

## P2 — Consolidar e proteger dados

- [x] Testes automatizados com dois bancos SQLite de unidades distintas, pacote idempotente, revisões, hash e ausência de cópia de pedidos ou estoque remoto.
- [x] Testes de recusa a pacote alterado e revisão antiga, permissão de supervisor e anonimização restrita a delivery encerrado/rejeitado.
- [x] Reenvio com a mesma chave pública não duplica solicitação no banco.
- [ ] Manual: exportar pacote de uma loja, importar em outro Windows, comparar totais e registrar conflito de histórico real.
- [ ] Manual: informar política de retenção e testar HTTPS do proxy reverso, privacidade e carga de múltiplos clientes no ambiente final.

O P2 disponibiliza consolidação por arquivos, não replicação distribuída de pedidos/estoques em tempo real. Não liberar portal público sem revisão de segurança e LGPD.
