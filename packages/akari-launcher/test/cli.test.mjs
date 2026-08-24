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
// isTTY: false は、実 TTY 端末でこのテストを実行した場合に creator-root 初回動線の
// 対話プロンプト（first-run.mjs）が実 stdin を待って固まるのを防ぐための明示的な隔離
// （creator-root 初回動線自体の挙動は creator-root-first-run.test.mjs が担当）。
function isolatedUpdateOptions(root) {
  return {
    env: { ...process.env, AKARI_HOME: join(root, '.akari-home-unused') },
    refreshUpdate: () => {},
    isTTY: false,
    // 素材案内（sounds-setup.mjs の maybeShowAssetIntroNotice）も対象外として殺す:
    // 実処理自体は無害（生涯 1 回のマーカーを隔離済み AKARI_HOME に書くだけ・質問もダウンロードも
    // しない）だが、このテスト群のログ出力をシンプルに保つため注入で無効化する。
    // 挙動自体は sounds-setup.test.mjs / cli-asset-intro.test.mjs が担当。
    showAssetIntro: async () => ({ action: 'isolated-in-test' })
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
    assert.ok(lines.some((line) => line.includes('npm install -g opencode-ai')));
  });
});

test('--yes: Claude Code に --permission-mode acceptEdits を付加する', async () => {
  await withScratchRoot(async (root) => {
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');

    const { log, lines } = collectLogs();
    let claudeCall = null;

    const result = await run(['--yes', '--continue'], {
      projectRoot: root,
      log,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, cwd) => {
        claudeCall = { claudePath, args, cwd };
        return { status: 0 };
      },
      ...isolatedUpdateOptions(root)
    });

    assert.deepEqual(claudeCall, { claudePath: '/fake/bin/claude', args: ['--permission-mode', 'acceptEdits', '--continue'], cwd: root });
    assert.equal(result.exitCode, 0);
    assert.equal(result.claudeLaunched, true);
  });
});

test('--yes: opencode に --auto を付加する', async () => {
  await withScratchRoot(async (root) => {
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');

    const { log, lines } = collectLogs();
    let opencodeCall = null;

    const result = await run(['-y', '--opencode', '--continue'], {
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

    assert.deepEqual(opencodeCall, { opencodePath: '/fake/bin/opencode', args: ['--auto', '--continue'], cwd: root });
    assert.equal(result.exitCode, 0);
    assert.equal(result.opencodeLaunched, true);
  });
});

test('--hermes: Hermes Agent を起動する（--yes は転送しない）', async () => {
  await withScratchRoot(async (root) => {
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');

    const { log, lines } = collectLogs();
    let hermesCall = null;
    const result = await run(['-y', '--hermes', '--continue'], {
      projectRoot: root,
      log,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveHermes: () => '/fake/bin/hermes',
      spawnHermes: (hermesPath, args, cwd) => {
        hermesCall = { hermesPath, args, cwd };
        return { status: 0 };
      },
      ...isolatedUpdateOptions(root)
    });

    assert.deepEqual(hermesCall, { hermesPath: '/fake/bin/hermes', args: ['--continue'], cwd: root });
    assert.equal(result.exitCode, 0);
    assert.equal(result.hermesLaunched, true);
    assert.ok(lines.some((line) => line.includes('Hermes Agent を起動します…')));
  });
});

test('--hermes: Hermes Agent 不在時は案内を出して終了する', async () => {
  await withScratchRoot(async (root) => {
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');

    const { log, lines } = collectLogs();
    const result = await run(['--here', '--hermes'], {
      projectRoot: root,
      log,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveHermes: () => null,
      ...isolatedUpdateOptions(root)
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.hermesLaunched, false);
    assert.ok(lines.some((line) => line.includes('Hermes Agent コマンドが見つかりませんでした')));
  });
});

// --- U5（タスク契約 2026-08-11-update-u5-cli-auto-update）: 起動非ブロック性の固定 ---
// 契約 §11「起動時にネットワークを待つことは今後もない」の直接的な回帰ガード。
// バックグラウンド staging（`runBackgroundFetch` 拡張）は `triggerBackgroundRefresh` が
// spawn する detached 子プロセスの中でのみ行われる設計だが、それを保証しているのは
// 「`run()` が `refreshUpdate(...)` を await していないこと」という 1 行の事実そのもの
// （cli.mjs 内で `(options.refreshUpdate ?? triggerBackgroundRefresh)({ env });` に
// `await` が付いていない）。ここでは意図的に「解決に時間がかかる」`refreshUpdate` を
// 注入し、`run()` がそれを待たずに戻ることを直接タイミングで証明する。

test('U5: run() は refreshUpdate（バックグラウンド fetch のトリガー）の完了を待たずに戻る（起動非ブロック性の固定）', async () => {
  await withScratchRoot(async (root) => {
    // 既存パターン（他テスト群）と同じく .akari/ を先に用意し、scaffold・実 doctor
    // ネットワーク疎通チェックを迂回する（本題は refreshUpdate の非 await 性のみ）。
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');

    const { log } = collectLogs();
    let refreshUpdateResolved = false;
    const startedAt = Date.now();

    const result = await run(['--here'], {
      projectRoot: root,
      log,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => null,
      resolveOpencode: () => null,
      ...isolatedUpdateOptions(root),
      // 実装（triggerBackgroundRefresh）は同期的に detached 子プロセスを spawn して
      // すぐ返るだけだが、ここでは意図的に「4 秒かかる」実装で差し替え、run() 側が
      // それを await せずに先へ進むことを直接証明する。
      refreshUpdate: () => new Promise((resolveSlow) => {
        setTimeout(() => {
          refreshUpdateResolved = true;
          resolveSlow();
        }, 4000);
      })
    });

    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < 2000, `run() は refreshUpdate の完了を待たずに戻るはず（実測 ${elapsedMs}ms）`);
    assert.equal(refreshUpdateResolved, false, 'run() が戻った時点ではまだ refreshUpdate（4 秒後に解決）は解決していないこと');
    assert.equal(result.exitCode, 1, 'claude/opencode とも見つからない縮退パス（本題ではないが到達確認）');
  });
});
