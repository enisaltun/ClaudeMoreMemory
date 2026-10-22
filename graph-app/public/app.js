const $ = (id) => document.getElementById(id);
const api = (path, opt) => fetch('/api/' + path, opt).then((r) => r.json());
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const PALETTE = ['#8b7cf6', '#4ec9b0', '#f0a35e', '#e06c9f', '#6cb6ff', '#c3e88d', '#ff6b6b', '#e5c07b', '#56b6c2', '#b48ead'];
const colorOf = (n) => (n.type === 'missing' ? '#777' : PALETTE[(n.community ?? 0) % PALETTE.length]);
const STEP = 1500;
const MAX_VIEW = 8000; // tarayıcıda aynı anda çizilecek en çok düğüm

// Görünümdeki alt graf. Tüm graf asla yüklenmez; sunucu en merkezi düğümleri ve istenen komşuluğu verir.
const view = { nodes: new Map(), links: new Map(), limit: STEP };
let selected = null;
let hl = { nodes: new Set(), links: new Set() };
let totals = { nodes: 0, edges: 0 };

const linkKey = (s, t, type) => `${s}\u0000${t}\u0000${type}`;
function merge(nodes, edges) {
  for (const n of nodes) {
    const old = view.nodes.get(n.id);
    if (old) Object.assign(old, n); else view.nodes.set(n.id, { ...n });
  }
  for (const e of edges) {
    if (view.nodes.has(e.source) && view.nodes.has(e.target)) view.links.set(linkKey(e.source, e.target, e.type), e);
  }
}

const fg = ForceGraph()($('graph'))
  .nodeId('id')
  .nodeLabel((n) => `${esc(n.label)} (${n.type}) · derece ${n.degree}`)
  .nodeVal((n) => 1 + Math.sqrt(n.degree || 0) * 2)
  .nodeColor((n) => (hl.nodes.size && !hl.nodes.has(n.id) ? '#55556655' : colorOf(n)))
  .linkColor((l) => (hl.links.has(linkKey(l.source.id ?? l.source, l.target.id ?? l.target, l.type)) ? '#fff' : '#77778855'))
  .linkWidth((l) => (hl.links.has(linkKey(l.source.id ?? l.source, l.target.id ?? l.target, l.type)) ? 2.5 : 0.6))
  .linkDirectionalArrowLength(3)
  .linkDirectionalArrowRelPos(1)
  .cooldownTicks(200)
  .onNodeClick((n) => select(n.id, true))
  .onBackgroundClick(() => select(null));

fg.nodeCanvasObjectMode(() => 'after').nodeCanvasObject((n, ctx, scale) => {
  const major = (n.degree || 0) >= 6 || n.id === selected || hl.nodes.has(n.id);
  if (!major && scale < 2.2) return;
  ctx.font = `${11 / scale}px sans-serif`;
  ctx.fillStyle = getComputedStyle(document.body).color;
  ctx.textAlign = 'center';
  ctx.fillText(n.label, n.x, n.y + 7 / scale + 3);
});

function render() {
  fg.graphData({
    nodes: [...view.nodes.values()],
    links: [...view.links.values()].map((e) => ({ source: e.source, target: e.target, type: e.type })),
  });
  $('stat').textContent = `${view.nodes.size} görünen / ${totals.nodes} düğüm · ${view.links.size} kenar (toplam ${totals.edges})`;
}

/** Süzgeçlere göre görünümü sunucudan yeniden kurar. */
async function reload() {
  const p = new URLSearchParams({ limit: Math.min(view.limit, MAX_VIEW) });
  if ($('types').value) p.set('type', $('types').value);
  if ($('comm').value !== '') p.set('community', $('comm').value);
  const r = await api('graph?' + p);
  view.nodes.clear();
  view.links.clear();
  merge(r.nodes, r.edges);
  totals = r.stats;
  hl = { nodes: new Set(), links: new Set() };
  selected = null;
  $('info').hidden = true;
  render();
}

async function loadCommunities() {
  const list = await api('communities?limit=40');
  const cur = $('comm').value;
  $('comm').innerHTML = '<option value="">Tüm topluluklar</option>' + list
    .map((c) => `<option value="${c.id}">#${c.id} · ${c.size} · ${esc(c.top.slice(0, 3).map((t) => t.label).join(', '))}</option>`).join('');
  $('comm').value = cur;
}

