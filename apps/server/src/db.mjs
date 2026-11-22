import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const migrationDir = fileURLToPath(new URL('../migrations/', import.meta.url));
/** Schema is discovered from checked-in migrations, never a frozen constant. */
export function listMigrations(){
  const files=fs.readdirSync(migrationDir).filter(name=>/^\d{3}_[a-zA-Z0-9_-]+\.sql$/.test(name)).sort();
  const versions=files.map(name=>[Number(name.slice(0,3)),name]);
  if(!versions.length||new Set(versions.map(([n])=>n)).size!==versions.length)
    throw new Error('Migrações ausentes ou duplicadas');
  return versions;
}
export function latestSchemaVersion(){return Math.max(...listMigrations().map(([n])=>n));}
export const defaultDataPath = () => path.join(os.homedir(), '.pdv-nexus-2', 'nexus.db');

export function openDatabase(dataPath = defaultDataPath()) {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dataPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  try {
    safeguardMigrations(db,dataPath);
    migrate(db);
    seed(db);
  }catch(e){db.close();throw e;}
  return db;
}

/** Before an upgrade, preserve a validated SQLite snapshot away from the live WAL. */
function safeguardMigrations(db,dataPath){
 const exists=db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
 if(!exists)return; // clean installation
 const current=db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version??0;
 const latest=latestSchemaVersion();
 if(current>=latest||current<=0)return;
 const backupDir=path.join(path.dirname(dataPath),'backups');
 fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
 const name='before-v'+latest+'-from-v'+current+'-'+Date.now()+'-'+randomUUID()+'.sqlite';
 const target=path.join(backupDir,name),temporary=target+'.tmp';
 try{
   db.prepare('VACUUM INTO ?').run(temporary);
   const check=new DatabaseSync(temporary,{readOnly:true});
   try{
     if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Integridade inválida');
     if(check.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Referências inválidas');
   }finally{check.close();}
   fs.renameSync(temporary,target);
 }catch(e){
   throw new Error('Migração interrompida: não foi possível criar backup de segurança: '+e.message);
 }finally{fs.rmSync(temporary,{force:true});}
}
function migrate(db) {
  const current = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()
    ? new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)) : new Set();
  for (const [version, filename] of listMigrations()) {
    if (current.has(version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(fs.readFileSync(path.join(migrationDir, filename), 'utf8'));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Falha na migração ${version}: ${error.message}`);
    }
  }
}

function seed(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT OR IGNORE INTO restaurant(id, display_name, created_at) VALUES (?,?,?)').run('r-local','Minha lanchonete',new Date().toISOString());
    db.prepare('INSERT OR IGNORE INTO terminal(id,restaurant_id,label) VALUES (?,?,?)').run('t-local','r-local','Caixa principal');
    db.prepare('INSERT OR IGNORE INTO menu_category(id,restaurant_id,name,sort_order) VALUES (?,?,?,?)').run('c-default','r-local','Cardápio',0);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export async function createBackup(db, destination) {
  const target=path.resolve(destination);
  if(target===path.resolve(db.location()))throw new Error('Backup precisa ter outro nome');
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  // Nunca tocar no backup anterior até validar um novo arquivo SQLite completo.
  const temp=path.join(path.dirname(target),'.nexus-backup-'+randomUUID()+'.sqlite');
  try{
    if(process.platform==='win32'){
      // O backup assíncrono do node:sqlite pode não concluir no Windows com a conexão ativa.
      // VACUUM INTO usa um snapshot transacional nativo do SQLite e evita worker pendente.
      db.prepare('VACUUM INTO ?').run(temp);
    }else{
      await backup(db,temp);
    }
    const check=new DatabaseSync(temp);
    try{
      const integrity=check.prepare('PRAGMA integrity_check').get();
      if(integrity.integrity_check!=='ok')throw new Error('Backup inconsistente');
      const fk=check.prepare('PRAGMA foreign_key_check').all();
      if(fk.length)throw new Error('Backup contém referências inválidas');
    }finally{check.close();}
    fs.renameSync(temp,target);
    return target;
  }finally{
    fs.rmSync(temp,{force:true});
  }
}
