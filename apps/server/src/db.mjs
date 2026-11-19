import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationDir = fileURLToPath(new URL('../migrations/', import.meta.url));
export const defaultDataPath = () => path.join(os.homedir(), '.pdv-nexus-2', 'nexus.db');

export function openDatabase(dataPath = defaultDataPath()) {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dataPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  const current = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()
    ? new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)) : new Set();
  for (const [version, filename] of [[1,'001_init.sql'],[2,'002_cash_and_hardware.sql'],[3,'003_restaurant.sql'],[4,'004_refunds.sql'],[5,'005_order_notes.sql'],[6,'006_auth_categories.sql'],[7,'007_paired_devices.sql'],[8,'008_combos_splits.sql'],[9,'009_inventory_ledger.sql'],[10,'010_delivery_requests.sql'],[11,'011_delivery_settings.sql'],[12,'012_installation_identity.sql'],[13,'013_multiunit_summary.sql'],[14,'014_delivery_privacy.sql']]) {
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
  if (path.resolve(destination) === path.resolve(db.location())) throw new Error('Backup precisa ter outro nome');
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  await backup(db, destination);
  const check = new DatabaseSync(destination);
  try {
    const integrity = check.prepare('PRAGMA integrity_check').get();
    if (integrity.integrity_check !== 'ok') throw new Error('Backup inconsistente');
  } finally { check.close(); }
  return destination;
}
