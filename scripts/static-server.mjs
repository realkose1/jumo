// Minimal static file server for local preview/testing.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = process.env.PORT || 8765;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.gif': 'image/gif', '.jsx': 'text/babel',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const fp = join(ROOT, normalize(p));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    const body = await readFile(fp);
    res.writeHead(200, { 'Content-Type': TYPES[extname(fp)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, () => console.log(`static server on http://localhost:${PORT}`));
