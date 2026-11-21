# UI Tangerine — P0/P1 (PDV Nexus 2.0)

## Objetivo
Atualizar a interface operacional React do PDV para um visual claro, laranja e grafite, tomando a referência Lakasir apenas como inspiração de organização, sem copiar código, fontes ou imagens proprietárias.

## Dependências reutilizadas
- [Mantine](https://github.com/mantinedev/mantine) 9.8.2, licença MIT: AppShell, NavLink, Buttons, Badge, Card, SimpleGrid, Image, ScrollArea, SegmentedControl, Radio, Checkbox, NumberInput, Modal e Paper.
- [Mantine UI](https://github.com/mantinedev/ui.mantine.dev), licença MIT: padrões de layout e apresentação como referência; sem importar pacote extra ou código de blocos específicos.
- [Lucide React](https://github.com/lucide-icons/lucide) 1.77.0, licença ISC: ícones locais.
- Nenhum serviço pago, fonte remota, Tailwind, gateway de pagamento, backend externo ou sistema próprio de tokens.

Os pacotes ficam fixados no `apps/react-ui/package.json` e no `package-lock.json`. Instalações continuam reproduzíveis com `npm ci --prefix apps/react-ui --ignore-scripts`.

## P0 — base visual
- `apps/react-ui/src/NexusTheme.jsx`: tema nativo Mantine, botão primário laranja escuro #C2410C sobre branco (contraste 5.18:1).
- `apps/react-ui/src/main.jsx`: estilos estáticos dos pacotes Mantine e provider.
- `apps/react-ui/src/App.jsx`: AppShell, NavLink, Burger e Lucide para navegação, mantendo as IDs de rota e componentes existentes.
- `apps/react-ui/src/theme.css`: substituição das cores roxas por uma escala quente, mantendo os estados de sucesso/erro independentes.
- `apps/react-ui/src/nexus-pos.css`: ajustes visuais compatíveis com o tema Mantine, desktop e mobile, com foco visível e movimento reduzido.

## P1 — caixa e pagamento
- `apps/react-ui/src/PosExperience.jsx` substitui os componentes antigos Sale, ProductModal e PaymentModal.
- Busca por nome/código, categorias roláveis, grade/lista, cartões e ilustrações locais, estados vazios, comanda lateral e resumo sempre legível.
- Modal de produto com quantidade e adicionais usando componentes Mantine.
- Modal de pagamento com método único/múltiplo, dinheiro recebido e troco. Ações de confirmação ficam visíveis em telas baixas.
- Continuam intactos `onChoose`, `onConfirm`, `onCancel`, `onPay`, `paymentDraft`, `parseMoney`, `sumOrder`, F3/F10 e os snapshots de preços.
- Persistência, impressão, permissões, SQLite, API, cardápio público e regras de negócio não foram migrados nem duplicados.

## Quality gates obrigatórios
1. `npm ci --prefix apps/react-ui --ignore-scripts --no-audit --no-fund`
2. `npm run ui:test` e `npm run ui:build`
3. CI de API e SQLite no Linux/Windows
4. `scripts/qa-react-browser.mjs` com capturas desktop/mobile, personalização, pagamento e scroll no modal a 1024×600 e 390×844
5. `scripts/qa-parity-browser-v2.mjs` com pedidos, mesas, estoque, KDS, delivery e periféricos
6. Workflow de empacotamento Windows sem release, quando disponível.

## Restrições
- Não alterar credenciais, secrets, rotas `/api/*`, esquema SQLite, fórmulas de centavos ou autenticação de dispositivos.
- Não publicar releases ou executar merge sem conclusão dos testes e autorização para integrar.
- Não incluir serviço externo nem dependência comercial obrigatória.
