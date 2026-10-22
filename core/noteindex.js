// Vault için kalıcı SQLite dizini: notlar, bağlantılar, etiketler, FTS5 tam metin.
// .md dosyaları gerçek kaynaktır; bu dizin silinse sync() ile yeniden kurulur.
// Hiçbir sorgu tüm dosyaları okumaz; sync() yalnızca mtime/boyutu değişenleri işler.
import fs from 'node:fs';
import path from 'node:path';
import { openDb, tx } from './db.js';
import { extractLinks, extractTags } from './parse.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, lname TEXT NOT NULL, base TEXT NOT NULL,
  mtime REAL NOT NULL, size INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS notes_lname ON notes(lname);
CREATE INDEX IF NOT EXISTS notes_base ON notes(base);
CREATE INDEX IF NOT EXISTS notes_mtime ON notes(mtime);
CREATE TABLE IF NOT EXISTS links(src INTEGER NOT NULL, target TEXT NOT NULL, raw TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS links_src ON links(src);
CREATE INDEX IF NOT EXISTS links_target ON links(target);
CREATE TABLE IF NOT EXISTS tags(note INTEGER NOT NULL, tag TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tags_note ON tags(note);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(name, body, tokenize='unicode61');
`;

const likeEscape = (s) => s.replace(/[\\%_]/g, '\\$&');
const ftsQuery = (q) => {
  const toks = q.match(/[\p{L}\p{N}_]+/gu) || [];
  return toks.map((t) => `"${t}"*`).join(' ');
};

export class NoteIndex {
  constructor(vault) {
    this.vault = vault;
    this.db = openDb(path.join(vault.root, '.hafiza', 'index.db'), SCHEMA);
    this.lastSync = 0;
    const d = this.db;
    this.q = {
      byName: d.prepare('SELECT id, name, lname, base FROM notes WHERE name = ?'),
      upsert: d.prepare(`INSERT INTO notes(name, lname, base, mtime, size) VALUES (?,?,?,?,?)
        ON CONFLICT(name) DO UPDATE SET mtime=excluded.mtime, size=excluded.size RETURNING id`),
      delLinks: d.prepare('DELETE FROM links WHERE src = ?'),
      delTags: d.prepare('DELETE FROM tags WHERE note = ?'),
      delFts: d.prepare('DELETE FROM fts WHERE rowid = ?'),
      delNote: d.prepare('DELETE FROM notes WHERE id = ?'),
      insLink: d.prepare('INSERT INTO links(src, target, raw) VALUES (?,?,?)'),
      insTag: d.prepare('INSERT INTO tags(note, tag) VALUES (?,?)'),
      insFts: d.prepare('INSERT INTO fts(rowid, name, body) VALUES (?,?,?)'),
      exact: d.prepare('SELECT name FROM notes WHERE lname = ?'),
      byBase: d.prepare('SELECT name FROM notes WHERE base = ? ORDER BY name LIMIT 1'),
    };
  }

  close() { this.db.close(); }

  count() { return this.db.prepare('SELECT count(*) c FROM notes').get().c; }

  // ---- yazma yolu ------------------------------------------------------

  /** Tek dosyayı (yeniden) indeksler. */
  indexFile(name) {
    const full = this.vault.resolve(name);
    let text, st;
    try {
      text = fs.readFileSync(full, 'utf8');
      st = fs.statSync(full);
    } catch {
      return this.removeNote(name);
    }
    const lname = name.toLowerCase();
    const base = lname.split('/').pop();
    tx(this.db, () => {
      const { id } = this.q.upsert.get(name, lname, base, Math.floor(st.mtimeMs), st.size);
      this.q.delLinks.run(id);
      this.q.delTags.run(id);
      this.q.delFts.run(id);
      const seen = new Set();
      for (const raw of extractLinks(text)) {
        const t = raw.toLowerCase();
        if (!seen.has(t)) { seen.add(t); this.q.insLink.run(id, t, raw); }
      }
      for (const tag of extractTags(text)) this.q.insTag.run(id, tag);
      this.q.insFts.run(id, name, text);
    });
  }

  removeNote(name) {
    const row = this.q.byName.get(name);
    if (!row) return;
    tx(this.db, () => {
      this.q.delLinks.run(row.id);
      this.q.delTags.run(row.id);
      this.q.delFts.run(row.id);
      this.q.delNote.run(row.id);
    });
  }

  /** Dosya sistemiyle artımlı eşitleme. Yalnızca stat okur; değişenleri yeniden indeksler. */
  sync(onProgress) {
    const disk = this.vault.walkStats();
    const known = new Map();
    for (const r of this.db.prepare('SELECT name, mtime, size FROM notes').iterate()) known.set(r.name, r);
    const todo = [];
    for (const [name, st] of disk) {
      const k = known.get(name);
      if (!k || k.mtime !== st.mtime || k.size !== st.size) todo.push(name);
    }
    const gone = [...known.keys()].filter((n) => !disk.has(n));
    const CHUNK = 500;
    for (let i = 0; i < todo.length; i += CHUNK) {
      tx(this.db, () => { for (const n of todo.slice(i, i + CHUNK)) this.indexFile(n); });
      onProgress?.({ done: Math.min(i + CHUNK, todo.length), total: todo.length });
    }
    tx(this.db, () => { for (const n of gone) this.removeNote(n); });
    this.lastSync = Date.now();
    return { updated: todo.length, removed: gone.length, total: disk.size };
  }

  /** İçerik imzası: notlar değişmediyse aynı kalır (graf taramasında vault kısmını atlamak için). */
  signature() {
    return this.db.prepare(`SELECT count(*) || ':' || coalesce(sum(mtime), 0) || ':' || coalesce(sum(size), 0) AS s FROM notes`).get().s;
  }

  /** Okumadan önce, son eşitlemeden beri `ms` geçtiyse eşitle (dış süreçlerin değişiklikleri için). */
  ensureFresh(ms = 5000) {
    if (Date.now() - this.lastSync > ms) this.sync();
  }

  // ---- okuma yolu ------------------------------------------------------

  /** Bağlantı hedefini gerçek not adına çevirir: tam ad, yoksa en küçük adlı aynı-dosya-adı. */
  resolve(target) {
    const t = target.trim().toLowerCase();
    return this.q.exact.get(t)?.name ?? this.q.byBase.get(t)?.name ?? null;
  }

  names({ limit = 1000, offset = 0, prefix = '' } = {}) {
    return this.db
      .prepare('SELECT name FROM notes WHERE name >= ? AND name < ? ORDER BY name LIMIT ? OFFSET ?')
      .all(prefix, prefix + '￿', limit, offset)
      .map((r) => r.name);
  }

  /** Klasörün doğrudan içeriği (tembel ağaç): alt klasörler + sayfalanmış notlar. */
  listDir(dir = '', { limit = 500, offset = 0 } = {}) {
    const p = dir ? dir.replace(/\/+$/, '') + '/' : '';
    const pe = p + '￿';
    const skip = p.length + 1;
    const dirs = this.db
      .prepare(`SELECT substr(name, ?, instr(substr(name, ?), '/') - 1) AS seg, count(*) AS c
        FROM notes WHERE name >= ? AND name < ? AND instr(substr(name, ?), '/') > 0
        GROUP BY seg ORDER BY seg`)
      .all(skip, skip, p, pe, skip)
      .map((r) => ({ name: r.seg, count: r.c }));
    const where = 'name >= ? AND name < ? AND instr(substr(name, ?), \'/\') = 0';
    const notes = this.db
      .prepare(`SELECT name FROM notes WHERE ${where} ORDER BY name LIMIT ? OFFSET ?`)
      .all(p, pe, skip, limit, offset)
      .map((r) => r.name);
    const total = this.db.prepare(`SELECT count(*) c FROM notes WHERE ${where}`).get(p, pe, skip).c;
    return { dir: p.replace(/\/$/, ''), dirs, notes, total };
  }

  /** Not başına bağlantılar, geri bağlantılar ve etiketler. */
  info(name, { backlinkLimit = 200 } = {}) {
    const me = this.q.byName.get(name);
    if (!me) return null;
    const links = this.db.prepare('SELECT raw FROM links WHERE src = ?').all(me.id)
      .map((r) => ({ text: r.raw, name: this.resolve(r.raw) }));
    const cond = `n.id != :id AND (l.target = :lname OR (l.target = :base AND :lname != :base
      AND NOT EXISTS (SELECT 1 FROM notes m WHERE m.lname = :base)
      AND :name = (SELECT min(name) FROM notes m2 WHERE m2.base = :base)))`;
    const params = { id: me.id, lname: me.lname, base: me.base, name: me.name };
    const backlinks = this.db
      .prepare(`SELECT DISTINCT n.name FROM links l JOIN notes n ON n.id = l.src WHERE ${cond} ORDER BY n.name LIMIT ${backlinkLimit | 0}`)
      .all(params).map((r) => r.name);
    const backlinkTotal = this.db
      .prepare(`SELECT count(DISTINCT n.id) c FROM links l JOIN notes n ON n.id = l.src WHERE ${cond}`).get(params).c;
    const tags = this.db.prepare('SELECT tag FROM tags WHERE note = ? ORDER BY tag').all(me.id).map((r) => r.tag);
    return { name, links, backlinks, backlinkTotal, tags };
  }

  /** FTS5 öneki + ad içinde geçen eşleşmeler; bm25 sıralı, sayfalı. */
  search(query, { limit = 50, offset = 0 } = {}) {
    const q = (query || '').trim();
    if (!q) return [];
    const out = new Map();
    const fq = ftsQuery(q);
    if (fq) {
      try {
        const rows = this.db.prepare(`SELECT n.name AS name, snippet(fts, 1, '«', '»', '…', 14) AS snippet
          FROM fts JOIN notes n ON n.id = fts.rowid WHERE fts MATCH ? ORDER BY bm25(fts, 8.0, 1.0)
          LIMIT ? OFFSET ?`).all(fq, limit, offset);
        for (const r of rows) out.set(r.name, { name: r.name, snippet: r.snippet });
      } catch { /* geçersiz FTS sözdizimi: ad aramasına düş */ }
    }
    if (out.size < limit && offset === 0) {
      const rows = this.db.prepare(`SELECT name FROM notes WHERE lname LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`)
        .all('%' + likeEscape(q.toLowerCase()) + '%', limit);
      for (const r of rows) if (!out.has(r.name)) out.set(r.name, { name: r.name, snippet: '' });
    }
    return [...out.values()].slice(0, limit);
  }

  byTag(tag, { limit = 200, offset = 0 } = {}) {
    return this.db.prepare(`SELECT n.name FROM tags t JOIN notes n ON n.id = t.note WHERE t.tag = ?
      ORDER BY n.name LIMIT ? OFFSET ?`).all(tag, limit, offset).map((r) => r.name);
  }

  topTags(limit = 50) {
    return this.db.prepare('SELECT tag, count(*) c FROM tags GROUP BY tag ORDER BY c DESC LIMIT ?').all(limit)
      .map((r) => ({ tag: r.tag, count: r.c }));
  }

  recent(limit = 30) {
    return this.db.prepare('SELECT name FROM notes ORDER BY mtime DESC LIMIT ?').all(limit).map((r) => r.name);
  }

  /** Graf çıkarımı için: tüm notlar, ham bağlantılar ve etiketler akış olarak. */
  iterNotes() { return this.db.prepare('SELECT id, name FROM notes').iterate(); }
  iterLinks() {
    return this.db.prepare('SELECT n.name AS src, l.target, l.raw FROM links l JOIN notes n ON n.id = l.src').iterate();
  }
  iterTags() {
    return this.db.prepare('SELECT n.name AS note, t.tag FROM tags t JOIN notes n ON n.id = t.note').iterate();
  }

  /** O(1) çözümleyici: tüm bağlantıları toplu çözerken sorgu başına maliyet yok. */
  resolver() {
    const exact = new Map();
    const byBase = new Map();
    for (const r of this.db.prepare('SELECT name, lname, base FROM notes ORDER BY name').iterate()) {
      exact.set(r.lname, r.name);
      if (!byBase.has(r.base)) byBase.set(r.base, r.name);
    }
    return (target) => exact.get(target) ?? byBase.get(target) ?? null;
  }
}
