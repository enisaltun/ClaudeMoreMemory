import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GraphStore } from '../core/graph.js';
import { Vault } from '../core/vault.js';
import { extractCode } from '../graph-app/extract/code.js';
import { extractVault } from '../graph-app/extract/markdown.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hafiza-'));
const put = (root, rel, text) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const has = (g, from, to, type) =>
  !!g.db.prepare('SELECT 1 x FROM edges WHERE src = ? AND dst = ? AND type = ?').get(from, to, type);
const scan = (r, g, o) => { const x = extractCode(r, g, o); g.finalize(); return x; };

test('JS: import, sınıf, fonksiyon, uses', () => {
  const r = tmp();
  put(r, 'a.js', "import { Servis } from './b.js';\nexport function baslat() { return new Servis(); }");
  put(r, 'b.js', 'export class Servis {}\nconst yardim = async (x) => x;');
  const g = new GraphStore();
  assert.equal(scan(r, g).files, 2);
  const l = path.basename(r);
  assert.ok(has(g, `file:${l}/a.js`, `file:${l}/b.js`, 'imports'));
  assert.ok(g.hasNode(`sym:${l}/a.js#baslat`));
  assert.ok(g.hasNode(`sym:${l}/b.js#yardim`));
  assert.ok(has(g, `file:${l}/a.js`, `sym:${l}/b.js#Servis`, 'uses'));
  g.close();
});

test('Python ve Dart import çözümü', () => {
  const r = tmp();
  put(r, 'app/main.py', 'from app.util import yardimci\nimport os\n');
  put(r, 'app/util.py', 'def yardimci():\n  pass\nclass Arac: pass');
  put(r, 'lib/a.dart', "import 'b.dart';\nimport 'package:proje/b.dart';\nimport 'dart:io';\nclass Ekran {}");
  put(r, 'lib/b.dart', 'class Model {}');
  const g = new GraphStore();
  scan(r, g);
  const l = path.basename(r);
  assert.ok(has(g, `file:${l}/app/main.py`, `file:${l}/app/util.py`, 'imports'));
  assert.ok(has(g, `file:${l}/lib/a.dart`, `file:${l}/lib/b.dart`, 'imports'));
  assert.ok(g.hasNode(`sym:${l}/lib/a.dart#Ekran`));
  g.close();
});

test('node_modules yok sayılır', () => {
  const r = tmp();
  put(r, 'node_modules/x/i.js', 'export class Gizli {}');
  put(r, 'ok.js', 'export class Gorunur {}');
  const g = new GraphStore();
  assert.equal(scan(r, g).files, 1);
  g.close();
});

test('artımlı tarama: değişmeyen dosya atlanır, değişen/silinen/yeni işlenir', () => {
  const r = tmp();
  put(r, 'a.js', "import { Servis } from './b.js';\nexport function baslat() { return new Servis(); }");
  put(r, 'b.js', 'export class Servis {}');
  const g = new GraphStore();
  const l = path.basename(r);
  assert.equal(scan(r, g).changed, 2);
  assert.equal(scan(r, g).changed, 0); // hiçbir şey değişmedi

  // b.js değişir ama Servis kalır: a.js → Servis 'uses' kenarı korunmalı
  put(r, 'b.js', 'export class Servis {}\nexport class Yeni {}');
  const s2 = scan(r, g);
  assert.equal(s2.changed, 1);
  assert.ok(has(g, `file:${l}/a.js`, `sym:${l}/b.js#Servis`, 'uses'));
  assert.ok(g.hasNode(`sym:${l}/b.js#Yeni`));

  // Sembol kaldırılır → düğüm ve kenar da kalkar
  put(r, 'b.js', 'export class Yeni {}');
  scan(r, g);
  assert.ok(!g.hasNode(`sym:${l}/b.js#Servis`));
  assert.ok(!has(g, `file:${l}/a.js`, `sym:${l}/b.js#Servis`, 'uses'));

  // Dosya silinir
  fs.unlinkSync(path.join(r, 'b.js'));
  const s3 = scan(r, g);
  assert.equal(s3.removed, 1);
  assert.ok(!g.hasNode(`file:${l}/b.js`));
  assert.ok(!has(g, `file:${l}/a.js`, `file:${l}/b.js`, 'imports'));

  // Yeni dosya eklenince, değişmeyen a.js'in import'u yeniden çözülür (ham import'lar saklı)
  put(r, 'b.js', 'export class Servis {}');
  scan(r, g);
  assert.ok(has(g, `file:${l}/a.js`, `file:${l}/b.js`, 'imports'));
  g.close();
});

test('vault grafı: not, etiket, eksik not', () => {
  const v = new Vault(tmp());
  v.write('A', '[[B]] [[Yok]] #x');
  v.write('B', 'metin');
  const g = new GraphStore();
  extractVault(v, g);
  assert.ok(has(g, 'note:A', 'note:B', 'link'));
  assert.equal(g.getNode('note:Yok').type, 'missing');
  assert.ok(has(g, 'note:A', 'tag:x', 'tagged'));
  g.close();
  v.close();
});
