import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { findClaudeExecutable } from '../src/path-lookup.mjs';
import { detectProjectState } from '../src/project-state.mjs';
import {
  describeIntake,
  claudeMissingGuidance,
  creatorRootFoundNotice,
  creatorRootNewProjectNotice,
  creatorRootCreatedNotice,
  creatorRootCreateFailedNotice,
  creatorRootPromptText
} from '../src/messages.mjs';
import { loadTaskLabels } from '../src/task-labels.mjs';
import { resolveLauncherAssets, resolveRepoAssets } from '../src/repo-assets.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '..', '..');

async function withScratchRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-launcher-units-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('findClaudeExecutable: PATH 上に実行可能な claude があれば見つける', async () => {
  await withScratchRoot(async (root) => {
    const binDir = join(root, 'bin');
    await mkdir(binDir, { recursive: true });
    const claudePath = join(binDir, 'claude');
    await writeFile(claudePath, '#!/bin/sh\necho fake-claude\n', 'utf8');
    await chmod(claudePath, 0o755);

    const found = findClaudeExecutable(`${binDir}${path.delimiter}/usr/bin`, 'darwin');
    assert.equal(found, claudePath);
  });
});

test('findClaudeExecutable: PATH のどこにも無ければ null', async () => {
  await withScratchRoot(async (root) => {
    const emptyBin = join(root, 'empty-bin');
    await mkdir(emptyBin, { recursive: true });
    const found = findClaudeExecutable(emptyBin, 'darwin');
    assert.equal(found, null);
  });
});

test('findClaudeExecutable: 実行権限が無いファイルは無視する', async () => {
  await withScratchRoot(async (root) => {
    const binDir = join(root, 'bin');
    await mkdir(binDir, { recursive: true });
    const claudePath = join(binDir, 'claude');
    await writeFile(claudePath, 'not executable', 'utf8');
    await chmod(claudePath, 0o644);

    const found = findClaudeExecutable(binDir, 'darwin');
    assert.equal(found, null);
  });
});

test('findClaudeExecutable: win32 では既定拡張子（.exe/.cmd/.bat）を探す', async () => {
  await withScratchRoot(async (root) => {
    const binDir = join(root, 'bin');
    await mkdir(binDir, { recursive: true });
    const claudePath = join(binDir, 'claude.cmd');
    await writeFile(claudePath, '@echo off\r\necho fake-claude\r\n', 'utf8');
    await chmod(claudePath, 0o755);

    const found = findClaudeExecutable(binDir, 'win32', undefined);
    assert.equal(found, claudePath);
  });
});

test('findClaudeExecutable: win32 では拡張子なしファイルを候補にしない（CreateProcess は直接実行できない）', async () => {
  await withScratchRoot(async (root) => {
    const binDir = join(root, 'bin');
    await mkdir(binDir, { recursive: true });
    const posixShim = join(binDir, 'claude');
    await writeFile(posixShim, '#!/bin/sh\necho fake-claude\n', 'utf8');
    await chmod(posixShim, 0o755);

    const found = findClaudeExecutable(binDir, 'win32', undefined);
    assert.equal(found, null);
  });
});

test('findClaudeExecutable: win32 で PATHEXT が注入されればその拡張子順を使う', async () => {
  await withScratchRoot(async (root) => {
    const binDir = join(root, 'bin');
    await mkdir(binDir, { recursive: true });
    const batPath = join(binDir, 'claude.bat');
    await writeFile(batPath, '@echo off\r\necho fake-claude\r\n', 'utf8');
    await chmod(batPath, 0o755);
    // 既定セットには .bat があるので拡張子指定がなくても本来は見つかるが、ここでは
    // PATHEXT が唯一のソースであることを .COM のみに絞って確認する（見つからない）。
    const foundWithoutBat = findClaudeExecutable(binDir, 'win32', '.COM');
    assert.equal(foundWithoutBat, null);

    const foundWithBat = findClaudeExecutable(binDir, 'win32', '.COM;.BAT');
    assert.equal(foundWithBat, batPath);
  });
});

test('findClaudeExecutable: win32 で PATH のどこにも無ければ null', async () => {
  await withScratchRoot(async (root) => {
    const emptyBin = join(root, 'empty-bin');
    await mkdir(emptyBin, { recursive: true });
    const found = findClaudeExecutable(emptyBin, 'win32', undefined);
    assert.equal(found, null);
  });
});

