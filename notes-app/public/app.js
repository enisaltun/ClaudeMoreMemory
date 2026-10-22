const $ = (id) => document.getElementById(id);
const api = (path, opt) => fetch('/api/' + path, opt).then((r) => r.json());
const put = (path, method, body) => api(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const PAGE = 300;
let current = null;
let info = { links: [], backlinks: [], backlinkTotal: 0, tags: [] };
let saveTimer = null;
let dirty = false;

// ---- Tembel klasör ağacı: yalnızca açılan klasörün bir sayfası yüklenir -------------------
const dirCache = new Map(); // dir -> {dirs, notes, total}
const expanded = new Set(['']);

async function loadDir(dir, more = false) {
  const have = dirCache.get(dir);
  const offset = more && have ? have.notes.length : 0;
  const r = await api(`tree?dir=${encodeURIComponent(dir)}&limit=${PAGE}&offset=${offset}`);
  dirCache.set(dir, more && have ? { ...r, notes: [...have.notes, ...r.notes] } : r);
}

function renderTree() {
  const ul = $('tree');
  ul.innerHTML = '';
  const walk = (dir, depth) => {
    const d = dirCache.get(dir);
    if (!d) return;
    for (const sub of d.dirs) {
      const full = dir ? dir + '/' + sub.name : sub.name;
      const li = document.createElement('li');
      li.className = 'dir';
      li.style.paddingLeft = 6 + depth * 12 + 'px';
      li.textContent = `${expanded.has(full) ? '▾' : '▸'} ${sub.name} (${sub.count})`;
      li.onclick = async () => {
        if (expanded.has(full)) expanded.delete(full);
        else { expanded.add(full); if (!dirCache.has(full)) await loadDir(full); }
        renderTree();
      };
      ul.append(li);
      if (expanded.has(full)) walk(full, depth + 1);
    }
    for (const n of d.notes) ul.append(noteItem(n, n.split('/').pop(), depth));
    if (d.notes.length < d.total) {
      const li = document.createElement('li');
      li.className = 'dir more';
      li.style.paddingLeft = 6 + depth * 12 + 'px';
      li.textContent = `… ${d.total - d.notes.length} not daha`;
      li.onclick = async () => { await loadDir(dir, true); renderTree(); };
      ul.append(li);
    }
  };
  walk('', 0);
}

function noteItem(name, label, depth = 0) {
  const li = document.createElement('li');
  li.textContent = label;
  li.title = name;
  li.style.paddingLeft = 6 + depth * 12 + 'px';
  if (name === current) li.classList.add('active');
  li.onclick = () => openNote(name);
  return li;
}

async function refreshTree() {
  await Promise.all([...dirCache.keys()].map((d) => loadDir(d)));
  renderTree();
}

// ---- Sağ panel: bağlantılar / geri bağlantılar / etiketler (sunucu dizininden) ---------------
async function loadInfo() {
  if (!current) return;
  const r = await api('info?name=' + encodeURIComponent(current));
  info = r.error ? { links: [], backlinks: [], backlinkTotal: 0, tags: [] } : r;
  renderSide();
}

function renderSide() {
  const fill = (id, items, label, click) => {
    const ul = $(id);
    ul.innerHTML = '';
    for (const x of items) {
      const li = document.createElement('li');
      li.textContent = label(x);
      li.onclick = () => click(x);
      ul.append(li);
    }
  };
  fill('links', info.links, (l) => (l.name ? l.text : l.text + ' (yok)'), (l) => openNote(l.name || l.text, !l.name));
  fill('backlinks', info.backlinks, (x) => x, (x) => openNote(x));
  if (info.backlinkTotal > info.backlinks.length) {
    const li = document.createElement('li');
    li.className = 'dir';
    li.textContent = `… +${info.backlinkTotal - info.backlinks.length} daha`;
    $('backlinks').append(li);
  }
  $('tags').innerHTML = '';
  for (const t of info.tags) {
    const s = document.createElement('span');
    s.className = 'tag';
    s.textContent = '#' + t;
    s.onclick = () => { $('filter').value = '#' + t; runSearch(); };
    $('tags').append(s);
  }
}

// ---- Önizleme -------------------------------------------------------------------------------
function renderPreview() {
  const known = new Map(info.links.map((l) => [l.text.toLowerCase(), !!l.name]));
  const text = $('editor').value.replace(/^---\n[\s\S]*?\n---\n/, '');
  const html = marked.parse(text.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t, a) => {
    const ok = known.get(t.trim().toLowerCase());
    return `<a class="wl${ok === false ? ' missing' : ''}" data-t="${esc(t.trim())}">${esc(a || t)}</a>`;
  }));
  $('preview').innerHTML = html;
  for (const a of $('preview').querySelectorAll('a.wl')) a.onclick = () => openNote(a.dataset.t, true);
}

