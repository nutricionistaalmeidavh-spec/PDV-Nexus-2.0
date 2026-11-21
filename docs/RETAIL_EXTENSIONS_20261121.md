# Extensões comerciais PDV Nexus 2.0 — 21/11/2026

## Escopo e contrato de custo
Core R$ 0, self-hosted, código e componentes open source. Nenhuma nuvem, API comercial ou assinatura obrigatória. Não há emissão NFC-e/NF-e: somente comprovante não fiscal e exportações CSV/JSON externas.

## Fornecedores e FEFO
- Migration 017 aditiva: supplier, ingredient_batch, batch_consumption, barcode em menu_product e ajustes de perfil de impressora. Banco existente permanece preservado.
- O saldo canônico e custo médio continuam em stock_ingredient/stock_movement. Lotes armazenam metadados e a quantidade rastreada; untrackedMilli = saldo total menos soma dos lotes, sem estoque duplicado.
- POST/GET /api/suppliers: cadastrar/listar; PATCH /api/suppliers/:id: ativar, desativar e renomear (supervisor).
- POST /api/stock/ingredients/:id/receive aceita lotCode + expiryDate opcionais juntos e supplierId opcional se houver lote. GET /api/stock/batches?ingredientId=... lista validade, remanescente e saldo não rastreado.
- Ao fechar uma venda, a transação única reduz lotes válidos por vencimento crescente. Se faltar saldo não vencido, fecha com conflito e não grava pagamento. Ajustes negativos explícitos permitem remover lote vencido. Repetir commandId não duplica saída.
- Não existe custo individual por lote; utiliza o custo médio anterior da contabilidade do ingrediente.

## EAN-13 e balanças
- EAN de produto cadastrado, validado pelo dígito de controle, único, pesquisável por nome/código na UI. GET /api/catalog/barcode?code=... consulta produto.
- GET /api/hardware/scale/label?code=...&mode=weight|price valida EAN prefixado 2x e extrai PLU de cinco posições, peso em gramas ou preço em centavos.
- GET /api/hardware/scale/parse?brand=generic|toledo|filizola&raw=... decodifica quadros em diagnóstico, sem abrir porta física. Protocolos completos variam por fabricante/modelo; exigem captura e homologação física.
- **Ainda não há captura automática do peso da porta serial nem venda fracionada por kg**; a etiqueta só é decodificada, não pode confirmar venda ou preço automaticamente. Instalação de driver só quando necessário.

## Impressão não fiscal
- TCP ESC/POS padrão foi preservado.
- Perfil opcional serial para COM/ttyUSB, com baud rate. Importação dinâmica de serialport, que o usuário instala somente no host onde necessário (nenhum outro terminal precisa baixar binários).
- Perfil opcional windows: imprime bytes ESC/POS numa fila local instalada usando Winspool RAW e PowerShell do Windows, sem SaaS e sem npm nativo obrigatório. Requer driver e dispositivo compatíveis.
- Envio aceito pelo transporte não comprova impressão física, corte ou abertura de gaveta. Reenvios exigem confirmação operacional para evitar duplicidades.
- Recibos seguem ASCII conservador. Codificação acentuada, páginas de código, USB nativo sem fila Windows e modelos de balança devem ser homologados caso a caso.

## Relatórios
- GET /api/reports/financial?from=AAAA-MM-DD&to=AAAA-MM-DD (supervisor): vendas por dia, pagamentos confirmados, devoluções, CMV do ledger, margem bruta, ticket médio e sessões de caixa.
- Não oferece DRE completa ou conciliação automática de adquirente. Interface clássica possui módulo operacional, que é acessível pelo menu React.

## Gate antes da produção
1. CI Linux/Windows + testes de API + QA de navegador e build Electron aprovados.
2. Testes reais Windows instalado, porta USB/COM, fila de impressão RAW, scanner EAN, balanças por modelo e relatório contábil.
3. Backup/restore e atualização sobre banco existente; sem merge nem release sem autorização.