test('detectProjectState: .akari/connections.json が無ければ未セットアップ', async () => {
  await withScratchRoot(async (root) => {
    const state = detectProjectState(root);
    assert.equal(state.scaffolded, false);
    assert.equal(state.intake, null);
  });
});

test('detectProjectState: connections.json があればセットアップ済み、intake.json も読む', async () => {
  await withScratchRoot(async (root) => {
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), '{"providers":[],"policy":{}}', 'utf8');
    await writeFile(join(root, '.akari', 'intake.json'), '{"status":"draft"}', 'utf8');

    const state = detectProjectState(root);
    assert.equal(state.scaffolded, true);
    assert.deepEqual(state.intake, { status: 'draft' });
  });
});

test('detectProjectState: intake.json が壊れている場合は null 扱いで落ちない', async () => {
  await withScratchRoot(async (root) => {
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), '{}', 'utf8');
    await writeFile(join(root, '.akari', 'intake.json'), 'not json', 'utf8');

    const state = detectProjectState(root);
    assert.equal(state.scaffolded, true);
    assert.equal(state.intake, null);
  });
});

test('loadTaskLabels: 実 packages/schemas/intake.schema.json の x-akari-labels を読む（SSOT）', () => {
  const assets = resolveRepoAssets(repoRoot);
  assert.ok(assets.schemasSourceDir, 'このテストはモノレポ checkout 内で実行する前提');
  const labels = loadTaskLabels(assets.schemasSourceDir);
  assert.equal(labels['transcribe-captions'], '文字起こし・テロップ');
  assert.equal(labels['3d-inserts'], '3D・画面はめ込みの演出');
});

test('loadTaskLabels: schemasSourceDir が無ければ組み込みフォールバックを返す', () => {
  const labels = loadTaskLabels(null);
  assert.equal(labels['transcribe-captions'], '文字起こし・テロップ');
});

test('describeIntake: draft のときは未確定であることを案内する', () => {
  const text = describeIntake({ status: 'draft' }, {});
  assert.match(text, /未確定/);
});

test('describeIntake: submitted のときは tasks / target / autonomy を要約する', () => {
  const text = describeIntake(
    {
      status: 'submitted',
      tasks: ['silence-cut'],
      target: { duration_s: null, keep_length: true },
      autonomy: 'full-auto'
    },
    { 'silence-cut': 'いらない間・NG のカット' }
  );
  assert.match(text, /いらない間・NG のカット/);
  assert.match(text, /尺は素材のまま/);
  assert.match(text, /すべておまかせ/);
});

test('describeIntake: intake が無ければその旨を伝える', () => {
  const text = describeIntake(null, {});
  assert.match(text, /まだありません/);
});

test('claudeMissingGuidance: インストール手順の URL を含む', () => {
  const text = claudeMissingGuidance();
  assert.match(text, /https:\/\/claude\.ai\/install\.sh/);
});

test('creatorRootFoundNotice: 作業場パスを 1 行で示す', () => {
  const text = creatorRootFoundNotice('/workspaces/AkariVideo');
  assert.equal(text, '作業場: /workspaces/AkariVideo');
  assert.equal(text.includes('\n'), false, '1 行主義');
});

test('creatorRootNewProjectNotice: 作業場パスと新規プロジェクトパスを両方含む', () => {
  const text = creatorRootNewProjectNotice('/root', '/root/channels/my-channel/videos/2026-08-02-video');
  assert.match(text, /\/root/);
  assert.match(text, /2026-08-02-video/);
});

test('creatorRootCreatedNotice: 作業場を作成した旨と新規プロジェクトパスを含む', () => {
  const text = creatorRootCreatedNotice('/root', '/root/channels/my-channel/videos/2026-08-02-video');
  assert.match(text, /作業場を作成しました/);
  assert.match(text, /2026-08-02-video/);
});

test('creatorRootCreateFailedNotice: エラーメッセージを含み、続行の旨を示す', () => {
  const text = creatorRootCreateFailedNotice('EACCES');
  assert.match(text, /EACCES/);
  assert.match(text, /続けます/);
});

test('creatorRootPromptText: 既定パスを含む 1 行の質問文', () => {
  const text = creatorRootPromptText('/workspaces/AkariVideo');
  assert.match(text, /\/workspaces\/AkariVideo/);
  assert.match(text, /n:/);
});

