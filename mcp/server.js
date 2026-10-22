// Claude Code için MCP sunucusu (stdio). stdout'a asla console.log yazma: protokol kanalıdır.
// Tüm araçlar SQLite dizinlerini sorgular; yanıtlar her zaman sınırlıdır (limit/offset), vault/graf ne kadar büyük olursa olsun.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Vault } from '../core/vault.js';
import { buildGraph, openOrBuildGraph } from '../graph-app/build.js';

const vault = new Vault();
let graph = null;
const getGraph = () => (graph ??= openOrBuildGraph());
const fresh = () => vault.idx.ensureFresh(5000); // dış değişiklikleri (Notlar uygulaması, elle düzenleme) yakala
const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });
const err = (t) => ({ ...text(t), isError: true });
const lim = z.number().int().min(1).max(200).optional();
const off = z.number().int().min(0).optional();

const server = new McpServer({ name: 'hafiza', version: '2.0.0' });

server.tool('search_notes', 'Vault notlarında tam metin arama (FTS5, bm25 sıralı; snippet «»)',
  { query: z.string(), limit: lim, offset: off },
  async ({ query, limit, offset }) => { fresh(); return text(vault.idx.search(query, { limit: limit ?? 20, offset: offset ?? 0 })); });

server.tool('list_notes', 'Not adlarını sayfalı listele (prefix = klasör öneki, ör. "Günlük/")',
  { prefix: z.string().optional(), limit: lim, offset: off },
  async ({ prefix, limit, offset }) => {
    fresh();
    return text({ total: vault.idx.count(), names: vault.idx.names({ prefix: prefix ?? '', limit: limit ?? 100, offset: offset ?? 0 }) });
  });

server.tool('read_note', 'Bir notu oku (ad = uzantısız göreli yol); bağlantılar, geri bağlantılar ve etiketlerle',
  { name: z.string() },
  async ({ name }) => {
    fresh();
    const n = vault.resolveLink(name) ?? name;
    if (!vault.exists(n)) return err(`Not yok: ${name}`);
    const info = vault.idx.info(n);
    return text(`${vault.read(n)}\n\n---\nBağlantılar: ${info?.links.map((l) => l.text + (l.name ? '' : ' (yok)')).join(', ') || '-'}\n`
      + `Geri bağlantılar (${info?.backlinkTotal ?? 0}): ${info?.backlinks.join(', ') || '-'}\nEtiketler: ${info?.tags.join(', ') || '-'}`);
  });

server.tool('write_note', 'Not oluştur ya da üzerine yaz; [[wikilink]] ve #etiket kullan', { name: z.string(), content: z.string() },
  async ({ name, content }) => { vault.write(name, content); return text(`Yazıldı: ${name}`); });

server.tool('append_note', 'Mevcut notun sonuna ekle (yoksa oluşturur)', { name: z.string(), content: z.string() },
  async ({ name, content }) => {
    const prev = vault.exists(name) ? vault.read(name).replace(/\s*$/, '\n\n') : '';
    vault.write(name, prev + content + '\n');
    return text(`Eklendi: ${name}`);
  });

server.tool('notes_by_tag', 'Bir etiketi taşıyan notlar (etiketi # olmadan ver)', { tag: z.string(), limit: lim, offset: off },
  async ({ tag, limit, offset }) => { fresh(); return text(vault.idx.byTag(tag.replace(/^#/, ''), { limit: limit ?? 100, offset: offset ?? 0 })); });

server.tool('graph_rescan', 'Vault ve yapılandırılmış kod klasörlerini ARTIMLI tara, grafı güncelle (full=true: tam tarama)',
  { full: z.boolean().optional() },
  async ({ full }) => {
    const store = getGraph();
    const r = buildGraph({ vault, store, full: !!full });
    return text(r.stats);
  });

server.tool('graph_report', 'GRAPH_REPORT: düğüm sayıları, god node\'lar, topluluklar', {}, async () => text(getGraph().report()));

server.tool('graph_query', 'Grafta ada göre düğüm ara (≥3 harf alt dize; type: note|file|symbol|tag)',
  { query: z.string(), type: z.string().optional(), limit: lim },
  async ({ query, type, limit }) => text(getGraph().search(query, { limit: limit ?? 20, type: type ?? null })));

server.tool('graph_neighbors', 'Bir düğümün komşuları, derece sıralı (id: graph_query sonucundan)',
  { id: z.string(), limit: lim, offset: off },
  async ({ id, limit, offset }) => {
    const g = getGraph();
    const node = g.getNode(id);
    if (!node) return err(`Düğüm yok: ${id}`);
    return text({
      node, degree: g.degree(id),
      neighbors: g.neighbors(id, { limit: limit ?? 50, offset: offset ?? 0 }).map((n) => ({ id: n.id, type: n.type, dir: n.dir, label: n.node.label })),
    });
  });

server.tool('graph_path', 'İki düğüm arasındaki en kısa bağlantı yolu', { from: z.string(), to: z.string() },
  async ({ from, to }) => {
    const g = getGraph();
    const p = g.path(from, to);
    return text(p ? p.map((id) => `${g.getNode(id).label} [${id}]`) : 'Yol yok');
  });

server.tool('graph_communities', 'En büyük toplulukların özeti', { limit: lim },
  async ({ limit }) => text(getGraph().communities(limit ?? 20)));

await server.connect(new StdioServerTransport());
