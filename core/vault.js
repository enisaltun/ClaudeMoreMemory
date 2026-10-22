// Vault: .md dosyaları üzerinde güvenli dosya işlemleri + kalıcı dizine (NoteIndex) köprü.
import fs from 'node:fs';
import path from 'node:path';
import { NoteIndex } from './noteindex.js';
import { nameOf } from './parse.js';

export { parseFrontmatter, extractLinks, extractTags, nameOf } from './parse.js';

export const DEFAULT_VAULT = path.resolve(
  process.env.HAFIZA_VAULT || path.join(import.meta.dirname, '..', 'vault')
);

export class Vault {
  constructor(root = DEFAULT_VAULT) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    this._idx = null;
  }

  /** Kalıcı dizin (tembel açılır). Sorgular için bkz. NoteIndex. */
  get idx() {
    return (this._idx ??= new NoteIndex(this));
  }

  close() {
    this._idx?.close();
    this._idx = null;
  }

  /** Güvenli yol çözümü: vault dışına çıkışı engeller. */
  resolve(name) {
    const full = path.resolve(this.root, name.replace(/\.md$/i, '') + '.md');
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error('Vault dışına erişim engellendi: ' + name);
    }
    return full;
  }

  /** Dosya sistemini gezer (gizli klasörler hariç); {ad → {mtime, size}}. Yalnızca stat okur. */
  walkStats() {
    const out = new Map();
    const stack = [this.root];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (/\.md$/i.test(e.name)) {
          try {
            const st = fs.statSync(p);
            out.set(nameOf(path.relative(this.root, p)), { mtime: Math.floor(st.mtimeMs), size: st.size });
          } catch { /* yarışta silinmiş */ }
        }
      }
    }
    return out;
  }

  exists(name) {
    return fs.existsSync(this.resolve(name));
  }

  read(name) {
    return fs.readFileSync(this.resolve(name), 'utf8');
  }

  write(name, content) {
    const p = this.resolve(name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
    this.idx.indexFile(name);
  }

  remove(name) {
    fs.unlinkSync(this.resolve(name));
    this.idx.removeNote(name);
  }

  rename(from, to) {
    const dst = this.resolve(to);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(this.resolve(from), dst);
    this.idx.removeNote(from);
    this.idx.indexFile(to);
  }

  /** Wikilink hedefini gerçek not adına çevirir; yoksa null. */
  resolveLink(target) {
    return this.idx.resolve(target);
  }

  /** Tüm not adları (küçük vault'lar için; büyüklerde idx.names/listDir sayfalı kullan). */
  list() {
    return this.idx.names({ limit: 1e9 });
  }

  search(query, limit = 50) {
    return this.idx.search(query, { limit });
  }
}
