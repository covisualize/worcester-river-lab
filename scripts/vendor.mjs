// Copies the pinned browser libraries from node_modules into dist/vendor so the
// static deployment needs no build step and no third-party script CDN.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist/vendor');
const files = [
  ['node_modules/echarts/dist/echarts.min.js', 'echarts.min.js'],
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
