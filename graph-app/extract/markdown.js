// Vault dizininden (NoteIndex) not/etiket düğümleri ve link/tagged kenarları üretir.
// Dosya okumaz; dizin akış olarak taranır. Vault kısmı her taramada baştan kurulur (ucuz).
export function extractVault(vault, graph, { sync = true } = {}) {
  const idx = vault.idx;
  if (sync) idx.sync();
  graph.tx(() => {
    graph.db.exec(`DELETE FROM edges WHERE type IN ('link','tagged');
      DELETE FROM nodes WHERE type IN ('note','missing','tag');`);
    for (const n of idx.iterNotes()) {
      graph.addNode(`note:${n.name}`, { label: n.name.split('/').pop(), type: 'note', source: n.name });
    }
    const resolve = idx.resolver();
    for (const l of idx.iterLinks()) {
      const dst = resolve(l.target);
      if (dst) graph.addEdge(`note:${l.src}`, `note:${dst}`, 'link');
      else {
        graph.addNode(`note:${l.raw}`, { label: l.raw, type: 'missing' });
        graph.addEdge(`note:${l.src}`, `note:${l.raw}`, 'link');
      }
    }
    for (const t of idx.iterTags()) {
      graph.addNode(`tag:${t.tag}`, { label: '#' + t.tag, type: 'tag' });
      graph.addEdge(`note:${t.note}`, `tag:${t.tag}`, 'tagged');
    }
  });
}
