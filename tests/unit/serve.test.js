// The preview server (scripts/serve.mjs) is also the measuring tool behind scripts/measure-load.mjs, so it must
// never serve an old copy of a file: a comparison of two builds is only meaningful if each really is the build on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../../scripts/serve.mjs';

async function withServer(options, fn) {
  const root = await mkdtemp(join(tmpdir(), 'serve-test-'));
  const server = await serve(0, { root, ...options });
  try { await fn(root, `http://localhost:${server.address().port}`); }
  finally { server.close(); await rm(root, { recursive: true, force: true }); }
}

test('serve --gzip compresses text files and still returns the text', async () => {
  await withServer({ gzip: true }, async (root, base) => {
    await writeFile(join(root, 'a.html'), '<p>hello</p>');
    const res = await fetch(`${base}/a.html`);
    assert.equal(res.headers.get('content-encoding'), 'gzip');
    assert.equal(await res.text(), '<p>hello</p>');
  });
});

test('serve --gzip serves the file as it is now, not as it was when first requested', async () => {
  await withServer({ gzip: true }, async (root, base) => {
    await writeFile(join(root, 'a.html'), 'version one');
    assert.equal(await (await fetch(`${base}/a.html`)).text(), 'version one');
    await writeFile(join(root, 'a.html'), 'version two'); // same length on purpose: a size check alone would not notice
    assert.equal(await (await fetch(`${base}/a.html`)).text(), 'version two');
  });
});

test('serve without --gzip sends files uncompressed', async () => {
  await withServer({}, async (root, base) => {
    await writeFile(join(root, 'a.js'), 'export const x = 1;');
    const res = await fetch(`${base}/a.js`);
    assert.equal(res.headers.get('content-encoding'), null);
    assert.equal(await res.text(), 'export const x = 1;');
  });
});
