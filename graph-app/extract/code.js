// Kod klasörlerini grafa ekler (regex tabanlı; JS/TS, Python, Dart). ARTIMLI:
// yalnızca mtime/boyutu değişen dosyalar okunur; silinenler temizlenir.
// Düğümler: file, symbol. Kenarlar: imports, defines, uses.
//
// Bilinen sınırlama: 'uses' kenarları değişen dosyalar için güncel sembol tablosuna göre kurulur;
// değişmeyen bir dosyanın yeni eklenen bir sembole 'uses' kenarı ancak tam taramada ({full:true}) görünür.
import fs from 'node:fs';
import path from 'node:path';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.dart_tool', '__pycache__', '.venv', 'venv', 'graphify-out', '.next', 'coverage', 'target']);
const LANG = { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'js', '.ts': 'js', '.tsx': 'js', '.py': 'py', '.dart': 'dart' };
const MAX_BYTES = 512 * 1024;
const IDENT = /[A-Za-z_$][\w$]{4,}/g;

const RE = {
  js: {
    imports: [
      /\bimport\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
      /\bexport\s+[^;'"]*?\s+from\s+['"]([^'"]+)['"]/g,
      /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    ],
    symbols: [
      /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm,
      /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gm,
    ],
  },
  py: {
    imports: [/^\s*from\s+([.\w]+)\s+import\s/gm, /^\s*import\s+([\w.]+)/gm],
    symbols: [/^class\s+([A-Za-z_]\w*)/gm, /^(?:async\s+)?def\s+([A-Za-z_]\w*)/gm],
  },
  dart: {
    imports: [/^\s*(?:import|export|part)\s+['"]([^'"]+)['"]/gm],
    symbols: [/^\s*(?:abstract\s+)?(?:class|mixin|enum|extension)\s+([A-Za-z_]\w*)/gm],
  },
};

/** Yinelemesiz gezinti; {normalize(yol) → {mtime,size}}. Yalnızca stat okur. */
function walk(root) {
  const out = new Map();
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (LANG[path.extname(e.name)]) {
        try {
          const st = fs.statSync(p);
          if (st.size <= MAX_BYTES) out.set(path.normalize(p), { mtime: Math.floor(st.mtimeMs), size: st.size });
        } catch { /* atla */ }
      }
    }
  }
  return out;
}

function matches(text, regexes) {
  const out = new Set();
  for (const re of regexes) for (const m of text.matchAll(re)) out.add(m[1]);
  return [...out];
}

/** Çözümleme dizini: dosya kümesi + Dart paket ve Python modül son-ek haritaları (O(1) arama). */
function buildIndex(paths, root) {
  const set = new Set(paths);
  const dartLib = new Map();
  const pyMods = new Map();
  for (const p of paths) {
    const f = p.replace(/\\/g, '/');
    if (p.endsWith('.dart')) {
      let i = -1;
      while ((i = f.indexOf('/lib/', i + 1)) >= 0) {
        const k = f.slice(i + 5);
        if (!dartLib.has(k)) dartLib.set(k, p);
      }
    } else if (p.endsWith('.py')) {
      const segs = path.relative(root, p).replace(/\\/g, '/').replace(/\.py$/, '').split('/');
      if (segs.at(-1) === '__init__') segs.pop();
      for (let k = 0; k < segs.length; k++) {
        const key = segs.slice(k).join('.');
        if (key && !pyMods.has(key)) pyMods.set(key, p);
      }
    }
  }
  return { set, dartLib, pyMods };
}

