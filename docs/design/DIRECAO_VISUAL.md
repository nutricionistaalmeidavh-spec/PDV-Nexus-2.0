# PDV Nexus 2.0 — direção visual v1

> Status: direção visual escolhida pelo proprietário em 17/11/2026. **Referência de design, não especificação de funcionalidade já implementada.**

## Referência visual original

- Arquivo aprovado e preservado na Biblioteca do ChatGPT: `/PDV-Nexus-2.0/Design/direcao-visual-caixa-aprovada.png`.
- A imagem representa a tela **Nova venda** e é a referência visual para novas telas.
- O arquivo PNG não foi enviado para este branch; antes da implementação, copiar o original para `docs/design/assets/direcao-visual-caixa-aprovada.png` (sem recriação com perda de fidelidade).

## Linguagem de interface

- **Marca**: PDV Nexus 2.0, identidade roxa vibrante com fundo claro; laranja usado com moderação para ações contextuais e elementos de atenção.
- **Navegação**: menu lateral à esquerda e cabeçalho horizontal. Estrutura familiar a operadores de balcão.
- **Trabalho principal**: produtos/categorias no centro, pedido sempre visível à direita e total com ação primária destacada.
- **Cartões de categoria**: cores suaves e ícones reconhecíveis; categoria ativa com roxo mais forte.
- **Catálogo**: nome, variação e preço legíveis, imagem opcional. Não exigir fotografias para operar.
- **Operação**: targets amplos para toque, atalhos visíveis no desktop, foco de teclado, contraste acessível, feedback imediato, operação rápida com leitor de códigos.
- **Mobile/tablet**: mesmo modelo de pedido; no celular, alternar catálogo e carrinho sem perder itens nem estado.
- **Restaurante**: substituir as categorias de exemplo de mercado (Mercearia/Higiene/Limpeza) por categorias configuráveis do cardápio, como Lanches, Bebidas, Porções, Combos, Sobremesas e Adicionais.
- **Sem poluição visual**: recursos avançados só quando relevantes; não colocar todo o menu administrativo na tela operacional.

## Regras de experiência — estados obrigatórios

1. Uma venda não pode ser finalizada duas vezes por clique duplo, repetição de tecla ou retorno tardio.
2. Feedback de comando não significa sucesso persistido: confirmar visualmente somente após resposta transacional do host.
3. Loading, sucesso, erro, conflito de revisão e recuperação de pedido são estados distintos.
4. Qualquer erro preserva os itens e valores que o operador já inseriu, salvo rejeição validada.
5. Valores totais usam o cálculo canônico em centavos do domínio; não recalcular preços antigos após atualização do cardápio.
6. Pedido, caixa financeiro e ticket de cozinha são objetos distintos. O preparo não deve ser representado pelo status do pedido.
7. Exibir indisponibilidade do host nos clientes LAN; não prometer operação offline autônoma de terminais secundários no escopo atual.
8. Serviços externos e dependências pagas são sempre opcionais e explícitos. Núcleo R$ 0, self-hosted e open source.

## Estrutura visual da tela Caixa

1. Cabeçalho: nome do sistema, terminal e operador; indicador inequívoco de abertura de caixa.
2. Menu lateral: ação primária Vender, seguida de Mesas/Pedidos quando os módulos estiverem disponíveis; administração em itens subordinados.
3. Área de venda: pesquisa por nome/código, filtros por categoria e catálogo responsivo.
4. Pedido atual: linhas, preço, quantidade, adicionais, remoção e total.
5. Faixa de ação: pagamento/finalização, desconto com permissão, cliente, observação e ação de limpeza com confirmação.
6. Mensagens de estado e acesso ao pedido pendente/retomada.

## Critérios de aceite de UI

- O caixa encontra produto, adiciona 2 unidades, modifica item, conclui pagamento e recebe confirmação sem navegar por seções administrativas.
- A interface mantém o pedido após erro de rede/comando; tentativa duplicada não cria segunda venda.
- Um pedido pode ser retomado após fechar e abrir novamente a aplicação, após implementação do adaptador SQLite.
- Foco e atalho de teclado não são bloqueados por elementos meramente decorativos.
- Valores, troco, descontos e recebimentos são consistentes com o domínio, independentemente do dispositivo.
- Validar em desktop 1440px, notebook 1280px e tablet 834px, inclusive com zoom e navegação por teclado.

## Código e implementação

Este documento pode ser revisado independentemente de código. Atualização (20/11/2026): a `main` já contém backend P0–P2, React e Electron. Este documento preserva a **direção visual de referência**, não um diagnóstico atual da implementação. O PNG aprovado continua fora do Git até disponibilização autorizada.
