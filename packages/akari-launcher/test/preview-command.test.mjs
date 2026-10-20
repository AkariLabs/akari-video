import { after } from 'node:test';
import { setLanguage } from '../../i18n/index.mjs';

setLanguage('ja');
after(() => setLanguage(undefined));

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  PREVIEW_DEFAULT_PORT,
  extractPreviewUrl,
  parsePreviewArguments,
  runPreviewCommand,
} from '../src/preview-command.mjs';
import { PREVIEW_SERVER_SCRIPT_RELATIVE, resolveLauncherAssets } from '../src/repo-assets.mjs';

function collect() {
  const lines = [];
  return { lines, log: (line) => lines.push(line), error: (line) => lines.push(line) };
}

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

async function withProject(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-preview-test-'));
  try {
    await mkdir(join(root, '.akari'), { recursive: true });
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('preview: 引数は dir / --port / --open を解釈し、既定はカレントと 3000', () => {
  const parsed = parsePreviewArguments(['my-video', '--port', '4567', '--open'], '/work');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.projectRoot, resolve('/work', 'my-video'));
  assert.equal(parsed.port, 4567);
  assert.equal(parsed.open, true);

  const defaults = parsePreviewArguments([], '/work');
  assert.equal(defaults.projectRoot, resolve('/work'));
  assert.equal(defaults.port, PREVIEW_DEFAULT_PORT);
  assert.equal(defaults.open, false);
});

test('preview: 不正なポートと未知のオプションは exit 2 で案内する', async () => {
  const invalidPort = collect();
  assert.equal((await runPreviewCommand(['--port', '0'], { ...invalidPort })).exitCode, 2);
  assert.match(invalidPort.lines[0], /1〜65535/);

  const missingPort = collect();
  assert.equal((await runPreviewCommand(['--port'], { ...missingPort })).exitCode, 2);
  assert.match(missingPort.lines[0], /--port には番号が必要/);

  const unknown = collect();
  assert.equal((await runPreviewCommand(['--nope'], { ...unknown })).exitCode, 2);
  assert.match(unknown.lines[0], /未知のオプション/);
});

test('preview: --help は使い方とオプションを表示して 0 で終わる', async () => {
  const output = collect();
  const result = await runPreviewCommand(['--help'], { ...output });
  assert.equal(result.exitCode, 0);
  assert.match(output.lines[0], /^使い方: akari preview \[dir\]/);
  assert.ok(output.lines.some((line) => line.includes('--port')));
  assert.ok(output.lines.some((line) => line.includes('--open')));
});

test('preview: .akari/ が無いフォルダは案内して終了し、サーバーを起動しない', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-preview-plain-'));
  try {
    let spawned = false;
    const output = collect();
    const result = await runPreviewCommand([root], {
      ...output,
      spawn: () => { spawned = true; },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(spawned, false);
    assert.match(output.lines[0], /プロジェクトではありません/);
    assert.match(output.lines[1], /akari new <dir>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preview: 存在しないフォルダは案内して終了する', async () => {
  const output = collect();
  const result = await runPreviewCommand(['/no/such/akari-project'], { ...output });
  assert.equal(result.exitCode, 1);
  assert.match(output.lines[0], /フォルダが見つかりません/);
});

test('preview: サーバーの URL を 1 行目に出し、--open のときだけブラウザを開く', async () => {
  await withProject(async (root) => {
    const output = collect();
    const opened = [];
    let child;
    let spawnArgs;
    const promise = runPreviewCommand([root, '--port', '4321', '--open'], {
      ...output,
      assets: { previewServerScript: process.execPath, repoRoot: root },
      spawn: (command, args) => {
        spawnArgs = { command, args };
        child = createFakeChild();
        return child;
      },
      openBrowser: (url) => opened.push(url),
    });

    await Promise.resolve();
    child.stdout.emit('data', 'banner line\n\n  http://127.0.0.1:4321\n  project: x\n');
    await Promise.resolve();

    assert.equal(output.lines[0], 'http://127.0.0.1:4321');
    assert.deepEqual(spawnArgs.args.slice(1), [root, '--port', '4321']);
    assert.deepEqual(opened, ['http://127.0.0.1:4321']);

    child.emit('exit', 0);
    const result = await promise;
    assert.equal(result.exitCode, 0);
  });
});

test('preview: --open が無ければブラウザを開かない', async () => {
  await withProject(async (root) => {
    const output = collect();
    let opened = 0;
    let child;
    const promise = runPreviewCommand([root], {
      ...output,
      assets: { previewServerScript: process.execPath, repoRoot: root },
      spawn: () => (child = createFakeChild()),
      openBrowser: () => { opened += 1; },
    });
    await Promise.resolve();
    child.stdout.emit('data', 'http://127.0.0.1:3000\n');
    await Promise.resolve();
    assert.equal(opened, 0);
    child.emit('exit', 0);
    await promise;
  });
});

test('preview: 起動前に終了したら終了コードとサーバーのログを見せる', async () => {
  await withProject(async (root) => {
    const output = collect();
    let child;
    const promise = runPreviewCommand([root], {
      ...output,
      assets: { previewServerScript: process.execPath, repoRoot: root },
      spawn: () => (child = createFakeChild()),
    });
    await Promise.resolve();
    child.stderr.emit('data', 'Error: listen EADDRINUSE: address already in use\n');
    child.emit('exit', 1);
    const result = await promise;
    assert.equal(result.exitCode, 1);
    assert.ok(output.lines.some((line) => line.includes('EADDRINUSE')));
    assert.ok(output.lines.some((line) => line.includes('起動できませんでした')));
  });
});

test('preview: asar の lib 配置では Resources の preview-server へ縮退する', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-preview-asar-'));
  try {
    const candidateRoot = join(root, 'app.asar', 'lib');
    const vendorRoot = join(root, 'vendor');
    const resourcesPath = join(root, 'Resources');
    await mkdir(candidateRoot, { recursive: true });
    await mkdir(join(resourcesPath, 'packages', 'preview-server', 'src'), { recursive: true });
    await writeFile(join(resourcesPath, PREVIEW_SERVER_SCRIPT_RELATIVE), '', 'utf8');

    const assets = resolveLauncherAssets({ candidateRoot, vendorRoot, resourcesPath });
    assert.equal(assets.previewServerScript, join(resourcesPath, PREVIEW_SERVER_SCRIPT_RELATIVE));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preview: URL 行の抽出はサーバーの banner だけに反応する', () => {
  assert.equal(extractPreviewUrl('  http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(extractPreviewUrl('http://localhost:4567'), 'http://localhost:4567');
  assert.equal(extractPreviewUrl('  bind: 127.0.0.1:3000'), null);
  assert.equal(extractPreviewUrl('  project: /tmp/http://x'), null);
});
