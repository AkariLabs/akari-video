import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { findClaudeExecutable } from '../src/path-lookup.mjs';
import { detectProjectState } from '../src/project-state.mjs';
import { describeIntake, claudeMissingGuidance } from '../src/messages.mjs';
import { loadTaskLabels } from '../src/task-labels.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';

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

test('resolveRepoAssets: モノレポ checkout 内では skills / templates / schemas / doctor を全て見つける', () => {
  const assets = resolveRepoAssets(repoRoot);
  assert.ok(assets.skillsSourceDir);
  assert.ok(assets.templateDir);
  assert.ok(assets.schemasSourceDir);
  assert.ok(assets.doctorScript);
});

test('resolveRepoAssets: 何も見つからないディレクトリでは全フィールドが null', async () => {
  await withScratchRoot(async (root) => {
    const assets = resolveRepoAssets(root);
    assert.equal(assets.skillsSourceDir, null);
    assert.equal(assets.templateDir, null);
    assert.equal(assets.schemasSourceDir, null);
    assert.equal(assets.doctorScript, null);
  });
});
