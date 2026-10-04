import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { projectPreviewEdit, migratePreviewCompatibility } from '../src/preview-edit.mjs';
import { lintProject } from '../../edit-lint/src/edit-lint.mjs';

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

async function startServer(t, project, env = process.env, { noLint = true } = {}) {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  // Inherit stdio so restricted Windows environments do not need child-process pipes.
  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '../src/server.mjs'), project, '--port', String(port),
    ...(noLint ? ['--no-lint'] : [])], { stdio: 'inherit', env });
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
  assert.deepEqual(
    (summary.frameEngine?.warnings ?? []).filter(warning => warning.startsWith('overlay:')),
    [],
  );
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

test('preview-server はライブラリ断片を item ごとに実体化し本体と別 item を保つ', async t => {
  const project = await fixture(t, '<div>元の文字</div>');
  const assetId = `telop-${path.basename(project).replace(/[^a-z0-9-]/gi, '-')}`;
  const libraryHome = path.join(project, 'library-home');
  const libraryDir = path.join(libraryHome, 'assets', 'overlay', assetId);
  await mkdir(libraryDir, { recursive: true });
  const libraryFile = path.join(libraryDir, 'fragment.html');
  await writeFile(libraryFile, '<div data-start="0" data-duration="6">ライブラリの文字</div>');
  await writeFile(path.join(libraryDir, 'picture.png'), 'image');
  const beforeStat = await stat(libraryFile);
  const missingPath = `assets/overlay/${assetId}/fragment.html`;
  const libraryEdit = structuredClone(edit);
  libraryEdit.sources = [];
  libraryEdit.tracks = [libraryEdit.tracks[0]];
  libraryEdit.tracks[0].items[0].source.path = missingPath;
  libraryEdit.tracks[0].items[0].duration = 300;
  libraryEdit.tracks[0].items.push({ id: 'other', at: 300, duration: 300,
    source: { kind: 'html', path: missingPath } });
  await writeFile(path.join(project, 'edit.json'), JSON.stringify(libraryEdit));
  await rm(path.join(project, htmlPath));
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await writeFile(path.join(project, '.akari', 'asset-references.json'),
    JSON.stringify({ version: 0, references: [{ category: 'overlay', id: assetId }] }));
  const { base } = await startServer(t, project, { ...process.env, AKARI_HOME: libraryHome }, { noLint: false });
  const response = await fetch(`${base}/api/overlay-html`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'logo', html: '<div data-start="0" data-duration="6">変更後</div>' }) });
  assert.equal(response.status, 200, await response.text());
  const saved = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
  const copied = saved.tracks[0].items[0].source.path;
  assert.match(copied, new RegExp(`^assets/overlay/${assetId}-edit-logo-[a-z0-9]+/fragment\\.html$`, 'u'));
  assert.equal(saved.tracks[0].items[1].source.path, missingPath);
  const copiedHtml = await readFile(path.join(project, copied), 'utf8');
  assert.match(copiedHtml, /変更後/u);
  assert.doesNotMatch(copiedHtml, /\bdata-(?:start|duration)=/u);
  const lint = await lintProject(project, { writeReports: false, env: { ...process.env, AKARI_HOME: libraryHome } });
  assert.deepEqual(lint.findings.filter(finding => finding.severity === 'error'), []);
  assert.equal(await readFile(path.join(project, path.dirname(copied), 'picture.png'), 'utf8'), 'image');
  assert.equal(await readFile(libraryFile, 'utf8'), '<div data-start="0" data-duration="6">ライブラリの文字</div>');
  assert.equal((await stat(libraryFile)).mtimeMs, beforeStat.mtimeMs);
  const again = await fetch(`${base}/api/overlay-html`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'logo', html: '<div>もう一度変更</div>' }) });
  assert.equal(again.status, 200, await again.text());
  assert.equal(JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8')).tracks[0].items[0].source.path, copied);
  assert.equal(await readFile(path.join(project, copied), 'utf8'), '<div>もう一度変更</div>');
});

test('preview-server はライブラリの実体が無ければ参照と写しを変更しない', async t => {
  const project = await fixture(t, '<div>元の文字</div>');
  const missingPath = 'assets/overlay/missing-fragment/fragment.html';
  const libraryEdit = structuredClone(edit);
  libraryEdit.tracks[0].items[0].source.path = missingPath;
  const originalEdit = JSON.stringify(libraryEdit);
  await writeFile(path.join(project, 'edit.json'), originalEdit);
  await rm(path.join(project, htmlPath));
  const { base } = await startServer(t, project);
  const response = await fetch(`${base}/api/overlay-html`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'logo', html: '<div>変更後</div>' }) });
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /ライブラリに断片の実体がありません/u);
  assert.equal(await readFile(path.join(project, 'edit.json'), 'utf8'), originalEdit);
  await assert.rejects(stat(path.join(project, 'assets', 'overlay', 'missing-fragment', 'fragment.html')));
});