function resolveImport(spec, fromFile, lang, ix) {
  const tryPaths = (base) => {
    const exts = lang === 'js' ? ['', '.js', '.mjs', '.ts', '.tsx', '.jsx', '/index.js', '/index.ts', '/index.tsx'] : lang === 'py' ? ['.py', '/__init__.py'] : [''];
    for (const x of exts) {
      const p = path.normalize(base + x);
      if (ix.set.has(p)) return p;
    }
    return null;
  };
  if (lang === 'js') {
    if (!spec.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), spec);
    // TS'te './x.js' gerçekte x.ts olabilir.
    return tryPaths(base) || tryPaths(path.resolve(path.dirname(fromFile), spec.replace(/\.[cm]?js$/, '')));
  }
  if (lang === 'dart') {
    if (spec.startsWith('dart:')) return null;
    if (spec.startsWith('package:')) return ix.dartLib.get(spec.replace(/^package:[^/]+\//, '')) || null;
    return tryPaths(path.resolve(path.dirname(fromFile), spec));
  }
  if (spec.startsWith('.')) {
    const dots = spec.match(/^\.+/)[0].length;
    let base = path.dirname(fromFile);
    for (let i = 1; i < dots; i++) base = path.dirname(base);
    const rest = spec.slice(dots).replace(/\./g, path.sep);
    return tryPaths(rest ? path.join(base, rest) : path.join(base, '__init__'));
  }
  return ix.pyMods.get(spec) || null;
}

/**
 * @param {string} rootDir taranacak kod klasörü
 * @param {import('../../core/graph.js').GraphStore} graph
 * @param {{full?: boolean, onProgress?: Function}} opts
 */
export function extractCode(rootDir, graph, { full = false, onProgress } = {}) {
  const root = path.resolve(rootDir);
  const label = path.basename(root);
  const cur = walk(root);
  const db = graph.db;
  const idOf = (f) => `file:${label}/${path.relative(root, f).replace(/\\/g, '/')}`;

  if (full) removeRoot(graph, root);
  const prev = new Map();
  for (const r of db.prepare('SELECT path, mtime, size FROM files WHERE root = ?').iterate(root)) prev.set(r.path, r);

  const changed = [];
  for (const [p, st] of cur) {
    const k = prev.get(p);
    if (!k || k.mtime !== st.mtime || k.size !== st.size) changed.push(p);
  }
  const removed = [...prev.keys()].filter((p) => !cur.has(p));
  const fileSetChanged = removed.length > 0 || changed.some((p) => !prev.has(p));

  graph.tx(() => {
    // 1) Silinen dosyalar: düğüm, sembol ve değen tüm kenarlar.
    const symsOf = db.prepare("SELECT id FROM nodes WHERE source = ? AND type = 'symbol'");
    const delRaw = db.prepare('DELETE FROM imports_raw WHERE file = ?');
    const delFile = db.prepare('DELETE FROM files WHERE path = ?');
    for (const p of removed) {
      for (const s of symsOf.all(p)) graph.removeNode(s.id);
      graph.removeNode(idOf(p));
      delFile.run(p);
      delRaw.run(idOf(p));
    }

    // 2) Değişen dosyalar: düğüm + semboller + ham import'lar.
    const insRaw = db.prepare('INSERT INTO imports_raw(file, spec) VALUES (?,?)');
    const upFile = db.prepare('INSERT OR REPLACE INTO files(path, root, mtime, size) VALUES (?,?,?,?)');
    let n = 0;
    for (const p of changed) {
      const lang = LANG[path.extname(p)];
      let text;
      try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
      const fid = idOf(p);
      graph.addNode(fid, { label: path.basename(p), type: 'file', source: p, lang });
      graph.q.delEdgesFrom.run(fid); // defines/imports/uses yeniden kurulacak
      const now = new Set(matches(text, RE[lang].symbols));
      for (const s of symsOf.all(p)) {
        const name = s.id.slice(s.id.lastIndexOf('#') + 1);
        if (!now.has(name)) graph.removeNode(s.id); // artık tanımlı değil
      }
      for (const s of now) {
        const sid = `sym:${fid.slice(5)}#${s}`;
        graph.addNode(sid, { label: s, type: 'symbol', source: p, lang });
        graph.addEdge(fid, sid, 'defines');
      }
      delRaw.run(fid);
      for (const spec of matches(text, RE[lang].imports)) insRaw.run(fid, spec);
      const st = cur.get(p);
      upFile.run(p, root, st.mtime, st.size);
      if (++n % 500 === 0) onProgress?.({ phase: 'symbols', root: label, done: n, total: changed.length });
    }

    // 3) Import çözümü: dosya kümesi değiştiyse tüm dosyalar, yoksa yalnızca değişenler.
    const ix = buildIndex([...cur.keys()], root);
    const targets = fileSetChanged ? [...cur.keys()] : changed;
    const rawOf = db.prepare('SELECT spec FROM imports_raw WHERE file = ?');
    for (const p of targets) {
      const fid = idOf(p);
      if (fileSetChanged) graph.q.delEdgesFromType.run(fid, 'imports');
      const lang = LANG[path.extname(p)];
      for (const { spec } of rawOf.all(fid)) {
        const t = resolveImport(spec, p, lang, ix);
        if (t) graph.addEdge(fid, idOf(t), 'imports');
      }
    }

    // 4) 'uses': projede tekil, ayırt edici semboller; tek geçiş sözlük araması (regex yok).
    const uniq = new Map();
    for (const r of db.prepare(`SELECT label, min(id) AS id FROM nodes WHERE type = 'symbol' AND length(label) >= 5
      GROUP BY label HAVING count(*) = 1`).iterate()) uniq.set(r.label, r.id);
    let u = 0;
    for (const p of changed) {
      let text;
      try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
      const fid = idOf(p);
      const ownPrefix = `sym:${fid.slice(5)}#`;
      const seen = new Set();
      for (const m of text.matchAll(IDENT)) {
        const sid = uniq.get(m[0]);
        if (sid && !seen.has(sid) && !sid.startsWith(ownPrefix)) {
          seen.add(sid);
          graph.addEdge(fid, sid, 'uses');
        }
      }
      if (++u % 500 === 0) onProgress?.({ phase: 'uses', root: label, done: u, total: changed.length });
    }
  });
  return { files: cur.size, changed: changed.length, removed: removed.length };
}

/** Bir kök klasörün tüm kod düğümlerini ve izlerini siler (kaldırılan/yeniden taranan kökler). */
export function removeRoot(graph, root) {
  const db = graph.db;
  const paths = db.prepare('SELECT path FROM files WHERE root = ?').all(root).map((r) => r.path);
  graph.tx(() => {
    const symsOf = db.prepare("SELECT id FROM nodes WHERE source = ? AND type IN ('symbol','file')");
    const delRaw = db.prepare('DELETE FROM imports_raw WHERE file = ?');
    for (const p of paths) {
      for (const s of symsOf.all(p)) {
        graph.removeNode(s.id);
        if (s.id.startsWith('file:')) delRaw.run(s.id);
      }
    }
    db.prepare('DELETE FROM files WHERE root = ?').run(root);
  });
}
