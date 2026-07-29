import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { run } from '../src/cli.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';
import { createProject } from '../../../packages/project-scaffold/src/index.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '..', '..');

async function withScratchRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-opencode-system-test-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function collectLogs() {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
}

function isolatedUpdateOptions(root) {
  return {
    env: { ...process.env, AKARI_HOME: join(root, '.akari-home-unused') },
    refreshUpdate: () => {}
  };
}

test('システムテスト: opencode モードでプロジェクト作成から起動まで', async () => {
  await withScratchRoot(async (root) => {
    const { log, lines } = collectLogs();
    const assets = resolveRepoAssets(repoRoot);
    
    let opencodeCall = null;

    const result = await run(['--opencode'], {
      projectRoot: root,
      log,
      assets,
      runDoctor: () => ({ status: 0 }),
      resolveOpencode: () => '/fake/bin/opencode',
      spawnOpencode: (opencodePath, args, cwd) => {
        opencodeCall = { opencodePath, args, cwd };
        return { status: 0 };
      },
      ...isolatedUpdateOptions(root)
    });

    // プロジェクトが作成されていることを確認
    const intake = JSON.parse(await readFile(join(root, '.akari', 'intake.json'), 'utf8'));
    assert.equal(intake.status, 'draft');

    // .opencode/ ディレクトリが作成されていることを確認
    const config = JSON.parse(await readFile(join(root, '.opencode', 'config.json'), 'utf8'));
    assert.equal(config.project.type, 'akari-video');

    // opencode が起動されていることを確認
    assert.deepEqual(opencodeCall, { opencodePath: '/fake/bin/opencode', args: [], cwd: root });
    assert.equal(result.exitCode, 0);
    assert.equal(result.opencodeLaunched, true);

    // ログに適切なメッセージが含まれていることを確認
    assert.ok(lines.some((line) => line.includes('opencode を起動します…')));
  });
});

test('システムテスト: 既存プロジェクトで opencode モードを起動', async () => {
  await withScratchRoot(async (root) => {
    // 既存プロジェクトを作成
    const templateDir = join(repoRoot, 'templates', 'project-default');
    await createProject(root, templateDir);

    const { log, lines } = collectLogs();
    let opencodeCall = null;

    const result = await run(['--opencode', '--continue'], {
      projectRoot: root,
      log,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveOpencode: () => '/fake/bin/opencode',
      spawnOpencode: (opencodePath, args, cwd) => {
        opencodeCall = { opencodePath, args, cwd };
        return { status: 0 };
      },
      ...isolatedUpdateOptions(root)
    });

    // 既存プロジェクトが検出されていることを確認
    assert.ok(lines.some((line) => line.includes('既存の AKARI Video プロジェクトを検出しました')));

    // opencode が起動されていることを確認
    assert.deepEqual(opencodeCall, { opencodePath: '/fake/bin/opencode', args: ['--continue'], cwd: root });
    assert.equal(result.exitCode, 0);
    assert.equal(result.opencodeLaunched, true);
  });
});

test('システムテスト: opencode モードで doctor が実行される', async () => {
  await withScratchRoot(async (root) => {
    // 既存プロジェクトを作成
    const templateDir = join(repoRoot, 'templates', 'project-default');
    await createProject(root, templateDir);

    const { log, lines } = collectLogs();
    let doctorCalled = false;

    const result = await run(['--opencode'], {
      projectRoot: root,
      log,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => {
        doctorCalled = true;
        return { status: 0 };
      },
      resolveOpencode: () => '/fake/bin/opencode',
      spawnOpencode: () => ({ status: 0 }),
      ...isolatedUpdateOptions(root)
    });

    // doctor が実行されていることを確認
    assert.equal(doctorCalled, true);
    assert.ok(lines.some((line) => line.includes('接続状態を確認します…')));
  });
});

test('システムテスト: opencode モードで-intake 内容が要約される', async () => {
  await withScratchRoot(async (root) => {
    // 既存プロジェクトを作成し、intake を設定
    const templateDir = join(repoRoot, 'templates', 'project-default');
    await createProject(root, templateDir);
    
    await writeFile(
      join(root, '.akari', 'intake.json'),
      JSON.stringify({
        version: 1,
        tasks: ['transcribe-captions', 'bgm-sfx'],
        target: { duration_s: 120, keep_length: false, taste: null },
        autonomy: 'full-auto',
        status: 'submitted',
        submitted_at: '2026-07-21T00:00:00.000Z'
      }),
      'utf8'
    );

    const { log, lines } = collectLogs();

    const result = await run(['--opencode'], {
      projectRoot: root,
      log,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveOpencode: () => '/fake/bin/opencode',
      spawnOpencode: () => ({ status: 0 }),
      ...isolatedUpdateOptions(root)
    });

    // intake 内容が要約されていることを確認
    assert.ok(lines.some((line) => line.includes('文字起こし・テロップ') && line.includes('BGM・効果音')));
    assert.ok(lines.some((line) => line.includes('目標尺 120 秒')));
    assert.ok(lines.some((line) => line.includes('すべておまかせ')));
  });
});