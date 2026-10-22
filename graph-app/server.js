// Uygulama 2: Graf (Graphify benzeri) — http://localhost:4102
// Tüm sorgular SQLite'tan indeksli gelir; arayüze her zaman sınırlı bir alt graf gider.
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { createApp, sendJson, readBody } from '../core/http.js';
import { openGraph, readConfig, writeConfig, REPORT_FILE } from './build.js';

const root = path.resolve(import.meta.dirname, '..');
const store = openGraph();
const num = (v, d, max) => Math.min(Math.max(parseInt(v ?? '', 10) || d, 1), max);

// Tarama ayrı iş parçacığında: sunucu taramayla ilgili beklemeden sorguları yanıtlar.
const scan = { running: false, progress: null, result: null, error: null };
function startScan(full = false) {
  if (scan.running) return false;
  Object.assign(scan, { running: true, progress: { phase: 'başlıyor' }, result: null, error: null });
  const w = new Worker(path.join(import.meta.dirname, 'scan-worker.js'), { workerData: { full } });
  w.on('message', (m) => {
    if (m.type === 'progress') scan.progress = m;
    else if (m.type === 'done') { scan.result = m.stats; scan.running = false; }
    else if (m.type === 'error') { scan.error = m.error; scan.running = false; }
  });
  w.on('error', (e) => { scan.error = String(e); scan.running = false; });
  return true;
}
if (!store.getMeta('lastScan')) startScan();

createApp({
  port: Number(process.env.PORT) || 4102,
  publicDir: path.join(import.meta.dirname, 'public'),
  vendor: { 'force-graph.js': path.join(root, 'node_modules/force-graph/dist/force-graph.min.js') },
  async routes(req, res, url) {
    const q = url.searchParams;
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /api/graph': {
        const community = q.get('community');
        return sendJson(res, {
          ...store.subgraph({
            limit: num(q.get('limit'), 1500, 10000),
            community: community === null || community === '' ? null : Number(community),
            type: q.get('type') || null,
          }),
          stats: store.stats(),
        }), true;
      }
      case 'GET /api/communities':
        return sendJson(res, store.communities(num(q.get('limit'), 30, 200))), true;
      case 'GET /api/config':
        return sendJson(res, readConfig()), true;
      case 'POST /api/config': {
        const b = await readBody(req);
        writeConfig({ codeDirs: (b.codeDirs || []).map((d) => String(d).trim()).filter(Boolean) });
        return sendJson(res, { ok: true }), true;
      }
      case 'POST /api/scan': {
        const b = await readBody(req).catch(() => ({}));
        return sendJson(res, { started: startScan(!!b.full) }), true;
      }
      case 'GET /api/scan':
        return sendJson(res, scan), true;
      case 'GET /api/search':
        return sendJson(res, store.search(q.get('q') || '', { limit: num(q.get('limit'), 20, 100), type: q.get('type') || null })), true;
      case 'GET /api/expand':
        return sendJson(res, store.expand(q.get('id'), num(q.get('limit'), 80, 500)) ?? { nodes: [], edges: [] }), true;
      case 'GET /api/neighbors': {
        const id = q.get('id');
        return sendJson(res, {
          node: store.getNode(id),
          degree: store.degree(id),
          neighbors: store.neighbors(id, { limit: num(q.get('limit'), 100, 500), offset: Math.max(0, parseInt(q.get('offset') || '0', 10)) }),
        }), true;
      }
      case 'GET /api/path': {
        const p = store.path(q.get('from'), q.get('to'));
        if (!p) return sendJson(res, { path: null }), true;
        const sub = store.subgraph({ ids: p });
        const order = new Map(p.map((id, i) => [id, i]));
        return sendJson(res, {
          path: p,
          nodes: sub.nodes,
          edges: sub.edges.filter((e) => Math.abs(order.get(e.source) - order.get(e.target)) === 1),
        }), true;
      }
      case 'GET /api/report':
        return sendJson(res, { report: store.report() }), true;
    }
    return false;
  },
});
void REPORT_FILE;
