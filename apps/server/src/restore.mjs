/** Restauração offline e explícita, proibida enquanto o host escreve no SQLite. */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {latestSchemaVersion} from './db.mjs';

/** Inspect before closing or replacing the live database. No writes. */
export function inspectBackup(source) {
 if(!source||!fs.existsSync(source))throw new Error('Arquivo de backup não encontrado');
 const db=new DatabaseSync(source,{readOnly:true});
 try {
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup corrompido');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Referências inválidas');
  const versions=db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(x=>x.version);
  if(!versions.includes(2)||versions.some(x=>x>latestSchemaVersion()))throw new Error('Backup de versão incompatível');
  const orders=db.prepare('SELECT COUNT(*) AS count FROM sales_order').get().count;
  const payments=db.prepare('SELECT COUNT(*) AS count FROM payment').get().count;
  return {compatible:true,schemaVersion:Math.max(...versions),orders,payments,fileBytes:fs.statSync(source).size};
 }finally{db.close();}
}
export function restoreBackup(source, destination) {
  if (!source || !destination) throw new Error('Origem e destino são obrigatórios');
  if (path.resolve(source) === path.resolve(destination)) throw new Error('Origem e destino precisam ser diferentes');
  if (!fs.existsSync(source)) throw new Error('Backup não encontrado');
  if (fs.existsSync(destination+'-wal') || fs.existsSync(destination+'-shm')) {
    throw new Error('Arquivo WAL/SHM encontrado. Feche o PDV antes de restaurar');
  }
  inspectBackup(source);
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
  if(args.length===2&&args[0]==='--inspect'){
    try{console.log(JSON.stringify(inspectBackup(args[1]),null,2));}
    catch(e){console.error('Backup inválido:',e.message);process.exitCode=1;}
  }else if(args.length===3&&args[0]==='--offline'){
    try {const r=restoreBackup(args[1],args[2]);console.log('Restaurado:',r.restored,'Backup anterior:',r.previous??'nenhum');}
    catch(e){console.error('Falha:',e.message);process.exitCode=1;}
  }else{
    console.error('Uso: node apps/server/src/restore.mjs --inspect <backup.db> OU --offline <backup.db> <nexus.db>');process.exitCode=2;
  }
}
