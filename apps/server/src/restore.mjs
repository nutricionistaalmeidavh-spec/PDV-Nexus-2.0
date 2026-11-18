/** Restauração offline e explícita, proibida enquanto o host escreve no SQLite. */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function restoreBackup(source, destination) {
  if (!source || !destination) throw new Error('Origem e destino são obrigatórios');
  if (path.resolve(source) === path.resolve(destination)) throw new Error('Origem e destino precisam ser diferentes');
  if (!fs.existsSync(source)) throw new Error('Backup não encontrado');
  if (fs.existsSync(destination+'-wal') || fs.existsSync(destination+'-shm')) {
    throw new Error('Arquivo WAL/SHM encontrado. Feche o PDV antes de restaurar');
  }
  const sourceDb = new DatabaseSync(source, { readOnly:true });
  try {
    if (sourceDb.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup corrompido');
    if (sourceDb.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup com referências inválidas');
    const migrated = sourceDb.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    if (!migrated.some(row=>row.version===2)) throw new Error('Versão de backup incompatível');
  } finally { sourceDb.close(); }
  fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
  const temporary = destination+'.restore-'+process.pid+'.tmp';
  const previous = destination+'.pre-restore.bak';
  if(fs.existsSync(previous)) throw new Error('Remova o backup pré-restauração anterior antes de continuar');
  fs.copyFileSync(source,temporary,fs.constants.COPYFILE_EXCL);
  let movedPrevious=false;
  try {
    if(fs.existsSync(destination)){fs.renameSync(destination,previous);movedPrevious=true;}
    fs.renameSync(temporary,destination);
    return { restored:destination,previous:movedPrevious?previous:null };
  } catch(e) {
    if(movedPrevious&&!fs.existsSync(destination))fs.renameSync(previous,destination);
    throw e;
  } finally {fs.rmSync(temporary,{force:true});}
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.length!==3 || args[0]!=='--offline') {
    console.error('Uso: node apps/server/src/restore.mjs --offline <backup.db> <nexus.db>');process.exitCode=2;
  } else {
    try {const r=restoreBackup(args[1],args[2]);console.log('Restaurado:',r.restored,'Backup anterior:',r.previous??'nenhum');}
    catch(e){console.error('Falha:',e.message);process.exitCode=1;}
  }
}
