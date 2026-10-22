// İki uygulamanın paylaştığı küçük HTTP yardımcıları (bağımlılıksız).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'content-type': MIME['.json'] });
  res.end(JSON.stringify(data));
}

export async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/** dir altından dosya sunar; dışarı çıkışı engeller. */
export function serveStatic(res, dir, rel) {
  const full = path.resolve(dir, '.' + path.sep + rel);
  if (!full.startsWith(path.resolve(dir)) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404).end('Bulunamadı');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

/**
 * Sunucu kurar. routes(req, res, url) true dönerse istek işlenmiştir.
 * Yalnızca 127.0.0.1'e bağlanır (yerel kullanım).
 */
export function createApp({ port, publicDir, vendor = {}, routes }) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (await routes(req, res, url)) return;
        return sendJson(res, { error: 'Bilinmeyen uç nokta' }, 404);
      }
      if (url.pathname.startsWith('/vendor/')) {
        const key = url.pathname.slice('/vendor/'.length);
        if (vendor[key]) return serveStatic(res, path.dirname(vendor[key]), path.basename(vendor[key]));
        return res.writeHead(404).end();
      }
      return serveStatic(res, publicDir, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    } catch (e) {
      sendJson(res, { error: String(e.message || e) }, 500);
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));
  return server;
}
