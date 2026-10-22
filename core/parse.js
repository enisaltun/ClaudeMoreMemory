// Markdown ayrıştırma: frontmatter, [[wikilink]], #etiket. Saf fonksiyonlar, G/Ç yok.
const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const TAG = /(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu;

export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    }
    data[kv[1]] = v;
  }
  return { data, body: text.slice(m[0].length) };
}

function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

export function extractLinks(text) {
  const out = new Set();
  for (const m of stripCode(text).matchAll(WIKILINK)) out.add(m[1].trim());
  return [...out];
}

export function extractTags(text) {
  const { data, body } = parseFrontmatter(text);
  const out = new Set();
  for (const m of stripCode(body).matchAll(TAG)) out.add(m[1]);
  const fm = data.tags;
  if (Array.isArray(fm)) fm.forEach((t) => out.add(String(t).replace(/^#/, '')));
  else if (typeof fm === 'string' && fm) out.add(fm.replace(/^#/, ''));
  return [...out];
}

/** Not adı = uzantısız göreli yol, "/" ayraçlı. */
export const nameOf = (rel) => rel.replace(/\\/g, '/').replace(/\.md$/i, '');
