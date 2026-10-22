// Copies the pinned browser libraries from node_modules into dist/vendor so the
// static deployment needs no build step and no third-party script CDN. ECharts
// is bundled down to the parts the dashboard uses (scripts/echarts-entry.mjs).
import { cpSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist/vendor');
const files = [
  ['node_modules/echarts/LICENSE', 'echarts.LICENSE.txt'],
  ['node_modules/leaflet/dist/leaflet.js', 'leaflet/leaflet.js'],
  ['node_modules/leaflet/dist/leaflet.css', 'leaflet/leaflet.css'],
  ['node_modules/leaflet/dist/images', 'leaflet/images'],
  ['node_modules/leaflet/LICENSE', 'leaflet/LICENSE.txt'],
];
for (const [from, to] of files) {
  mkdirSync(dirname(join(out, to)), { recursive: true });
  cpSync(join(root, from), join(out, to), { recursive: true });
  console.log('vendored', to);
}
await build({
  entryPoints: [join(root, 'scripts/echarts-entry.mjs')], outfile: join(out, 'echarts.slim.min.js'),
  bundle: true, minify: true, format: 'iife', legalComments: 'none', target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"' },
});
console.log('built echarts.slim.min.js');
