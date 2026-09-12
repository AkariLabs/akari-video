import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const packageRoot = path.resolve(import.meta.dirname, '..');
const text = value => `${JSON.stringify(value, null, 2)}\n`;

test('preview-server の履歴 route は共有 history-store だけを使う', async () => {
  const source = await readFile(path.join(packageRoot, 'src/server.mjs'), 'utf8');
  assert.match(source, /from '\.\.\/\.\.\/edit-store\/lib\/history-store\.js'/u);
  assert.doesNotMatch(source, /function snapshotEdit\(/u);
  assert.doesNotMatch(source, /const HISTORY_DIR/u);
});

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('preview server did not start');
}

test('preview-server は新形式を列挙・両ファイル復元し旧形式も読み取る', async t => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'akari-preview-history-'));
  const edit = { version: 2, output: { width: 320, height: 180, fps: 30 }, sources: [], tracks: [] };
  const originalEdit = text(edit);
  const originalCaptions = '[]\n';
  await writeFile(path.join(project, 'edit.json'), originalEdit);
  await writeFile(path.join(project, 'captions.json'), originalCaptions);
  const history = path.join(project, '.akari', 'history');
  await mkdir(history, { recursive: true });
  await writeFile(path.join(history, 'edit-2020-01-01.json'), originalEdit);
  let port;
  try { port = await freePort(); }
  catch (error) {
    if (error?.code === 'EPERM') { t.skip('local listen is unavailable in this sandbox'); return; }
    throw error;
  }
  const child = spawn(process.execPath, ['src/server.mjs', project, '--port', String(port), '--no-lint'], { cwd: packageRoot, stdio: 'ignore' });
  t.after(async () => { child.kill('SIGTERM'); await rm(project, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(`${base}/api/edit-history`);

  const changed = { ...edit, output: { ...edit.output, fps: 24 } };
  const put = await fetch(`${base}/api/edit.json`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changed) });
  const putBody = await put.json();
  assert.equal(typeof putBody.snapshot.id, 'string');
  await writeFile(path.join(project, 'captions.json'), '[{"id":"changed"}]\n');

  const listed = await (await fetch(`${base}/api/edit-history`)).json();
  assert.ok(listed.entries.some(entry => entry.legacy && entry.id === 'edit-2020-01-01.json'));
  const current = listed.entries.find(entry => entry.id === putBody.snapshot.id);
  assert.deepEqual(current.files, ['edit.json', 'captions.json']);

  const restored = await fetch(`${base}/api/edit-history/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: current.id }) });
  assert.equal(restored.ok, true, await restored.text());
  assert.equal(await readFile(path.join(project, 'edit.json'), 'utf8'), originalEdit);
  assert.equal(await readFile(path.join(project, 'captions.json'), 'utf8'), originalCaptions);
});
