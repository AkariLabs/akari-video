import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PROXY_RECIPE_VERSION } from '../../media-bin/src/proxy-recipe.mjs';

const packageRoot = path.resolve(import.meta.dirname, '..');
const serverEntry = path.join(packageRoot, 'src/server.mjs');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function createStubTools(directory) {
  const ffprobe = path.join(directory, 'ffprobe.mjs');
  const ffmpeg = path.join(directory, 'ffmpeg.mjs');
  writeFileSync(ffprobe, `#!/usr/bin/env node\nprocess.stdout.write(process.env.STUB_CODEC || 'h264,');\n`);
  writeFileSync(ffmpeg, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const output = process.argv.at(-1);
writeFileSync(output, Buffer.alloc(1, 'X'));
await new Promise(resolve => setTimeout(resolve, 300));
writeFileSync(output, Buffer.alloc(2048, 'P'));
`);
  chmodSync(ffprobe, 0o755);
  chmodSync(ffmpeg, 0o755);
  return { ffprobe, ffmpeg };
}

async function startServer(project, tools, codec) {
  const port = await availablePort();
  const child = spawn(process.execPath, [serverEntry, project, '--port', String(port), '--no-lint'], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AKARI_FFPROBE_BIN: tools.ffprobe,
      AKARI_FFMPEG_BIN: tools.ffmpeg,
      AKARI_FRAME_ENGINE_FORCE_SW: '1',
      STUB_CODEC: codec,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('preview server start timeout')), 10_000);
    child.once('error', reject);
    child.stdout.on('data', chunk => {
      if (!chunk.toString().includes(`:${port}`)) return;
      clearTimeout(timeout);
      resolve();
    });
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

async function stopServer(child) {
  if (child.exitCode != null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('close', resolve));
}

async function runRangeScenario(codec) {
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-auto-proxy-'));
  const project = path.join(directory, 'project');
  const tools = createStubTools(directory);
  writeFileSync(path.join(directory, '.keep'), '');
  await import('node:fs/promises').then(fs => fs.mkdir(project));
  writeFileSync(path.join(project, 'source.mp4'), Buffer.alloc(2048, 'O'));
  writeFileSync(path.join(project, 'other.mp4'), Buffer.alloc(2048, 'A'));
  writeFileSync(path.join(project, 'edit.json'), JSON.stringify({ version: 0, source: { path: 'source.mp4' }, cuts: [] }));
  const server = await startServer(project, tools, codec);
  try {
    const response = await fetch(`${server.base}/source.mp4`, { headers: { Range: 'bytes=0-1023' } });
    assert.equal(response.status, 206);
    const firstByte = new Uint8Array(await response.arrayBuffer())[0];
    const isHevc = codec.startsWith('hevc');
    assert.equal(firstByte, isHevc ? 'P'.charCodeAt(0) : 'O'.charCodeAt(0));
    const proxyRoot = path.join(project, '.proxy');
    assert.equal(existsSync(proxyRoot), isHevc);

    const original = await fetch(`${server.base}/source.mp4?akariNoProxy=1`, {
      headers: { Range: 'bytes=0-1023' },
    });
    assert.equal(new Uint8Array(await original.arrayBuffer())[0], 'O'.charCodeAt(0));

    const started = await fetch(`${server.base}/api/auto-proxy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'other.mp4' }),
    });
    assert.equal(started.status, 200);
    let status = await started.json();
    assert.equal(status.status, 'pending');
    const immediate = await fetch(`${server.base}/api/auto-proxy?path=other.mp4`).then(value => value.json());
    assert.equal(immediate.status, 'pending');
    const expectedUrl = `/.proxy/other.mp4.h264-${PROXY_RECIPE_VERSION}.mp4`;
    assert.equal(existsSync(path.join(project, decodeURIComponent(expectedUrl))), false);
    assert.equal((await fetch(`${server.base}${expectedUrl}`)).status, 404);
    for (let attempt = 0; attempt < 50 && status.status !== 'ready'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
      status = await fetch(`${server.base}/api/auto-proxy?path=other.mp4`).then(value => value.json());
    }
    assert.equal(status.status, 'ready');
    assert.match(status.url, /^\/\.proxy\//u);
    assert.equal(readFileSync(path.join(project, decodeURIComponent(status.url))).length, 2048);
    const completed = await fetch(`${server.base}${status.url}`);
    assert.equal(completed.status, 200);
    assert.equal((await completed.arrayBuffer()).byteLength, 2048);

    const codecInfo = await fetch(`${server.base}/api/codec-info`).then(value => value.json());
    assert.equal(codecInfo.forceSoftwareDecode, true);
  } finally {
    await stopServer(server.child);
    rmSync(directory, { recursive: true, force: true });
  }
}

test('normalizes ffprobe codec output and serves or bypasses HEVC proxies', async t => {
  try {
    await runRangeScenario('hevc,');
    await runRangeScenario('hevc');
    await runRangeScenario('h264,');
  } catch (error) {
    if (error?.code === 'EPERM' && error?.syscall === 'listen') {
      t.skip('local TCP listeners are unavailable in this sandbox');
      return;
    }
    throw error;
  }
});
