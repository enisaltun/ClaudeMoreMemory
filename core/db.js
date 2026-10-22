// Ortak SQLite yardımcıları (Node'un yerleşik node:sqlite'ı; ek bağımlılık yok).
import fs from 'node:fs';
import path from 'node:path';

// node:sqlite yüklenirken basılan "experimental" uyarısını bastır (yalnızca bu uyarıyı).
const origEmit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  const msg = typeof w === 'string' ? w : w?.message;
  if (msg && msg.includes('SQLite is an experimental')) return;
  return origEmit.call(this, w, ...rest);
};
const { DatabaseSync } = await import('node:sqlite');
process.emitWarning = origEmit;

/** Veritabanını açar; WAL sayesinde birden çok süreç (sunucu, MCP, işçi) aynı dosyayı okuyup yazabilir. */
export function openDb(file, schema) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000; PRAGMA temp_store=MEMORY;');
  db.exec(schema);
  return db;
}

/** İç içe çağrılabilen transaction: en dıştaki BEGIN/COMMIT yapar. */
export function tx(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* zaten kapanmış */ }
    throw e;
  }
}
