import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { projectPreviewEdit, migratePreviewCompatibility } from '../src/preview-edit.mjs';

const htmlPath = 'overlays/lower-third/fragment.html';
const servers = new Map();
const edit = {
  version: 2, output: { width: 320, height: 180, fps: 30 }, sources: [{ id: 'background', path: 'assets/logo.png' }],
  tracks: [{ id: 'visual', lane: 'visual', items: [
    { id: 'logo', at: 0, duration: 30, source: { kind: 'html', path: htmlPath } },
  ] }, { id: 'main', lane: 'visual', items: [
    { id: 'background-cut', at: 0, duration: 30, source: { kind: 'media', src: 'background', in: 0, out: 1 } },
  ] }],
};

async function fixture(t, html) {
  const project = await mkdtemp(path.join(tmpdir(), 'preview-fragment-assets-'));
  t.after(async () => {
    const child = servers.get(project);
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    servers.delete(project);
    await rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await mkdir(path.join(project, 'overlays/lower-third'), { recursive: true });
  await mkdir(path.join(project, 'assets'));
  await writeFile(path.join(project, 'assets/logo.png'), 'image');
  await writeFile(path.join(project, htmlPath), html);
  await writeFile(path.join(project, 'edit.json'), JSON.stringify(edit));
  return project;
}

async function startServer(t, project) {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  // Inherit stdio so restricted Windows environments do not need child-process pipes.
  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '../src/server.mjs'), project, '--port', String(port), '--no-lint'], { stdio: 'inherit' });
  servers.set(project, child);
  let failure;
  child.on('error', error => { failure = error; });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (failure) throw failure;
    if (child.exitCode !== null) throw new Error(`preview server exited ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/api/summary`);
      if (response.ok) return { base, summary: await response.json() };
    } catch { /* Wait for the listener to become ready. */ }
    await delay(100);
  }
  throw new Error('preview server did not become ready');
}

test('summary rewrites fragment URLs and PUT preserves the declared fragment path', async t => {
  const project = await fixture(t, '<div><img src="../../assets/logo.png"></div>');
  const { base, summary } = await startServer(t, project);
  assert.equal(summary.overlays[0].html, '<div><img src="/assets/logo.png"></div>');
  assert.equal(summary.overlays[0].htmlPath, htmlPath);
  assert.deepEqual(summary.frameEngine?.warnings ?? [], []);
  assert.equal(await (await fetch(`${base}/assets/logo.png`)).text(), 'image');
  summary.overlays[0].transform = { x: 12, y: 0, scale: 1, rotate: 0 };
  const response = await fetch(`${base}/api/edit.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Akari-Preview-Projection': '1' },
    body: JSON.stringify(summary),
  });
  assert.equal(response.status, 200, await response.text());
  const saved = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
  const item = saved.tracks.flatMap(track => track.items).find(item => item.id === 'logo');
  assert.equal(item.source.path, htmlPath);
  assert.equal(item.transform.x, 12);
  assert.equal(JSON.stringify(saved).includes('<img'), false);
});

test('missing references remain visible in summary and reach frameEngine warnings', async t => {
  const project = await fixture(t, '<div><img src="../assets/logo.png"></div>');
  const { base, summary } = await startServer(t, project);
  assert.match(summary.overlays[0].html, /src="\/overlays\/assets\/logo.png"/u);
  assert.deepEqual(summary.frameEngine.intake, {});
  assert.deepEqual(summary.frameEngine.skipped, []);
  const fragmentWarnings = summary.frameEngine.warnings.filter(warning => warning.startsWith('overlay:'));
  assert.deepEqual(fragmentWarnings, [
    `overlay:logo fragment ${htmlPath} の参照 "../assets/logo.png" が見つからない。断片ファイル基準では \`overlays/assets/logo.png\` を指しています。project の \`assets/logo.png\` を指すなら \`../../assets/logo.png\` に直してください`,
  ]);
  for (const warning of fragmentWarnings) {
    assert.doesNotMatch(warning, /ENOENT|lstat/u);
    assert.equal(warning.includes(project), false);
  }
  await writeFile(path.join(project, htmlPath), '<div><img src="../../../outside.png"></div>');
  const escaped = await (await fetch(`${base}/api/summary`)).json();
  assert.deepEqual(escaped.frameEngine.warnings.filter(warning => warning.startsWith('overlay:')), [
    `overlay:logo fragment ${htmlPath} の参照 "../../../outside.png": escapes the project root`,
  ]);
  await rm(path.join(project, htmlPath));
  const missingFragment = await (await fetch(`${base}/api/summary`)).json();
  assert.deepEqual(missingFragment.frameEngine.warnings.filter(warning => warning.startsWith('overlay:')), [`overlay:logo fragment ${htmlPath} が見つからない`]);
});

test('projection preserves htmlPath for compatibility migration', async t => {
  const project = await fixture(t, '<div><img src="../../assets/logo.png"></div>');
  const summary = projectPreviewEdit(JSON.stringify(edit), path.join(project, '.akari/preview-projection'), project);
  const migrated = migratePreviewCompatibility(summary);
  assert.equal(migrated.tracks.flatMap(track => track.items).find(item => item.id === 'logo').source.path, htmlPath);
});
