// web/ on http://localhost:5180 (PORT env or first argument overrides; the browser test uses 5181).   node serve.mjs
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('./web/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.dxf': 'text/plain' };

// the app's own content security policy, so the browser test runs under the one the exe has
const CSP = JSON.parse(readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf8')).app.security.csp;

export function serve(port = 5180) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
    const file = join(WEB, path || 'index.html');
    if (!file.startsWith(WEB)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'content-security-policy': CSP }).end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT || process.argv[2]) || 5180;
  await serve(port);
  console.log(`http://localhost:${port}/`);
}
