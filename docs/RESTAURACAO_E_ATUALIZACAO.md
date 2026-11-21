# Backup, restauração e atualização — PDV Nexus 2.0

## Proteção do banco
O aplicativo mantém **um único arquivo SQLite por instalação**. Não compartilhe esse arquivo na rede. O Electron grava em `app.getPath('userData')/nexus.db`; a execução por Node usa o caminho configurado em `PDV_DATA_PATH` ou `~/.pdv-nexus-2/nexus.db`.

- Em **Backup e atualizações**, o supervisor local clica em **Criar backup SQLite**. O host salva na subpasta `backups/`, valida `PRAGMA integrity_check` e `PRAGMA foreign_key_check` e só então confirma o caminho.
- O endpoint de backup é local e autenticado; o ID do comando impede que retries criem arquivos duplicados.
- Antes de aplicar uma migração de esquema em um banco existente, o host produz um snapshot SQLite validado, com nome `before-v18-from-v<versão>-...`. Se não for possível salvá-lo, a migração é interrompida sem executar DDL.
- Além do backup local, mantenha uma cópia em mídia independente. Não armazene arquivos de clientes no Git.

## Restauração (operações offline)

1. Crie um backup verificado e registre o caminho completo exibido pelo sistema.
2. **Feche o PDV Nexus em todos os terminais**. Confirme no Gerenciador de Tarefas que o host foi encerrado. Não restaure por cima de um SQLite aberto, nem com arquivos `-wal` ou `-shm` ativos.
3. No computador onde o código do host está instalado, com Node.js 22.16+ disponível, rode:

```powershell
node apps/server/src/restore.mjs --inspect "C:\CAMINHO\backups\manual-EXEMPLO.sqlite"
node apps/server/src/restore.mjs --offline "C:\CAMINHO\backups\manual-EXEMPLO.sqlite" "C:\CAMINHO\nexus.db"
```

4. Se o diagnóstico indicar incompatibilidade ou corrupção, **não prossiga**. O modo offline valida integridade, relações e versão; antes de substituir o banco, preserva o arquivo anterior como `nexus.db.pre-restore.bak`.
5. Inicie o PDV e confirme operador, pedidos, pagamentos, comandas e estoque. Só depois arquive o backup antigo.

Os comandos acima são para ambientes com Node instalado e acesso ao código. Não pressuponha que o executável de usuário final aceite comandos do Node. Para distribuição sem Node, uma interface nativa de restauração ainda requer homologação específica.

## Atualizações

- Em **Backup e atualizações**, a versão local aparece sem acesso à rede. **Verificar atualização** faz consulta pontual à API pública de releases oficiais do GitHub, somente a pedido do supervisor; não é preciso internet para vender.
- O sistema mostra o link da release oficial. **Não executa instalador nem download automaticamente**, não acessa segredos e não atualiza o banco de outros estabelecimentos.
- Faça backup, feche o aplicativo, execute a instalação manual e abra a nova versão. A migração é transacional e realiza backup pré-upgrade quando há novo schema.
- Não substitua `nexus.db` por cópia feita enquanto a base estava em uso; utilize sempre o recurso de backup SQLite.

## Limites de homologação
GitHub Actions testa banco, recebimentos, compilação, instalador descartável, navegador e TCP simulado; não substitui instalação de produção, impressora física, balança ou SmartScreen real. Não há emissão integrada de documentos fiscais, somente exportação CSV/JSON e comprovantes não fiscais.
