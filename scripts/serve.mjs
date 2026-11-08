// Minimal static server for dist/ (local preview and end-to-end tests).
//   npm run serve                      dist/ on port 8080 (PORT=... to change)
//   node scripts/serve.mjs --gzip      compress text files like GitHub Pages does (use this when measuring load times)
//   node scripts/serve.mjs --dir PATH  serve another copy of the site (to compare two builds side by side)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const defaultRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.geojson': 'application/geo+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const compressible = new Set(['.html', '.js', '.css', '.json', '.geojson', '.svg', '.txt']);

export function serve(port = Number(process.env.PORT) || 8080, { root = defaultRoot, gzip = false } = {}) {
  const zipped = new Map(); // compressed once per file: this is a measuring tool, so the server's own CPU time must not show up in the numbers
  const server = createServer(async (req, res) => {
    try {
      let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
      let file = join(root, path);
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
      let body = await readFile(file);
      const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream' };
      if (gzip && compressible.has(extname(file)) && /gzip/.test(req.headers['accept-encoding'] || '')) {
        if (!zipped.has(file)) zipped.set(file, gzipSync(body));
        body = zipped.get(file);
        headers['Content-Encoding'] = 'gzip';
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise(done => server.listen(port, () => done(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const root = arg('--dir') ? resolve(arg('--dir')) : defaultRoot;
  const s = await serve(undefined, { root, gzip: process.argv.includes('--gzip') });
  console.log(`Serving ${root} at http://localhost:${s.address().port}${process.argv.includes('--gzip') ? ' (gzip)' : ''}`);
}
