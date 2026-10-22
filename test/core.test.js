import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Vault, extractLinks, extractTags, parseFrontmatter } from '../core/vault.js';
import { GraphStore } from '../core/graph.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hafiza-'));

test('wikilink ayrıştırma (alias, başlık, kod bloğu hariç)', () => {
  const t = 'a [[Foo]] b [[Bar|takma]] c [[Baz#bölüm]] `[[Kod]]`\n```\n[[Blok]]\n```';
  assert.deepEqual(extractLinks(t).sort(), ['Bar', 'Baz', 'Foo']);
});

test('etiket ve frontmatter', () => {
  const t = '---\ntitle: X\ntags: [a, b]\n---\nmerhaba #proje #iş/acil';
  assert.equal(parseFrontmatter(t).data.title, 'X');
  assert.deepEqual(extractTags(t).sort(), ['a', 'b', 'iş/acil', 'proje']);
});

test('vault: yaz, bağlantı, backlink, çözümlenmeyen link, arama', () => {
  const v = new Vault(tmp());
  v.write('A', 'bkz [[B]] ve [[Yok]]');
  v.write('klasör/B', 'geri [[A]] #etiket');
  const a = v.idx.info('A');
  assert.deepEqual(a.links, [{ text: 'B', name: 'klasör/B' }, { text: 'Yok', name: null }]);
  assert.deepEqual(a.backlinks, ['klasör/B']);
  assert.deepEqual(v.idx.info('klasör/B').tags, ['etiket']);
  assert.equal(v.search('geri')[0].name, 'klasör/B');
  assert.equal(v.search('ikir').length, 0);
  assert.equal(v.search('klas')[0].name, 'klasör/B'); // ad içinde geçen
  v.close();
});

test('vault: aynı dosya adı → tam yol önce, sonra alfabetik ilk', () => {
  const v = new Vault(tmp());
  v.write('x/Not', '1');
  v.write('y/Not', '2');
  v.write('Not', '3');
  assert.equal(v.resolveLink('Not'), 'Not');
  v.remove('Not');
  assert.equal(v.resolveLink('not'), 'x/Not');
  v.close();
});

test('vault: tembel klasör listesi ve sayfalama', () => {
  const v = new Vault(tmp());
  for (let i = 0; i < 7; i++) v.write(`a/n${i}`, 'x');
  v.write('a/alt/z', 'x');
  v.write('kök', 'x');
  const root = v.idx.listDir('');
  assert.deepEqual(root.dirs, [{ name: 'a', count: 8 }]);
  assert.deepEqual(root.notes, ['kök']);
  const a = v.idx.listDir('a', { limit: 3, offset: 0 });
  assert.equal(a.total, 7);
  assert.equal(a.notes.length, 3);
  assert.deepEqual(a.dirs, [{ name: 'alt', count: 1 }]);
  v.close();
});

test('vault: artımlı sync (dış değişiklik, silme)', () => {
  const root = tmp();
  const v = new Vault(root);
  v.write('A', 'bir');
  fs.writeFileSync(path.join(root, 'B.md'), 'dışarıdan [[A]]'); // dizin dışı yazım
  fs.writeFileSync(path.join(root, 'A.md'), 'değişti kelime');
  let r = v.idx.sync();
  assert.equal(r.total, 2);
  assert.equal(v.search('kelime')[0].name, 'A');
  assert.deepEqual(v.idx.info('A').backlinks, ['B']);
  fs.unlinkSync(path.join(root, 'B.md'));
  r = v.idx.sync();
  assert.equal(r.removed, 1);
  assert.deepEqual(v.idx.info('A').backlinks, []);
  v.close();
});

test('vault: dışarı çıkışı engeller', () => {
  const v = new Vault(tmp());
  assert.throws(() => v.read('../../etc/passwd'));
  v.close();
});

test('graf: yol, komşu, topluluk, rapor, kalıcılık', () => {
  const file = path.join(tmp(), 'g.db');
  let g = new GraphStore(file);
  g.tx(() => {
    for (const id of 'abcdef') g.addNode(id, { type: 'note' });
    [['a', 'b'], ['b', 'c'], ['a', 'c'], ['d', 'e'], ['e', 'f'], ['d', 'f'], ['c', 'd']].forEach(([x, y]) => g.addEdge(x, y));
  });
  g.finalize();
  assert.deepEqual(g.path('a', 'f'), ['a', 'c', 'd', 'f']);
  assert.equal(g.path('a', 'a')[0], 'a');
  assert.equal(g.neighbors('c').length, 3);
  assert.equal(g.degree('c'), 3);
  assert.equal(g.detectCommunities(), 2);
  assert.match(g.report(), /Topluluk: 2/);
  assert.equal(g.godNodes(1)[0].degree, 3);
  assert.equal(g.search('b')[0].id, 'b'); // <3 karakter: önek
  g.close();
  g = new GraphStore(file); // yeniden aç: veri kalıcı
  assert.equal(g.stats().nodes, 6);
  g.close();
});

test('graf: ayrık düğümler için yol yok; alt dize araması; alt graf', () => {
  const g = new GraphStore();
  g.tx(() => {
    g.addNode('KnowledgeGraph', { type: 'symbol' });
    g.addNode('x', { type: 'symbol' });
    g.addNode('y', { type: 'symbol' });
    g.addEdge('x', 'y');
  });
  g.finalize();
  assert.equal(g.path('x', 'KnowledgeGraph'), null);
  assert.equal(g.search('ledge')[0].id, 'KnowledgeGraph');
  const sub = g.subgraph({ limit: 2 });
  assert.equal(sub.nodes.length, 2);
  assert.equal(sub.edges.length, 1);
  assert.equal(g.expand('x').nodes.length, 2);
  g.close();
});
