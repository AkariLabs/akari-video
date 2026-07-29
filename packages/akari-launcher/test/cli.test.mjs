import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { run } from '../src/cli.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '..', '..');

async function withScratchRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-launcher-test-'));
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

// これらのテストは scaffold/doctor/claude 起動の分岐を見るものであり、更新チェックは
// 対象外。実 `~/.akari/` に触れず、実ネットワーク（実 GitHub）へも fetch しないよう、
// AKARI_HOME を隔離した上でバックグラウンド fetch の起動自体を無効化する
// （更新チェック自体の挙動は update-check.test.mjs / update-command.test.mjs が担当）。
function isolatedUpdateOptions(root) {
  return {
    env: { ...process.env, AKARI_HOME: join(root, '.akari-home-unused') },
    refreshUpdate: () => {}
  };
}

test('scaffold 呼び出し: 未セットアップのフォルダでは実際の project-scaffold が呼ばれ、.akari/intake.json (draft) が生成される', async () => {
  await withScratchRoot(async (root) => {
    const { log, lines } = collectLogs();
    const assets = resolveRepoAssets(repoRoot);
    assert.ok(assets.templateDir, 'このテストはモノレポ checkout 内で実行する前提（templates/project-default が見つからない）');

    let doctorCalled = false;
    let claudeCall = null;

    const result = await run(['--continue'], {
      projectRoot: root,
      log,
      assets,
      runDoctor: () => {
        doctorCalled = true;
        return { status: 0 };
      },
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, cwd) => {
        claudeCall = { claudePath, args, cwd };
        return { status: 0 };
      },
      ...isolatedUpdateOptions(root)
    });

    // 実 scaffold が実際に .akari/intake.json (draft) と skills 一式を書いたことを確認する。
    const intake = JSON.parse(await readFile(join(root, '.akari', 'intake.json'), 'utf8'));
    assert.equal(intake.status, 'draft');
    assert.deepEqual(intake.tasks, []);
    assert.ok(await readFile(join(root, '.akari', 'connections.json'), 'utf8'));

    assert.equal(doctorCalled, true, 'scaffold 後に doctor が呼ばれること');
    assert.deepEqual(claudeCall, { claudePath: '/fake/bin/claude', args: ['--continue'], cwd: root });
    assert.equal(result.exitCode, 0);
    assert.equal(result.scaffolded, true);
    assert.equal(result.claudeLaunched, true);

    assert.ok(lines.some((line) => line.includes('まだセットアップされていません')));
    assert.ok(lines.some((line) => line.includes('プロジェクトを作成しました')));
    assert.ok(lines.some((line) => line.includes('draft')));
  });
});

test('doctor 分岐: 既にセットアップ済みのフォルダでは scaffold を呼ばず、intake の内容を要約して doctor を実行する', async () => {
  await withScratchRoot(async (root) => {
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');
    await writeFile(
      join(root, '.akari', 'intake.json'),
      JSON.stringify({
        version: 1,
        tasks: ['transcribe-captions', 'bgm-sfx'],
        target: { duration_s: 60, keep_length: false, taste: null },
        autonomy: 'checkpoint',
        status: 'submitted',
        submitted_at: '2026-07-21T00:00:00.000Z'
      }),
      'utf8'
    );

    const { log, lines } = collectLogs();
    let scaffoldCalled = false;
    let doctorArgs = null;

    const result = await run([], {
      projectRoot: root,
      log,
      assets: resolveRepoAssets(repoRoot),
      scaffold: () => {
        scaffoldCalled = true;
        throw new Error('scaffold は呼ばれてはいけない');
      },
      runDoctor: (doctorScript, projectRoot) => {
        doctorArgs = { doctorScript, projectRoot };
        return { status: 0 };
      },
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: () => ({ status: 0 }),
      ...isolatedUpdateOptions(root)
    });

    assert.equal(scaffoldCalled, false);
    assert.ok(doctorArgs, 'doctor が呼ばれること');
    assert.equal(doctorArgs.projectRoot, root);
    assert.equal(result.scaffolded, true);
    assert.ok(lines.some((line) => line.includes('既存の AKARI Video プロジェクトを検出しました')));
    // 安定 ID -> 日本語ラベル（x-akari-labels）が要約に反映されていること。
    assert.ok(lines.some((line) => line.includes('文字起こし・テロップ') && line.includes('BGM・効果音')));
    assert.ok(lines.some((line) => line.includes('目標尺 60 秒')));
    assert.ok(lines.some((line) => line.includes('要所で確認')));
  });
});

