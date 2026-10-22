// Graf deposu (SQLite): düğüm/kenar, komşu, çift yönlü BFS yol, topluluk, rapor.
// Tüm sorgular indekslidir; tam graf asla belleğe yüklenmez (topluluk tespiti hariç, bkz. detectCommunities).
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { openDb, tx } from './db.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes(
  id TEXT PRIMARY KEY, label TEXT NOT NULL, type TEXT NOT NULL, source TEXT, lang TEXT,
  community INTEGER, degree INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS nodes_degree ON nodes(degree DESC);
CREATE INDEX IF NOT EXISTS nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS nodes_comm ON nodes(community, degree DESC);
CREATE INDEX IF NOT EXISTS nodes_source ON nodes(source);
CREATE INDEX IF NOT EXISTS nodes_label ON nodes(label);
CREATE TABLE IF NOT EXISTS edges(
  src TEXT NOT NULL, dst TEXT NOT NULL, type TEXT NOT NULL, PRIMARY KEY(src, dst, type)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edges_dst ON edges(dst);
CREATE TABLE IF NOT EXISTS files(
  path TEXT PRIMARY KEY, root TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS files_root ON files(root);
CREATE TABLE IF NOT EXISTS imports_raw(file TEXT NOT NULL, spec TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS imports_file ON imports_raw(file);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(label, id, tokenize='trigram');
`;

const LOUVAIN_CAP = Number(process.env.HAFIZA_LOUVAIN_CAP) || 100_000;

export class GraphStore {
  constructor(file = ':memory:') {
    this.file = file;
    this.db = openDb(file, SCHEMA);
    const d = this.db;
    this.q = {
      upNode: d.prepare(`INSERT INTO nodes(id, label, type, source, lang) VALUES (?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET label=excluded.label, type=excluded.type,
        source=coalesce(excluded.source, source), lang=coalesce(excluded.lang, lang)`),
      addEdge: d.prepare('INSERT OR IGNORE INTO edges(src, dst, type) VALUES (?,?,?)'),
      getNode: d.prepare('SELECT * FROM nodes WHERE id = ?'),
      delNode: d.prepare('DELETE FROM nodes WHERE id = ?'),
      delEdgesFrom: d.prepare('DELETE FROM edges WHERE src = ?'),
      delEdgesTo: d.prepare('DELETE FROM edges WHERE dst = ?'),
      delEdgesFromType: d.prepare('DELETE FROM edges WHERE src = ? AND type = ?'),
      deg: d.prepare('SELECT (SELECT count(*) FROM edges WHERE src = ?1) + (SELECT count(*) FROM edges WHERE dst = ?1) AS d'),
      adj: d.prepare('SELECT dst AS n FROM edges WHERE src = ?1 UNION SELECT src FROM edges WHERE dst = ?1'),
    };
  }

  close() { this.db.close(); }
  tx(fn) { return tx(this.db, fn); }

  // ---- yazma ---------------------------------------------------------

  addNode(id, props = {}) {
    this.q.upNode.run(id, props.label ?? id, props.type ?? 'unknown', props.source ?? null, props.lang ?? null);
  }

  addEdge(src, dst, type = 'link') {
    if (src !== dst) this.q.addEdge.run(src, dst, type);
  }

  /** Düğümü ve ona değen tüm kenarları siler. */
  removeNode(id) {
    this.q.delEdgesFrom.run(id);
    this.q.delEdgesTo.run(id);
    this.q.delNode.run(id);
  }

  getMeta(k) { return this.db.prepare('SELECT v FROM meta WHERE k = ?').get(k)?.v ?? null; }
  setMeta(k, v) { this.db.prepare('INSERT OR REPLACE INTO meta(k, v) VALUES (?,?)').run(k, String(v)); }

  /** Toplu yazımdan sonra: derece sütunu + arama dizini. */
  finalize() {
    this.recomputeDegrees();
    this.reindexSearch();
  }

  recomputeDegrees() {
    tx(this.db, () => {
      this.db.exec(`
        CREATE TEMP TABLE IF NOT EXISTS d(id TEXT PRIMARY KEY, c INTEGER) WITHOUT ROWID;
        DELETE FROM d;
        INSERT INTO d SELECT id, sum(c) FROM (
          SELECT src AS id, count(*) AS c FROM edges GROUP BY src
          UNION ALL SELECT dst, count(*) FROM edges GROUP BY dst) GROUP BY id;
        UPDATE nodes SET degree = coalesce((SELECT c FROM d WHERE d.id = nodes.id), 0);
        DELETE FROM d;`);
    });
  }

  reindexSearch() {
    tx(this.db, () => {
      this.db.exec(`DELETE FROM nodes_fts;
        INSERT INTO nodes_fts(rowid, label, id) SELECT rowid, label, id FROM nodes;`);
    });
  }

  // ---- okuma ---------------------------------------------------------

  hasNode(id) { return !!this.q.getNode.get(id); }
  getNode(id) { return this.q.getNode.get(id) ?? null; }
  degree(id) { return this.q.deg.get(id).d; }

  /** Komşular (yönsüz birleşim, derece sıralı, sayfalı). */
  neighbors(id, { limit = 200, offset = 0 } = {}) {
    const rows = this.db.prepare(`
      SELECT x.id, x.type, x.dir, n.label, n.type AS ntype, n.community, n.degree, n.source FROM (
        SELECT dst AS id, type, 'out' AS dir FROM edges WHERE src = ?1
        UNION ALL SELECT src, type, 'in' FROM edges WHERE dst = ?1) x
      JOIN nodes n ON n.id = x.id ORDER BY n.degree DESC, n.id LIMIT ?2 OFFSET ?3`).all(id, limit, offset);
    return rows.map((r) => ({
      id: r.id, type: r.type, dir: r.dir,
      node: { id: r.id, label: r.label, type: r.ntype, community: r.community, degree: r.degree, source: r.source },
    }));
  }

  /** Çift yönlü BFS (yönsüz). Dönüş: düğüm kimlikleri dizisi ya da null. */
  path(a, b, { maxDepth = 12, maxVisited = 300_000 } = {}) {
    if (!this.hasNode(a) || !this.hasNode(b)) return null;
    if (a === b) return [a];
    const prevA = new Map([[a, null]]);
    const prevB = new Map([[b, null]]);
    let fa = [a], fb = [b];
    const chain = (prev, x) => { const p = []; for (; x !== null; x = prev.get(x)) p.push(x); return p; };
    for (let depth = 0; depth < maxDepth && fa.length && fb.length; depth++) {
      if (prevA.size + prevB.size > maxVisited) return null;
      const forward = fa.length <= fb.length;
      const [front, mine, other] = forward ? [fa, prevA, prevB] : [fb, prevB, prevA];
      const next = [];
      for (const cur of front) {
        for (const { n } of this.q.adj.all(cur)) {
          if (mine.has(n)) continue;
          mine.set(n, cur);
          if (other.has(n)) {
            const left = chain(prevA, n).reverse(); // a … n
            const right = chain(prevB, n).slice(1); // n' … b
            return [...left, ...right];
          }
          next.push(n);
        }
      }
      if (forward) fa = next; else fb = next;
    }
    return null;
  }

  /** Ada göre ara: ≥3 karakter trigram FTS (alt dize), kısa sorgular önek LIKE. */
  search(q, { limit = 20, type = null } = {}) {
    const s = (q || '').trim();
    if (!s) return [];
    const typeSql = type ? 'AND n.type = ?' : '';
    const extra = type ? [type] : [];
    if (s.length >= 3) {
      return this.db.prepare(`SELECT n.id, n.label, n.type, n.community, n.degree, n.source
        FROM nodes_fts f JOIN nodes n ON n.rowid = f.rowid
        WHERE nodes_fts MATCH ? ${typeSql} ORDER BY n.degree DESC LIMIT ?`)
        .all('"' + s.replace(/"/g, '""') + '"', ...extra, limit);
    }
    return this.db.prepare(`SELECT id, label, type, community, degree, source FROM nodes n
      WHERE label LIKE ? ESCAPE '\\' ${typeSql} ORDER BY degree DESC LIMIT ?`)
      .all(s.replace(/[\\%_]/g, '\\$&') + '%', ...extra, limit);
  }

  godNodes(n = 10, type = null) {
    return type
      ? this.db.prepare('SELECT id, label, type, degree, community FROM nodes WHERE type = ? ORDER BY degree DESC LIMIT ?').all(type, n)
      : this.db.prepare('SELECT id, label, type, degree, community FROM nodes ORDER BY degree DESC LIMIT ?').all(n);
  }

  stats() {
    const byType = Object.fromEntries(
      this.db.prepare('SELECT type, count(*) c FROM nodes GROUP BY type').all().map((r) => [r.type, r.c]));
    return {
      nodes: Object.values(byType).reduce((a, b) => a + b, 0),
      edges: this.db.prepare('SELECT count(*) c FROM edges').get().c,
      communities: this.db.prepare('SELECT count(DISTINCT community) c FROM nodes').get().c,
      byType,
    };
  }

  /** En büyük toplulukların özeti (boyut + en merkezi üyeler). */
  communities(limit = 20, topLabels = 8) {
    const rows = this.db.prepare(`SELECT community AS id, count(*) AS size FROM nodes
      WHERE community IS NOT NULL GROUP BY community ORDER BY size DESC LIMIT ?`).all(limit);
    const top = this.db.prepare('SELECT label, type FROM nodes WHERE community = ? ORDER BY degree DESC LIMIT ?');
    return rows.map((r) => ({ id: r.id, size: r.size, top: top.all(r.id, topLabels) }));
  }

  /** Görüntülenecek alt graf: en merkezi `limit` düğüm (+ isteğe bağlı topluluk/tür süzgeci) ve aralarındaki kenarlar. */
  subgraph({ limit = 1500, community = null, type = null, ids = null } = {}) {
    let nodes;
    if (ids?.length) {
      const ph = ids.map(() => '?').join(',');
      nodes = this.db.prepare(`SELECT id, label, type, community, degree, source FROM nodes WHERE id IN (${ph})`).all(...ids);
    } else {
      const where = [];
      const args = [];
      if (community !== null && community !== undefined) { where.push('community = ?'); args.push(community); }
      if (type) { where.push('type = ?'); args.push(type); }
      nodes = this.db.prepare(`SELECT id, label, type, community, degree, source FROM nodes
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY degree DESC LIMIT ?`).all(...args, limit);
    }
    return { nodes, edges: this.edgesAmong(nodes.map((n) => n.id)) };
  }

  /** Verilen kümenin kendi içindeki kenarlar. */
  edgesAmong(ids) {
    if (!ids.length) return [];
    return tx(this.db, () => {
      this.db.exec('CREATE TEMP TABLE IF NOT EXISTS sel(id TEXT PRIMARY KEY) WITHOUT ROWID; DELETE FROM sel;');
      const ins = this.db.prepare('INSERT OR IGNORE INTO sel VALUES (?)');
      for (const id of ids) ins.run(id);
      const rows = this.db.prepare(`SELECT e.src AS source, e.dst AS target, e.type FROM edges e
        JOIN sel a ON a.id = e.src JOIN sel b ON b.id = e.dst`).all();
      this.db.exec('DELETE FROM sel');
      return rows;
    });
  }

  /** Bir düğüm + komşuları + (komşular arası dahil) kenarlar; arayüzde tıklayınca genişletmek için. */
  expand(id, limit = 80) {
    const self = this.getNode(id);
    if (!self) return null;
    const nb = this.neighbors(id, { limit });
    const nodes = [self, ...nb.map((n) => n.node)];
    return { nodes, edges: this.edgesAmong(nodes.map((n) => n.id)) };
  }

  // ---- topluluk ------------------------------------------------------

  /**
   * Louvain (≤ LOUVAIN_CAP düğüm); daha büyük graflarda ucuz yedek: klasör/kök bazlı kümeleme.
   * Topluluk numaraları boyuta göre azalan sıralanır (0 = en büyük).
   */
  detectCommunities() {
    const total = this.db.prepare('SELECT count(*) c FROM nodes').get().c;
    let assign; // Map id -> anahtar
    if (total === 0) return 0;
    if (total <= LOUVAIN_CAP) {
      const g = new Graph({ type: 'undirected', multi: false });
      for (const r of this.db.prepare('SELECT id FROM nodes').iterate()) g.addNode(r.id);
      for (const r of this.db.prepare('SELECT src, dst FROM edges').iterate()) {
        if (g.hasNode(r.src) && g.hasNode(r.dst) && !g.hasEdge(r.src, r.dst)) g.addEdge(r.src, r.dst);
      }
      assign = g.size ? new Map(Object.entries(louvain(g))) : new Map([...g.nodes()].map((n, i) => [n, i]));
    } else {
      assign = new Map();
      for (const r of this.db.prepare('SELECT id, type, source FROM nodes').iterate()) {
        assign.set(r.id, folderKey(r.id));
      }
    }
    const sizes = new Map();
    for (const k of assign.values()) sizes.set(k, (sizes.get(k) || 0) + 1);
    const order = new Map([...sizes.entries()].sort((a, b) => b[1] - a[1]).map(([k], i) => [k, i]));
    const upd = this.db.prepare('UPDATE nodes SET community = ? WHERE id = ?');
    tx(this.db, () => { for (const [id, k] of assign) upd.run(order.get(k), id); });
    return order.size;
  }

  // ---- rapor ---------------------------------------------------------

  /** Claude'un doğrudan okuyacağı Markdown özeti (büyük graflarda da kısa kalır). */
  report() {
    const s = this.stats();
    const lines = [
      '# GRAPH_REPORT', '',
      `- Düğüm: ${s.nodes}`, `- Kenar: ${s.edges}`, `- Topluluk: ${s.communities}`,
      `- Türler: ${Object.entries(s.byType).map(([t, c]) => `${t}=${c}`).join(', ')}`, '',
      '## En merkezi düğümler (god nodes)',
      ...this.godNodes(10).map((n) => `- **${n.label}** (${n.type}) — derece ${n.degree}`), '',
      '## Topluluklar',
    ];
    for (const c of this.communities(20)) {
      lines.push(`### Topluluk ${c.id} (${c.size} düğüm)`, c.top.map((t) => t.label).join(', '), '');
    }
    return lines.join('\n');
  }
}

/** Büyük graflarda yedek kümeleme anahtarı: not/etiket sınıfı ya da kod kökü + ilk klasör. */
function folderKey(id) {
  if (id.startsWith('tag:')) return 'tag';
  if (id.startsWith('note:')) {
    const p = id.slice(5);
    return 'note:' + (p.includes('/') ? p.split('/')[0] : '');
  }
  const rest = id.replace(/^(file|sym):/, '').split('#')[0].split('/');
  return rest.slice(0, -1).slice(0, 3).join('/') || rest[0];
}