// ---- Not açma / kaydetme --------------------------------------------------------------------
async function openNote(target, createIfMissing = false) {
  await flush();
  const real = (await api('resolve?target=' + encodeURIComponent(target))).name;
  if (!real && !createIfMissing) return;
  const name = real || target;
  if (!real) await put('note', 'PUT', { name, content: `# ${name.split('/').pop()}\n\n` });
  const r = await api('note?name=' + encodeURIComponent(name));
  current = name;
  $('title').textContent = name;
  $('editor').value = r.content;
  $('editor').disabled = false;
  dirty = false;
  $('status').textContent = '';
  await loadInfo();
  renderPreview();
  const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
  if (!dirCache.has(dir)) await loadDir(dir);
  if (!real) await refreshTree(); else renderTree();
}

async function flush() {
  clearTimeout(saveTimer);
  if (!dirty || !current) return;
  dirty = false;
  await put('note', 'PUT', { name: current, content: $('editor').value });
  $('status').textContent = 'kaydedildi';
}

$('editor').oninput = () => {
  dirty = true;
  $('status').textContent = 'düzenleniyor…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { await flush(); await loadInfo(); renderPreview(); }, 700);
  if (!$('preview').hidden) renderPreview();
};

$('toggle').onclick = () => { $('preview').hidden = !$('preview').hidden; renderPreview(); };
$('new').onclick = () => {
  const n = prompt('Not adı (klasör için Klasör/Ad):');
  if (n) openNote(n.trim(), true);
};
$('daily').onclick = async () => openNote((await put('daily', 'POST', {})).name);
$('del').onclick = async () => {
  if (!current || !confirm(current + ' silinsin mi?')) return;
  await api('note?name=' + encodeURIComponent(current), { method: 'DELETE' });
  current = null;
  $('editor').value = '';
  $('title').textContent = 'Not seçilmedi';
  await refreshTree();
};

// ---- Arama (sunucu tarafında, sayfalı) -----------------------------------------------------
let searchTimer;
let searchOffset = 0;
$('filter').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 200); };

async function runSearch(more = false) {
  const q = $('filter').value.trim();
  const box = $('results');
  if (!q) { box.innerHTML = ''; $('tree').hidden = false; return; }
  $('tree').hidden = true;
  if (!more) { box.innerHTML = ''; searchOffset = 0; }
  const hits = q.startsWith('#')
    ? (await api(`tag?tag=${encodeURIComponent(q.slice(1))}&limit=${PAGE}&offset=${searchOffset}`)).map((name) => ({ name, snippet: '' }))
    : await api(`search?q=${encodeURIComponent(q)}&limit=50&offset=${searchOffset}`);
  searchOffset += hits.length;
  box.querySelector('.moreBtn')?.remove();
  for (const h of hits) {
    const d = document.createElement('div');
    d.className = 'hit';
    d.innerHTML = `<b>${esc(h.name)}</b>${h.snippet ? `<small>${esc(h.snippet).replace(/«/g, '<mark>').replace(/»/g, '</mark>')}</small>` : ''}`;
    d.onclick = () => openNote(h.name);
    box.append(d);
  }
  if (!hits.length && !more) box.innerHTML = '<div class="hit"><small>Sonuç yok</small></div>';
  if (hits.length >= 50 || (q.startsWith('#') && hits.length >= PAGE)) {
    const b = document.createElement('button');
    b.className = 'moreBtn';
    b.textContent = 'Daha fazla';
    b.onclick = () => runSearch(true);
    box.append(b);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); $('filter').focus(); $('filter').select(); }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('filter').focus(); }
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); flush().then(loadInfo); }
});

// ---- Canlı güncelleme: dışarıdan değişen not (ör. Claude) ----------------------------------
let evTimer;
new EventSource('/api/events').onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  clearTimeout(evTimer);
  evTimer = setTimeout(async () => { // yoğun değişikliklerde tek yenileme
    await refreshTree();
    if (!current) return;
    await loadInfo();
    if (!dirty && m.name === current && m.event === 'change') {
      const r = await api('note?name=' + encodeURIComponent(current));
      if (r.content !== undefined && r.content !== $('editor').value) { $('editor').value = r.content; renderPreview(); }
    }
  }, 300);
};

async function pollStatus() {
  const s = await api('status');
  $('count').textContent = `${s.notes} not` + (s.indexing ? ' · dizinleniyor…' : '');
  if (s.indexing) setTimeout(pollStatus, 1500); else refreshTree();
}

$('editor').disabled = true;
loadDir('').then(() => { renderTree(); pollStatus(); });
