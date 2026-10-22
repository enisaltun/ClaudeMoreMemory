// Ölçek benchmark'ı: sentetik vault + kod ağacı üretir, her işlemi ölçer.
// Kullanım: node bench/bench.mjs [notSayisi] [kodDosyaSayisi]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NOTES = Number(process.argv[2]) || 20000;
const CODE = Number(process.argv[3]) || 20000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hafiza-bench-'));
process.env.HAFIZA_VAULT = path.join(dir, 'vault');
process.env.HAFIZA_OUT = path.join(dir, 'out');

const { Vault } = await import('../core/vault.js');
const { buildGraph, openGraph } = await import('../graph-app/build.js');

const time = (label, fn) => {
  const t = performance.now();
  const r = fn();
  console.log(`${label.padEnd(46)} ${(performance.now() - t).toFixed(1).padStart(9)} ms`);
  return r;
};

// --- veri üretimi ---------------------------------------------------------------
console.log(`Üretiliyor: ${NOTES} not, ${CODE} kod dosyası → ${dir}`);
const vroot = process.env.HAFIZA_VAULT;
for (let i = 0; i < NOTES; i++) {
  const p = path.join(vroot, `k${i % 100}`, `s${i % 10}`, `n${i}.md`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `# n${i}\n[[n${(i * 7) % NOTES}]] [[n${(i * 13 + 1) % NOTES}]] #t${i % 50}\n${'lorem ipsum dolor sit amet '.repeat(40)} benzersiz${i}\n`);
}
const croot = path.join(dir, 'code');
for (let i = 0; i < CODE; i++) {
  const p = path.join(croot, `m${i % 200}`, `f${i}.js`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const dep = (i * 31 + 7) % CODE;
  fs.writeFileSync(p, `import { Sinif${dep} } from '../m${dep % 200}/f${dep}.js';\nexport class Sinif${i} {}\nexport function islem${i}() { return new Sinif${dep}(); }\n`);
}

// --- notlar ---------------------------------------------------------------------
const v = new Vault();
const first = time('NOTLAR  ilk dizinleme (sıfırdan)', () => v.idx.sync());
console.log('  ', JSON.stringify(first));
time('NOTLAR  sync, değişiklik yok (yalnız stat)', () => v.idx.sync());
time('NOTLAR  tam metin arama (nadir kelime)', () => v.idx.search(`benzersiz${NOTES - 5}`));
time('NOTLAR  tam metin arama (yaygın, limit 50)', () => v.idx.search('lorem ipsum'));
time('NOTLAR  ad alt dize arama', () => v.idx.search('n1999'));
time('NOTLAR  info (bağlantı + backlink)', () => v.idx.info('k5/s5/n105'));
time('NOTLAR  kök klasör listesi', () => v.idx.listDir(''));
time('NOTLAR  klasör listesi (k5/s5)', () => v.idx.listDir('k5/s5'));
time('NOTLAR  etikete göre', () => v.idx.byTag('t7', { limit: 200 }));
time('NOTLAR  tek not yaz + indeksle', () => v.write('k0/yeni', 'merhaba [[n5]] #t1'));

// --- graf -----------------------------------------------------------------------
const cfg = { codeDirs: [croot] };
const r1 = time('GRAF    ilk tarama (vault + kod, topluluk dahil)', () => buildGraph({ vault: v, codeDirs: cfg.codeDirs }));
console.log('  ', JSON.stringify({ ...r1.stats, codeDirs: undefined }));
const r2 = time('GRAF    artımlı tarama, değişiklik yok', () => buildGraph({ vault: v, codeDirs: cfg.codeDirs }));
console.log('  ', JSON.stringify({ ...r2.stats, codeDirs: undefined }));
fs.appendFileSync(path.join(croot, 'm0', 'f0.js'), '\nexport class EkSinif {}\n');
const r3 = time('GRAF    artımlı tarama, 1 dosya değişti', () => buildGraph({ vault: v, codeDirs: cfg.codeDirs }));
console.log('  ', JSON.stringify({ changed: r3.stats.changed }));

const g = openGraph();
const hub = g.godNodes(1)[0];
time('GRAF    god nodes (10)', () => g.godNodes(10));
time('GRAF    düğüm ara (alt dize, FTS)', () => g.search('Sinif1234'));
time('GRAF    komşular (200)', () => g.neighbors(hub.id, { limit: 200 }));
time('GRAF    derece', () => g.degree(hub.id));
time('GRAF    alt graf (en merkezi 1500 + kenarlar)', () => g.subgraph({ limit: 1500 }));
time('GRAF    topluluk özeti (20)', () => g.communities(20));
time('GRAF    genişlet (80 komşu)', () => g.expand(hub.id, 80));
// f0 → f7 → f224 → ... zincirini izleyerek gerçekten bağlı bir çift seç
let k = 0;
for (let i = 0; i < 6; i++) k = (k * 31 + 7) % CODE;
const a = `file:code/m0/f0.js`;
const b = `file:code/m${k % 200}/f${k}.js`;
const p = time('GRAF    en kısa yol (çift yönlü BFS)', () => g.path(a, b));
console.log('   yol uzunluğu:', p?.length ?? 'yok');
time('GRAF    rapor', () => g.report());
console.log('  ', JSON.stringify(g.stats()));
g.close();
v.close();
const size = (f) => (fs.statSync(f).size / 1e6).toFixed(1) + ' MB';
console.log('Dizin boyutları: notlar', size(path.join(vroot, '.hafiza', 'index.db')), '· graf', size(path.join(process.env.HAFIZA_OUT, 'graph.db')));
if (process.env.KEEP) console.log('KEEP:', dir); else fs.rmSync(dir, { recursive: true, force: true });