// ---- Düğüm seçimi: sunucudan komşuları getir, görünüme ekle, vurgula ---------------------------
async function select(id, expand = false) {
  selected = id;
  const panel = $('info');
  hl = { nodes: new Set(), links: new Set() };
  if (!id) { panel.hidden = true; return render(); }
  if (expand && view.nodes.size < MAX_VIEW) {
    const ex = await api('expand?id=' + encodeURIComponent(id) + '&limit=80');
    merge(ex.nodes, ex.edges);
    render();
  }
  const r = await api('neighbors?id=' + encodeURIComponent(id) + '&limit=100');
  if (!r.node) return;
  hl.nodes = new Set([id, ...r.neighbors.map((n) => n.id)]);
  for (const k of view.links.keys()) {
    const [s, t] = k.split('\u0000');
    if (s === id || t === id) hl.links.add(k);
  }
  panel.hidden = false;
  panel.innerHTML = `<h3></h3><small></small><div>${esc(r.node.type)} · derece ${r.degree} · topluluk ${r.node.community ?? '-'}</div>
    <button id="pathbtn">Buraya yol bul…</button><ul></ul>`;
  panel.querySelector('h3').textContent = r.node.label;
  panel.querySelector('small').textContent = r.node.source || r.node.id;
  const ul = panel.querySelector('ul');
  for (const n of r.neighbors) {
    const li = document.createElement('li');
    li.textContent = `${n.dir === 'out' ? '→' : '←'} ${n.node.label}  · ${n.type}`;
    li.onclick = () => focus(n.id);
    ul.append(li);
  }
  if (r.degree > r.neighbors.length) {
    const li = document.createElement('li');
    li.textContent = `… +${r.degree - r.neighbors.length} komşu daha (en merkezi 100 gösteriliyor)`;
    ul.append(li);
  }
  $('pathbtn').onclick = () => findPath(id);
  fg.nodeColor(fg.nodeColor());
  const n = view.nodes.get(id);
  if (n?.x !== undefined) fg.centerAt(n.x, n.y, 500);
}

/** Görünümde olmayan bir düğüme git: düğümü ve komşularını ekle, seç. */
async function focus(id) {
  await select(id, true);
}

async function findPath(from) {
  const to = prompt('Hedef düğüm adı (alt dize olabilir):');
  if (!to) return;
  const found = (await api('search?q=' + encodeURIComponent(to) + '&limit=1'))[0];
  if (!found) return alert('Düğüm bulunamadı');
  const r = await api(`path?from=${encodeURIComponent(from)}&to=${encodeURIComponent(found.id)}`);
  if (!r.path) return alert('Yol yok (ya da çok uzak)');
  merge(r.nodes, r.edges);
  render();
  hl = { nodes: new Set(r.path), links: new Set(r.edges.map((e) => linkKey(e.source, e.target, e.type))) };
  fg.nodeColor(fg.nodeColor());
  alert(r.path.map((id) => view.nodes.get(id)?.label ?? id).join(' → '));
}

// ---- Arama: sunucu tarafında, açılır öneri listesi -------------------------------------------
let t;
$('q').oninput = () => {
  clearTimeout(t);
  t = setTimeout(async () => {
    const q = $('q').value.trim();
    const box = $('sugg');
    if (!q) { box.hidden = true; return; }
    const hits = await api('search?q=' + encodeURIComponent(q) + '&limit=15' + ($('types').value ? '&type=' + $('types').value : ''));
    box.innerHTML = '';
    for (const h of hits) {
      const d = document.createElement('div');
      d.innerHTML = `${esc(h.label)}<small>${esc(h.type)} · derece ${h.degree}</small>`;
      d.onclick = async () => { box.hidden = true; await focus(h.id); };
      box.append(d);
    }
    box.hidden = !hits.length;
  }, 200);
};
document.addEventListener('click', (e) => { if (!e.target.closest('.searchbox')) $('sugg').hidden = true; });

$('types').onchange = () => { view.limit = STEP; reload(); };
$('comm').onchange = () => { view.limit = STEP; reload(); };
$('more').onclick = () => { view.limit = Math.min(view.limit + STEP, MAX_VIEW); reload(); };

// ---- Tarama: işçi iş parçacığında çalışır; ilerleme sorgulanır -------------------------------
async function pollScan() {
  const s = await api('scan');
  const p = s.progress;
  $('scan').textContent = s.running ? `Taranıyor… ${p?.phase ?? ''}${p?.done ? ` ${p.done}/${p.total}` : ''}` : 'Yeniden tara';
  $('scan').disabled = s.running;
  if (s.running) return setTimeout(pollScan, 800);
  if (s.error) alert('Tarama hatası:\n' + s.error);
  await Promise.all([reload(), loadCommunities()]);
  if (s.result) $('stat').title = `${s.result.notes} not, ${s.result.codeFiles} kod dosyası (${s.result.changed} değişti), ${s.result.communities} topluluk, ${s.result.ms} ms`;
}
$('scan').onclick = async (e) => {
  const full = e.shiftKey; // Shift+tıkla: tam tarama (uses kenarlarını baştan kurar)
  await post('scan', { full });
  pollScan();
};
$('rep').onclick = async () => {
  $('dlgbody').innerHTML = '<pre></pre>';
  $('dlgbody').querySelector('pre').textContent = (await api('report')).report;
  $('dlg').showModal();
};
$('cfg').onclick = async () => {
  const c = await api('config');
  $('dlgbody').innerHTML = `<p>Taranacak kod klasörleri (her satıra bir tam yol). Vault her zaman taranır.<br>
    <small>Tarama artımlıdır; Shift+“Yeniden tara” tam taramadır.</small></p>
    <textarea id="dirs"></textarea><br><button id="savecfg">Kaydet ve tara</button>`;
  $('dirs').value = (c.codeDirs || []).join('\n');
  $('savecfg').onclick = async () => {
    await post('config', { codeDirs: $('dirs').value.split('\n') });
    $('dlg').close();
    await post('scan', {});
    pollScan();
  };
  $('dlg').showModal();
};
$('close').onclick = () => $('dlg').close();

window.onresize = () => fg.width($('graph').clientWidth).height($('graph').clientHeight);
fg.width($('graph').clientWidth).height($('graph').clientHeight);
pollScan();
