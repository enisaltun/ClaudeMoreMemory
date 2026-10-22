// Uygulama 1: Notlar (Obsidian benzeri) — http://localhost:4101
// Tüm listeleme/arama/backlink sorguları SQLite dizininden gelir; vault boyutundan bağımsızdır.
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import chokidar from 'chokidar';
import { Vault, nameOf } from '../core/vault.js';
import { createApp, sendJson, readBody } from '../core/http.js';

const root = path.resolve(import.meta.dirname, '..');
const vault = new Vault();
const idx = vault.idx;
const clients = new Set();
const num = (v, d, max = 1000) => Math.min(Math.max(parseInt(v ?? '', 10) || d, 0), max);
const notify = (msg) => { for (const res of clients) res.write(`data: ${JSON.stringify(msg)}\n\n`); };

// İlk (ve sonraki) eşitleme ayrı iş parçacığında: dev vault'larda arayüz açılışta donmaz.
const state = { indexing: true, progress: null };
const worker = new Worker(path.join(import.meta.dirname, 'sync-worker.js'));
worker.on('message', (m) => {
  if (m.type === 'progress') state.progress = m;
  else { state.indexing = false; console.log('Dizin hazır:', JSON.stringify(m.result)); notify({ event: 'indexed' }); }
});
worker.on('error', (e) => { state.indexing = false; console.error('Eşitleme hatası:', e); });

// Çalışırken: yalnızca değişen dosyayı güncelle (tüm vault'a dokunma).
const rel = (file) => nameOf(path.relative(vault.root, file));
const watcher = chokidar.watch(vault.root, {
  ignoreInitial: true,
  ignored: (p) => path.relative(vault.root, p).split(path.sep).some((s) => s.startsWith('.')),
  awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
});
watcher.on('add', onFile).on('change', onFile).on('unlink', (f) => {
  if (!f.toLowerCase().endsWith('.md')) return;
  idx.removeNote(rel(f));
  notify({ event: 'unlink', name: rel(f) });
});
function onFile(f) {
  if (!f.toLowerCase().endsWith('.md')) return;
  idx.indexFile(rel(f));
  notify({ event: 'change', name: rel(f) });
}

const today = () => new Date().toISOString().slice(0, 10);

createApp({
  port: Number(process.env.PORT) || 4101,
  publicDir: path.join(import.meta.dirname, 'public'),
  vendor: { 'marked.js': path.join(root, 'node_modules/marked/lib/marked.umd.js') },
  async routes(req, res, url) {
    const q = url.searchParams;
    const name = q.get('name');
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /api/status':
        return sendJson(res, { notes: idx.count(), ...state }), true;
      case 'GET /api/tree':
        return sendJson(res, idx.listDir(q.get('dir') || '', { limit: num(q.get('limit'), 500), offset: num(q.get('offset'), 0, 1e9) })), true;
      case 'GET /api/info': {
        const info = idx.info(name);
        return info ? sendJson(res, info) : sendJson(res, { error: 'Yok' }, 404), true;
      }
      case 'GET /api/resolve':
        return sendJson(res, { name: idx.resolve(q.get('target') || '') }), true;
      case 'GET /api/note':
        if (!vault.exists(name)) return sendJson(res, { error: 'Yok' }, 404), true;
        return sendJson(res, { name, content: vault.read(name) }), true;
      case 'PUT /api/note': {
        const b = await readBody(req);
        vault.write(b.name, b.content ?? '');
        return sendJson(res, { ok: true }), true;
      }
      case 'DELETE /api/note':
        vault.remove(name);
        return sendJson(res, { ok: true }), true;
      case 'POST /api/rename': {
        const b = await readBody(req);
        vault.rename(b.from, b.to);
        return sendJson(res, { ok: true }), true;
      }
      case 'GET /api/search':
        return sendJson(res, idx.search(q.get('q') || '', { limit: num(q.get('limit'), 50, 200), offset: num(q.get('offset'), 0, 1e6) })), true;
      case 'GET /api/tag':
        return sendJson(res, idx.byTag(q.get('tag') || '', { limit: num(q.get('limit'), 200), offset: num(q.get('offset'), 0, 1e9) })), true;
      case 'GET /api/tags':
        return sendJson(res, idx.topTags(num(q.get('limit'), 50, 500))), true;
      case 'GET /api/recent':
        return sendJson(res, idx.recent(num(q.get('limit'), 30, 200))), true;
      case 'POST /api/daily': {
        const n = `Günlük/${today()}`;
        if (!vault.exists(n)) vault.write(n, `# ${today()}\n\n`);
        return sendJson(res, { name: n }), true;
      }
      case 'GET /api/events':
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': bağlandı\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return true;
    }
    return false;
  },
});