test('claude 不在→opencode 不在: 両方無い場合は案内を出して終了する', async () => {
  await withScratchRoot(async (root) => {
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');

    const { log, lines } = collectLogs();
    let claudeSpawned = false;
    let opencodeSpawned = false;

    const result = await run([], {
      projectRoot: root,
      log,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => null,
      spawnClaude: () => { claudeSpawned = true; return { status: 0 }; },
      resolveOpencode: () => null,
      spawnOpencode: () => { opencodeSpawned = true; return { status: 0 }; },
      ...isolatedUpdateOptions(root)
    });

    assert.equal(claudeSpawned, false);
    assert.equal(opencodeSpawned, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.opencodeLaunched, false);
    assert.ok(lines.some((line) => line.includes('claude コマンドが見つかりませんでした')));
    assert.ok(lines.some((line) => line.includes('https://claude.ai/install.sh')));
  });
});

test('claude 不在→opencode でフォールバック: opencode が見つかれば起動する', async () => {
  await withScratchRoot(async (root) => {
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');

    const { log, lines } = collectLogs();
    let opencodeCall = null;

    const result = await run([], {
      projectRoot: root,
      log,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => null,
      spawnClaude: () => { return { status: 0 }; },
      resolveOpencode: () => '/fake/bin/opencode',
      spawnOpencode: (opencodePath, args, cwd) => {
        opencodeCall = { opencodePath, args, cwd };
        return { status: 0 };
      },
      ...isolatedUpdateOptions(root)
    });

    assert.deepEqual(opencodeCall, { opencodePath: '/fake/bin/opencode', args: [], cwd: root });
    assert.equal(result.exitCode, 0);
    assert.equal(result.opencodeLaunched, true);
    assert.ok(lines.some((line) => line.includes('Claude Code が見つかりません。opencode を起動します…')));
  });
});

test('scaffold が例外を投げても claude 起動までは続行する（「最後に claude を exec」の不変条件）', async () => {
  await withScratchRoot(async (root) => {
    const { log, lines } = collectLogs();
    let claudeCall = null;

    const result = await run([], {
      projectRoot: root,
      log,
      assets: resolveRepoAssets(repoRoot),
      scaffold: () => {
        throw new Error('scaffold 失敗のシミュレーション');
      },
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, cwd) => {
        claudeCall = { claudePath, args, cwd };
        return { status: 7 };
      },
      ...isolatedUpdateOptions(root)
    });

    assert.ok(lines.some((line) => line.includes('エラーが発生しました（続行します）')));
    assert.ok(claudeCall, 'scaffold が失敗しても claude 起動まで到達すること');
    assert.equal(result.exitCode, 7, 'claude の終了コードがそのまま伝播すること');
  });
});

test('opencode モード: --opencode フラグで opencode を起動する', async () => {
  await withScratchRoot(async (root) => {
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');

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

    assert.deepEqual(opencodeCall, { opencodePath: '/fake/bin/opencode', args: ['--continue'], cwd: root });
    assert.equal(result.exitCode, 0);
    assert.equal(result.opencodeLaunched, true);
    assert.ok(lines.some((line) => line.includes('opencode を起動します…')));
  });
});

test('opencode 不在時の案内: PATH に opencode が無い場合は案内を出し、opencode を起動せずに終了する', async () => {
  await withScratchRoot(async (root) => {
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');

    const { log, lines } = collectLogs();
    let opencodeSpawned = false;

    const result = await run(['--opencode'], {
      projectRoot: root,
      log,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveOpencode: () => null,
      spawnOpencode: () => {
        opencodeSpawned = true;
        return { status: 0 };
      },
      ...isolatedUpdateOptions(root)
    });

    assert.equal(opencodeSpawned, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.opencodeLaunched, false);
    assert.ok(lines.some((line) => line.includes('opencode コマンドが見つかりませんでした')));
    assert.ok(lines.some((line) => line.includes('npm install -g opencode')));
  });
});
