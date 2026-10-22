// Tarama: vault + seçilen kod klasörleri → graphify-out/graph.db (+ GRAPH_REPORT.md, graph.json özeti).
// Artımlı: değişmeyen dosyalar yeniden okunmaz. Graf sunucusu, MCP ve işçi iş parçacığı bu modülü paylaşır.
import fs from 'node:fs';
import path from 'node:path';
import { Vault } from '../core/vault.js';
import { GraphStore } from '../core/graph.js';
import { extractVault } from './extract/markdown.js';
import { extractCode, removeRoot } from './extract/code.js';

const ROOT = path.resolve(import.meta.dirname, '..');
export const OUT_DIR = path.resolve(process.env.HAFIZA_OUT || path.join(ROOT, 'graphify-out'));
export const GRAPH_DB = path.join(OUT_DIR, 'graph.db');
export const REPORT_FILE = path.join(OUT_DIR, 'GRAPH_REPORT.md');
export const SUMMARY_FILE = path.join(OUT_DIR, 'graph.json');
export const CONFIG_FILE = path.join(OUT_DIR, 'config.json');

/** graph.json'a tam graf yalnızca bu kadar düğümü geçmiyorsa konur; büyüklerde yalnızca özet. */
const FULL_EXPORT_MAX = 5000;

export function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return { codeDirs: [] }; }
}

export function writeConfig(cfg) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

export function openGraph(file = GRAPH_DB) {
  return new GraphStore(file);
}

/**
 * @param {{vault?: Vault, codeDirs?: string[], full?: boolean, store?: GraphStore, onProgress?: Function}} o
 * `store` verilirse kapatılmaz (çağıran sahibi); verilmezse açılıp kapatılır.
 */
export function buildGraph({ vault = new Vault(), codeDirs = readConfig().codeDirs, full = false, store = null, onProgress } = {}) {
  const own = !store;
  store ??= openGraph();
  const t0 = Date.now();
  try {
    onProgress?.({ phase: 'notes' });
    // Vault grafı yalnızca notlar değiştiyse yeniden kurulur (dizin imzası).
    vault.idx.sync();
    const sig = vault.idx.signature();
    const vaultChanged = full || store.getMeta('vaultSig') !== sig;
    if (vaultChanged) {
      extractVault(vault, store, { sync: false });
      store.setMeta('vaultSig', sig);
    }

    const roots = codeDirs.filter((d) => fs.existsSync(d)).map((d) => path.resolve(d));
    let codeChanged = false;
    // Yapılandırmadan çıkarılan kökleri temizle.
    for (const r of store.db.prepare('SELECT DISTINCT root FROM files').all()) {
      if (!roots.includes(r.root)) { removeRoot(store, r.root); codeChanged = true; }
    }
    const stats = { notes: vault.idx.count(), codeFiles: 0, changed: 0, removed: 0, codeDirs: [] };
    for (const d of codeDirs) {
      if (!fs.existsSync(d)) { stats.codeDirs.push({ dir: d, error: 'Klasör yok' }); continue; }
      onProgress?.({ phase: 'code', dir: d });
      const r = extractCode(d, store, { full, onProgress });
      stats.codeFiles += r.files;
      stats.changed += r.changed;
      stats.removed += r.removed;
      codeChanged ||= r.changed > 0 || r.removed > 0;
      stats.codeDirs.push({ dir: d, ...r });
    }
    // Hiçbir şey değişmediyse derece/arama/topluluk/rapor yeniden hesaplanmaz.
    stats.skipped = !vaultChanged && !codeChanged && !!store.getMeta('lastScan');
    if (!stats.skipped) {
      onProgress?.({ phase: 'finalize' });
      store.finalize();
      stats.communities = store.detectCommunities();
      store.setMeta('lastScan', new Date().toISOString());
      writeOutputs(store);
    } else {
      stats.communities = store.stats().communities;
    }
    stats.ms = Date.now() - t0;
    return { store: own ? null : store, stats };
  } finally {
    if (own) store.close();
  }
}

function writeOutputs(store) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, store.report(), 'utf8');
  const s = store.stats();
  const summary = { stats: s, godNodes: store.godNodes(25), communities: store.communities(30) };
  if (s.nodes <= FULL_EXPORT_MAX) Object.assign(summary, store.subgraph({ limit: FULL_EXPORT_MAX }));
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 1), 'utf8');
}

/** Sunucu/MCP için: grafı açar; hiç taranmadıysa ilk taramayı yapar. */
export function openOrBuildGraph() {
  const store = openGraph();
  if (!store.getMeta('lastScan')) buildGraph({ store });
  return store;
}
