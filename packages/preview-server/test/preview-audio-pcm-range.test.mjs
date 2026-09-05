import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import test from 'node:test';

test('project PCM serves a 96000-byte HTTP Range with exposed headers and a full GET with Accept-Ranges',
  { timeout: 20000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-pcm-range-'));
    let child;
    t.after(async () => {
      if (child) await child.terminate();
      fs.rmSync(root, { recursive: true, force: true });
    });
    const directory = path.join(root, '.akari', 'cache', 'preview-audio');
    fs.mkdirSync(directory, { recursive: true });
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 32);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    fs.writeFileSync(path.join(directory, 'x.pcm'), bytes);
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    child = new Worker(new URL('../src/server.mjs', import.meta.url), {
      argv: [root, '--port', String(port), '--host', '127.0.0.1', '--no-lint'], stdout: true, stderr: true,
    });
    let spawnError;
    let exitCode = null;
    let output = '';
    child.on('error', error => { spawnError = error; });
    child.on('exit', code => { exitCode = code; });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const url = `http://127.0.0.1:${port}/.akari/cache/preview-audio/x.pcm`;
    let full;
    for (let i = 0; i < 100; i++) {
      if (spawnError) throw spawnError;
      if (exitCode !== null) assert.fail(`server exited: ${output}`);
      try { full = await fetch(url, { signal: AbortSignal.timeout(1000) }); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(full, `server did not start: ${output}`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('content-type'), 'application/octet-stream');
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
    const range = await fetch(url, { headers: { Range: 'bytes=0-95999' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), `bytes 0-95999/${bytes.length}`);
    assert.equal(range.headers.get('content-length'), '96000');
    assert.equal(range.headers.get('accept-ranges'), 'bytes');
    assert.equal(range.headers.get('access-control-expose-headers'), 'Content-Range, Accept-Ranges, Content-Length');
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 96000));
    const open = await fetch(url, { headers: { Range: 'bytes=96000-' } });
    assert.equal(open.status, 206);
    assert.equal(open.headers.get('content-length'), String(1024 * 1024));
    assert.deepEqual(Buffer.from(await open.arrayBuffer()), bytes.subarray(96000, 96000 + 1024 * 1024));
  });
