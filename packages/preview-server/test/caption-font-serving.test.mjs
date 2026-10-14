import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fontPath = join(root, 'assets/font/noto-sans/NotoSans-Variable.ttf');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('preview serves the pinned Latin caption font by its fixed route', { timeout: 30_000 }, async t => {
  const port = await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolvePort(address.port));
    });
  });
  const server = spawn(process.execPath, [join(root, 'packages/preview-server/src/server.mjs'),
    '--port', String(port), '--no-lint', join(root, 'test-project')], {
    cwd: root, env: process.env, stdio: 'ignore',
  });
  t.after(() => server.kill());
  const url = `http://127.0.0.1:${port}/assets/fonts/akari-noto-sans.ttf`;
  let response;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`preview server exited: ${server.exitCode}`);
    try { response = await fetch(url); break; } catch { await new Promise(done => setTimeout(done, 50)); }
  }
  assert.ok(response, 'preview server did not start');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'font/ttf');
  assert.match(response.headers.get('cache-control'), /immutable/u);
  const font = await readFile(fontPath);
  assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(font));
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), font.length);
});
