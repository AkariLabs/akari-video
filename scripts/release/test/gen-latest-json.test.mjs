import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ARTIFACT_FILES, generateLatestJson, parseArgs } from '../gen-latest-json.mjs';

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function withFixture(callback) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'akari-latest-json-repo-'));
  const artifactsDir = await mkdtemp(join(tmpdir(), 'akari-latest-json-artifacts-'));
  try {
    await mkdir(join(repoRoot, 'apps/shell'), { recursive: true });
    await mkdir(join(repoRoot, 'packages/akari-launcher'), { recursive: true });
    await mkdir(join(repoRoot, 'plugin/.claude-plugin'), { recursive: true });
    await writeFile(join(repoRoot, 'apps/shell/package.json'), JSON.stringify({ version: '0.1.0' }), 'utf8');
    await writeFile(
      join(repoRoot, 'packages/akari-launcher/package.json'),
      JSON.stringify({ name: 'akari-video', version: '0.1.0' }),
      'utf8'
    );
    await writeFile(join(repoRoot, 'plugin/.claude-plugin/plugin.json'), JSON.stringify({ version: '0.1.0' }), 'utf8');

    // フィクスチャ成果物 — ダミーバイト列で可（task.md 受け入れ条件どおり）
    const macBytes = Buffer.from('dummy-mac-zip-bytes');
    const winBytes = Buffer.from('dummy-win-zip-bytes');
    const winSetupBytes = Buffer.from('dummy-win-setup-exe-bytes');
    const cliBytes = Buffer.from('dummy-cli-tarball-bytes');
    await writeFile(join(artifactsDir, ARTIFACT_FILES.shellMac), macBytes);
    await writeFile(join(artifactsDir, ARTIFACT_FILES.shellWin), winBytes);
    await writeFile(join(artifactsDir, ARTIFACT_FILES.shellWinSetup), winSetupBytes);
    await writeFile(join(artifactsDir, ARTIFACT_FILES.cli), cliBytes);

    return await callback({ repoRoot, artifactsDir, macBytes, winBytes, winSetupBytes, cliBytes });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

test('generateLatestJson: 契約 §3 のスキーマ形状と一致し、sha256 が実ファイルと一致する', async () => {
  await withFixture(async ({ repoRoot, artifactsDir, macBytes, winBytes, winSetupBytes, cliBytes }) => {
    const latest = await generateLatestJson({
      artifactsDir,
      tag: 'v0.1.0',
      channel: 'prerelease',
      released: '2026-07-27T00:00:00+09:00',
      repoRoot
    });

    assert.deepEqual(Object.keys(latest).sort(), ['channel', 'components', 'notes_url', 'product', 'released', 'schema']);
    assert.equal(latest.schema, 1);
    assert.equal(latest.product, '0.1.0');
    assert.equal(latest.channel, 'prerelease');
    assert.equal(latest.released, '2026-07-27T00:00:00+09:00');
    assert.equal(latest.notes_url, 'https://github.com/AkariLabs/akari-video/releases/tag/v0.1.0');

    assert.deepEqual(Object.keys(latest.components).sort(), ['cli', 'plugin', 'shell']);

    assert.equal(latest.components.shell.version, '0.1.0');
    assert.equal(latest.components.shell.mac.sha256, sha256(macBytes));
    // 契約 §3 の例示どおり win の正はインストーラ（...exe）。zip は win_zip に併記
    assert.equal(latest.components.shell.win.sha256, sha256(winSetupBytes));
    assert.equal(latest.components.shell.win_zip.sha256, sha256(winBytes));
    assert.equal(
      latest.components.shell.mac.url,
      'https://github.com/AkariLabs/akari-video/releases/download/v0.1.0/shell-mac.zip'
    );
    assert.equal(
      latest.components.shell.win.url,
      'https://github.com/AkariLabs/akari-video/releases/download/v0.1.0/shell-win-setup.exe'
    );
    assert.equal(
      latest.components.shell.win_zip.url,
      'https://github.com/AkariLabs/akari-video/releases/download/v0.1.0/shell-win.zip'
    );

    assert.equal(latest.components.cli.version, '0.1.0');
    assert.equal(latest.components.cli.npm, 'akari-video');
    assert.equal(latest.components.cli.tarball.sha256, sha256(cliBytes));
    assert.equal(
      latest.components.cli.tarball.url,
      'https://github.com/AkariLabs/akari-video/releases/download/v0.1.0/cli.tgz'
    );

    assert.equal(latest.components.plugin.version, '0.1.0');
    assert.equal(Object.keys(latest.components.plugin).length, 1, 'plugin は version のみ（契約 §3 例に url 系フィールドなし）');
  });
});

test('generateLatestJson: channel を stable にすると schema はそのまま channel だけ変わる', async () => {
  await withFixture(async ({ repoRoot, artifactsDir }) => {
    const latest = await generateLatestJson({
      artifactsDir,
      tag: 'v0.1.0',
      channel: 'stable',
      released: '2026-08-15T00:00:00+09:00',
      repoRoot
    });
    assert.equal(latest.channel, 'stable');
    assert.equal(latest.schema, 1);
  });
});

test('generateLatestJson: channel が prerelease/stable 以外なら拒否する', async () => {
  await withFixture(async ({ repoRoot, artifactsDir }) => {
    await assert.rejects(
      generateLatestJson({ artifactsDir, tag: 'v0.1.0', channel: 'beta', released: '2026-07-27T00:00:00+09:00', repoRoot }),
      /channel/
    );
  });
});

test('generateLatestJson: tag が vX.Y.Z 形式でなければ拒否する', async () => {
  await withFixture(async ({ repoRoot, artifactsDir }) => {
    await assert.rejects(
      generateLatestJson({ artifactsDir, tag: '0.1.0', channel: 'prerelease', released: '2026-07-27T00:00:00+09:00', repoRoot }),
      /--tag/
    );
  });
});

test('generateLatestJson: released は必須引数（Date.now() 直書き禁止の裏取り） — 欠落・不正日時は拒否する', async () => {
  await withFixture(async ({ repoRoot, artifactsDir }) => {
    await assert.rejects(
      generateLatestJson({ artifactsDir, tag: 'v0.1.0', channel: 'prerelease', released: '', repoRoot }),
      /--released/
    );
    await assert.rejects(
      generateLatestJson({ artifactsDir, tag: 'v0.1.0', channel: 'prerelease', released: 'not-a-date', repoRoot }),
      /--released/
    );
  });
});

test('generateLatestJson: 同じ入力なら出力が完全に同一（決定論）', async () => {
  await withFixture(async ({ repoRoot, artifactsDir }) => {
    const args = { artifactsDir, tag: 'v0.1.0', channel: 'prerelease', released: '2026-07-27T00:00:00+09:00', repoRoot };
    const a = await generateLatestJson(args);
    const b = await generateLatestJson(args);
    assert.deepEqual(a, b);
  });
});

test('parseArgs: フラグを正しくパースする', () => {
  const args = parseArgs([
    '--artifacts-dir', 'release-artifacts',
    '--tag', 'v0.1.0',
    '--channel', 'stable',
    '--released', '2026-08-01T00:00:00+09:00',
    '--out', 'latest.json',
    '--repo-root', '.'
  ]);
  assert.deepEqual(args, {
    artifactsDir: 'release-artifacts',
    tag: 'v0.1.0',
    channel: 'stable',
    released: '2026-08-01T00:00:00+09:00',
    out: 'latest.json',
    repoRoot: '.'
  });
});

test('parseArgs: 未知のフラグは例外にする', () => {
  assert.throws(() => parseArgs(['--nope', 'x']), /未知の引数/);
});

test('CLI: --out を指定するとファイルにも書き出す', async () => {
  await withFixture(async ({ repoRoot, artifactsDir }) => {
    const outPath = join(artifactsDir, 'latest.json');
    const here = new URL('../gen-latest-json.mjs', import.meta.url).pathname;
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    const { stdout } = await run('node', [
      here,
      '--artifacts-dir', artifactsDir,
      '--tag', 'v0.1.0',
      '--channel', 'prerelease',
      '--released', '2026-07-27T00:00:00+09:00',
      '--out', outPath,
      '--repo-root', repoRoot
    ]);
    const fromStdout = JSON.parse(stdout);
    const fromFile = JSON.parse(await readFile(outPath, 'utf8'));
    assert.deepEqual(fromStdout, fromFile);
    assert.equal(fromStdout.schema, 1);
  });
});