test('resolveRepoAssets: モノレポ checkout 内では skills / templates / schemas / doctor / akari-tools を全て見つける', () => {
  const assets = resolveRepoAssets(repoRoot);
  assert.ok(assets.skillsSourceDir);
  assert.ok(assets.templateDir);
  assert.ok(assets.schemasSourceDir);
  assert.ok(assets.doctorScript);
  assert.ok(assets.beatmapScript);
  assert.ok(assets.probeFrameScript);
  assert.ok(assets.renderWhenIdleScript);
});

test('resolveRepoAssets: 何も見つからないディレクトリでは全フィールドが null', async () => {
  await withScratchRoot(async (root) => {
    const assets = resolveRepoAssets(root);
    assert.equal(assets.skillsSourceDir, null);
    assert.equal(assets.templateDir, null);
    assert.equal(assets.schemasSourceDir, null);
    assert.equal(assets.doctorScript, null);
    assert.equal(assets.creatorRootModulePath, null);
    assert.equal(assets.beatmapScript, null);
    assert.equal(assets.probeFrameScript, null);
    assert.equal(assets.renderWhenIdleScript, null);
  });
});

test('resolveRepoAssets: creator-root モジュールのパスも解決する', () => {
  const assets = resolveRepoAssets(repoRoot);
  assert.ok(assets.creatorRootModulePath, 'このテストはモノレポ checkout 内で実行する前提');
  assert.match(assets.creatorRootModulePath, /creator-root/);
});

async function writeRepoMarkers(root) {
  const markers = [
    ['skills', 'analyze-footage', 'SKILL.md'],
    ['skills', 'manage-connections', 'bin', 'doctor.mjs'],
    ['templates', 'project-default', 'CLAUDE.md'],
    ['packages', 'schemas', 'analysis.schema.json'],
    ['packages', 'project-scaffold', 'src', 'index.mjs'],
    ['packages', 'creator-root', 'src', 'index.mjs'],
    ['packages', 'akari-tools', 'bin', 'beatmap.mjs'],
    ['packages', 'akari-tools', 'bin', 'probe-frame.mjs'],
    ['packages', 'akari-tools', 'bin', 'render-when-idle.sh']
  ];
  for (const segments of markers) {
    const filePath = join(root, ...segments);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '', 'utf8');
  }
}

test('resolveRepoAssets: scaffold 実装（project-scaffold）のパスも解決する', () => {
  const assets = resolveRepoAssets(repoRoot);
  assert.ok(assets.scaffoldModulePath);
  assert.match(assets.scaffoldModulePath, /project-scaffold/);
});

test('resolveLauncherAssets: checkout に同梱物があれば vendor は見ない', async () => {
  await withScratchRoot(async (root) => {
    const candidateRoot = join(root, 'checkout');
    const vendorRoot = join(root, 'vendor');
    await writeRepoMarkers(candidateRoot);
    await writeRepoMarkers(vendorRoot);

    const assets = resolveLauncherAssets({ candidateRoot, vendorRoot });
    assert.equal(assets.repoRoot, candidateRoot);
    assert.ok(assets.skillsSourceDir.startsWith(candidateRoot));
  });
});

test('resolveLauncherAssets: checkout に何も無ければ vendor 同梱（npm 配布時）へ fallback する', async () => {
  await withScratchRoot(async (root) => {
    const candidateRoot = join(root, 'empty-checkout');
    const vendorRoot = join(root, 'vendor');
    await mkdir(candidateRoot, { recursive: true });
    await writeRepoMarkers(vendorRoot);

    const assets = resolveLauncherAssets({ candidateRoot, vendorRoot });
    assert.equal(assets.repoRoot, vendorRoot);
    assert.ok(assets.skillsSourceDir.startsWith(vendorRoot));
    assert.ok(assets.templateDir.startsWith(vendorRoot));
    assert.ok(assets.schemasSourceDir.startsWith(vendorRoot));
    assert.ok(assets.doctorScript.startsWith(vendorRoot));
    assert.ok(assets.scaffoldModulePath.startsWith(vendorRoot));
    assert.ok(assets.creatorRootModulePath.startsWith(vendorRoot));
    assert.ok(assets.beatmapScript.startsWith(vendorRoot));
    assert.ok(assets.probeFrameScript.startsWith(vendorRoot));
    assert.ok(assets.renderWhenIdleScript.startsWith(vendorRoot));
  });
});
