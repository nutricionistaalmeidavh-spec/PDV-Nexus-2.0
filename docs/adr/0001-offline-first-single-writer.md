# ADR 0001 — Offline-first e escritor único

**Status:** Aceita para MVP (reavaliar depois de protótipos reais de hardware).

## Contexto

Restaurantes e lanchonetes precisam continuar vendendo sem internet, frequentemente com impressora, KDS e celular do garçom na mesma rede. Compartilhar um arquivo SQLite entre estações ou criar bancos independentes sem conciliação expõe a vendas duplicadas, corrupção e estados divergentes.

## Decisão

- Um **host local** centraliza regras e escrita em banco SQLite do estabelecimento.
- Caixa desktop incorpora ou conecta ao host; telas e clientes LAN não gravam diretamente no banco.
- O host sobrevive sem internet. A LAN e os celulares dependem dele nesta fase, **não** prometemos offline independente para cada garçom.
- Regras de pedidos ficam em pacote de domínio puro, sem dependência do framework.
- Comandos recebem idempotency key e revisão, persistidos atomicamente com o estado e outbox.
- Adapters de impressão e pagamentos externos são substituíveis; o fiscal desta versão limita-se a comprovante não fiscal e exportação de dados para emissão externa.

## Alternativas descartadas nesta fase

- **Cloud-first / banco externo obrigatório:** cria dependência de internet e custo operacional.
- **SQLite compartilhado por SMB/Windows:** inadequado para concorrência e confiabilidade entre máquinas.
- **Banco local em cada celular com sync automática:** exige algoritmo de resolução de conflitos; fica para marco próprio.

## Consequências

- Vendas no host funcionam sem internet.
- Host vira ponto central de operação e requer backup, recuperação e monitoramento simples.
- Terminais secundários exibem indisponibilidade de modo explícito na perda da LAN.
- Futuramente é possível adicionar servidor self-hosted remoto, mantendo contratos e regras do core.
