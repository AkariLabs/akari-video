import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { run } from '../src/cli.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';
import { createCreatorRoot, DEFAULT_CHANNEL_NAME } from '../../creator-root/src/index.mjs';

/**
 * `akari` の初回動線（作業場 = creator-root の解決 → 生成 → プロジェクト作成、契約
 * `docs/contract-2026-08-02-creator-root-v1.md` §5・§6-1）の分岐 (a)/(b)/(c) を、実際の
 * creator-root モジュール・project-scaffold を使って検証する（cli.test.mjs / opencode-system
 * の既存流儀を踏襲: options 注入で claude 起動・doctor をスタブ化し、実プロセスは起動しない）。
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '..', '..');

async function withScratchRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-creator-root-firstrun-'));
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

// 素材案内（sounds-setup.mjs の maybeShowAssetIntroNotice）はこのテストの対象外。2026-08-04
// の一括 DL 撤去後は質問もダウンロードもしない無害な処理だが、このテスト群のログ出力を
// creator-root 初回動線の検証だけに絞るため無効化して注入する（update-check を
// refreshUpdate: () => {} で殺すのと同じ隔離規律。素材案内自体の挙動は
// sounds-setup.test.mjs / cli-asset-intro.test.mjs が担当）。
const soundsIsolation = { showAssetIntro: async () => ({ action: 'isolated-in-test' }) };

// 実 ~/.akari/ や実 ~ に一切触れないよう、HOME・AKARI_HOME を隔離した env を作る。
// AKARI_CREATOR_ROOT は明示的に無効化し、開発機の実運用状態を拾わないようにする。
function isolatedEnv(root) {
  return {
    ...process.env,
    HOME: join(root, 'home'),
    AKARI_HOME: join(root, 'akari-home'),
    AKARI_CREATOR_ROOT: undefined
  };
}

test('(a) 作業場内の既存プロジェクトでは scaffold を呼ばず現行動作を維持し、作業場パスを 1 行添える', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const rootDir = join(scratch, 'AkariVideo');
    await createCreatorRoot(rootDir);
    const projectDir = join(rootDir, 'channels', DEFAULT_CHANNEL_NAME, 'videos', 'existing-project');
    await mkdir(join(projectDir, '.akari'), { recursive: true });
    await writeFile(join(projectDir, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');

    const { log, lines } = collectLogs();
    let claudeCall = null;
    let scaffoldCalled = false;

    const result = await run([], {
      projectRoot: projectDir,
      log,
      env,
      assets: resolveRepoAssets(repoRoot),
      scaffold: () => {
        scaffoldCalled = true;
        throw new Error('scaffold は呼ばれてはいけない');
      },
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, cwd) => {
        claudeCall = { claudePath, args, cwd };
        return { status: 0 };
      },
      refreshUpdate: () => {},
      ...soundsIsolation,
      isTTY: false
    });

    assert.equal(scaffoldCalled, false, 'scaffold が呼ばれないこと（既に scaffold 済み）');
    assert.deepEqual(claudeCall, { claudePath: '/fake/bin/claude', args: [], cwd: projectDir });
    assert.equal(result.exitCode, 0);
    assert.equal(result.scaffolded, true);
    assert.ok(lines.includes(`作業場: ${rootDir}`), '実出力: ' + JSON.stringify(lines));
  });
});

test('(a) 作業場を伴わない独立プロジェクト（従来どおり）は影響を受けない', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const projectDir = join(scratch, 'standalone-project');
    await mkdir(join(projectDir, '.akari'), { recursive: true });
    await writeFile(join(projectDir, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');

    const { log, lines } = collectLogs();
    let claudeCall = null;

    await run([], {
      projectRoot: projectDir,
      log,
      env,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, cwd) => {
        claudeCall = { claudePath, args, cwd };
        return { status: 0 };
      },
      refreshUpdate: () => {},
      ...soundsIsolation,
      isTTY: false
    });

    assert.equal(claudeCall?.cwd, projectDir);
    assert.ok(!lines.some((line) => line.startsWith('作業場')), '実出力: ' + JSON.stringify(lines));
  });
});

test('(b) 作業場の中だがプロジェクトではない cwd からは既定チャンネルの videos/ に新規プロジェクトを作って起動する', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const rootDir = join(scratch, 'AkariVideo');
    const created = await createCreatorRoot(rootDir);
    assert.deepEqual(created.manifest.channels, [DEFAULT_CHANNEL_NAME]);

    const { log, lines } = collectLogs();
    let claudeCall = null;

    const result = await run([], {
      projectRoot: rootDir,
      log,
      env,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, cwd) => {
        claudeCall = { claudePath, args, cwd };
        return { status: 0 };
      },
      refreshUpdate: () => {},
      ...soundsIsolation,
      isTTY: false,
      now: new Date(2026, 7, 2)
    });

    const expectedProjectDir = join(rootDir, 'channels', DEFAULT_CHANNEL_NAME, 'videos', '2026-08-02-video');
    assert.equal(claudeCall?.cwd, expectedProjectDir);
    assert.equal(result.exitCode, 0);
    assert.equal(result.scaffolded, true);

    const intake = JSON.parse(await readFile(join(expectedProjectDir, '.akari', 'intake.json'), 'utf8'));
    assert.equal(intake.status, 'draft');

    const pointer = JSON.parse(await readFile(join(env.AKARI_HOME, 'creator-root.json'), 'utf8'));
    assert.equal(pointer.lastRoot, rootDir);

    assert.ok(
      lines.some((line) => line.includes(`作業場 ${rootDir} に新規プロジェクトを作成します`)),
      '実出力: ' + JSON.stringify(lines)
    );
  });
});

test('(b) プロジェクト名衝突: 同日に複数回作成すると -2, -3 と連番になる', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const rootDir = join(scratch, 'AkariVideo');
    await createCreatorRoot(rootDir);
    const videosDir = join(rootDir, 'channels', DEFAULT_CHANNEL_NAME, 'videos');
    await mkdir(join(videosDir, '2026-08-02-video'), { recursive: true });
    await mkdir(join(videosDir, '2026-08-02-video-2'), { recursive: true });

    let claudeCall = null;

    await run([], {
      projectRoot: rootDir,
      log: () => {},
      env,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, cwd) => {
        claudeCall = { claudePath, args, cwd };
        return { status: 0 };
      },
      refreshUpdate: () => {},
      ...soundsIsolation,
      isTTY: false,
      now: new Date(2026, 7, 2)
    });

    assert.equal(claudeCall?.cwd, join(videosDir, '2026-08-02-video-3'));
  });
});

test('(b) root.json の channels が欠如している手作りケースでは DEFAULT_CHANNEL_NAME にフォールバックする', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const rootDir = join(scratch, 'AkariVideo');
    await mkdir(join(rootDir, '.akari'), { recursive: true });
    // 手作りの root.json: schema はあるが channels キー自体が無い。
    await writeFile(join(rootDir, '.akari', 'root.json'), JSON.stringify({ schema: 'creator-root/v1' }), 'utf8');

    let claudeCall = null;

    await run([], {
      projectRoot: rootDir,
      log: () => {},
      env,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, cwd) => {
        claudeCall = { claudePath, args, cwd };
        return { status: 0 };
      },
      refreshUpdate: () => {},
      ...soundsIsolation,
      isTTY: false,
      now: new Date(2026, 7, 2)
    });

    assert.equal(claudeCall?.cwd, join(rootDir, 'channels', DEFAULT_CHANNEL_NAME, 'videos', '2026-08-02-video'));
  });
});

test('(c) --yes: 作業場もプロジェクトも無い場所では既定パスに作業場を自動作成し、対話プロンプトは呼ばない', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });

    let claudeCall = null;
    let promptCalled = false;

    await run(['--yes'], {
      projectRoot: cwd,
      log: () => {},
      env,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, spawnCwd) => {
        claudeCall = { claudePath, args, cwd: spawnCwd };
        return { status: 0 };
      },
      refreshUpdate: () => {},
      ...soundsIsolation,
      prompt: async () => {
        promptCalled = true;
        return '';
      },
      now: new Date(2026, 7, 2)
    });

    assert.equal(promptCalled, false, '--yes のときは対話プロンプトを呼ばないこと');

    const expectedRoot = join(env.HOME, 'AkariVideo');
    const expectedProjectDir = join(expectedRoot, 'channels', DEFAULT_CHANNEL_NAME, 'videos', '2026-08-02-video');
    assert.equal(claudeCall?.cwd, expectedProjectDir);
    assert.ok(claudeCall.args.includes('--permission-mode'), '--yes は claude 起動引数に反映されること');

    const manifest = JSON.parse(await readFile(join(expectedRoot, '.akari', 'root.json'), 'utf8'));
    assert.equal(manifest.schema, 'creator-root/v1');

    const pointer = JSON.parse(await readFile(join(env.AKARI_HOME, 'creator-root.json'), 'utf8'));
    assert.equal(pointer.lastRoot, expectedRoot);
  });
});

test('(c) TTY: 1 問の確認で Enter（既定応答）なら既定パスに作業場を作成する', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });

    const { log, lines } = collectLogs();
    let claudeCall = null;
    let promptText = null;

    await run([], {
      projectRoot: cwd,
      log,
      env,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, spawnCwd) => {
        claudeCall = { claudePath, args, cwd: spawnCwd };
        return { status: 0 };
      },
      refreshUpdate: () => {},
      ...soundsIsolation,
      isTTY: true,
      prompt: async (text) => {
        promptText = text;
        return '';
      },
      now: new Date(2026, 7, 2)
    });

    const expectedRoot = join(env.HOME, 'AkariVideo');
    const expectedProjectDir = join(expectedRoot, 'channels', DEFAULT_CHANNEL_NAME, 'videos', '2026-08-02-video');
    assert.ok(promptText?.includes(expectedRoot), '実出力: ' + promptText);
    assert.equal(claudeCall?.cwd, expectedProjectDir);
    assert.ok(lines.some((line) => line.includes('作業場を作成しました')), '実出力: ' + JSON.stringify(lines));
  });
});

test("(c) TTY: パスを入力するとそのパスに作業場を作成する", async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });
    const customRoot = join(scratch, 'custom-workspace');

    let claudeCall = null;

    await run([], {
      projectRoot: cwd,
      log: () => {},
      env,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, spawnCwd) => {
        claudeCall = { claudePath, args, cwd: spawnCwd };
        return { status: 0 };
      },
      refreshUpdate: () => {},
      ...soundsIsolation,
      isTTY: true,
      prompt: async () => customRoot,
      now: new Date(2026, 7, 2)
    });

    const expectedProjectDir = join(customRoot, 'channels', DEFAULT_CHANNEL_NAME, 'videos', '2026-08-02-video');
    assert.equal(claudeCall?.cwd, expectedProjectDir);
    const manifest = JSON.parse(await readFile(join(customRoot, '.akari', 'root.json'), 'utf8'));
    assert.equal(manifest.schema, 'creator-root/v1');
  });
});

test("(c) TTY: 'n' と答えるとこのフォルダを単体プロジェクトとして扱う（お試しモード = 現行動作）", async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });

    let claudeCall = null;

    await run([], {
      projectRoot: cwd,
      log: () => {},
      env,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, spawnCwd) => {
        claudeCall = { claudePath, args, cwd: spawnCwd };
        return { status: 0 };
      },
      refreshUpdate: () => {},
      ...soundsIsolation,
      isTTY: true,
      prompt: async () => 'n',
      now: new Date(2026, 7, 2)
    });

    assert.equal(claudeCall?.cwd, cwd);
    const intake = JSON.parse(await readFile(join(cwd, '.akari', 'intake.json'), 'utf8'));
    assert.equal(intake.status, 'draft');
    await assert.rejects(readFile(join(env.AKARI_HOME, 'creator-root.json'), 'utf8'), '作業場は作られていないこと');
  });
});

test('(c) 非 TTY: プロンプトを出さずに現行動作（このフォルダで直接 scaffold）へフォールバックする（自動化互換・契約 §9）', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });

    let claudeCall = null;
    let promptCalled = false;

    await run([], {
      projectRoot: cwd,
      log: () => {},
      env,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, spawnCwd) => {
        claudeCall = { claudePath, args, cwd: spawnCwd };
        return { status: 0 };
      },
      refreshUpdate: () => {},
      ...soundsIsolation,
      isTTY: false,
      prompt: async () => {
        promptCalled = true;
        return '';
      }
    });

    assert.equal(promptCalled, false, '非 TTY では対話プロンプトを呼ばないこと');
    assert.equal(claudeCall?.cwd, cwd);
  });
});

test('--here: 作業場の中にいてもお試しモードを強制し、現行動作のままこのフォルダで起動する（TTY でも prompt を呼ばない）', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const rootDir = join(scratch, 'AkariVideo');
    await createCreatorRoot(rootDir);
    const cwd = join(rootDir, 'channels', DEFAULT_CHANNEL_NAME); // 作業場の中・プロジェクトではない

    const { log, lines } = collectLogs();
    let claudeCall = null;

    await run(['--here'], {
      projectRoot: cwd,
      log,
      env,
      assets: resolveRepoAssets(repoRoot),
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, spawnCwd) => {
        claudeCall = { claudePath, args, cwd: spawnCwd };
        return { status: 0 };
      },
      refreshUpdate: () => {},
      ...soundsIsolation,
      isTTY: true,
      prompt: async () => {
        throw new Error('--here のときは対話プロンプトが呼ばれてはいけない');
      }
    });

    assert.equal(claudeCall?.cwd, cwd);
    assert.deepEqual(claudeCall.args, []);
    assert.ok(!lines.some((line) => line.startsWith('作業場')), '実出力: ' + JSON.stringify(lines));
  });
});

test('creator-root モジュール未解決（npm 配布で vendor 未同梱等）のときは現行動作へフォールバックする', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const rootDir = join(scratch, 'AkariVideo');
    await createCreatorRoot(rootDir); // 実在する作業場を用意しておく（本来なら (b) に該当する）

    const assets = { ...resolveRepoAssets(repoRoot), creatorRootModulePath: null };

    const { log, lines } = collectLogs();
    let claudeCall = null;

    await run([], {
      projectRoot: rootDir,
      log,
      env,
      assets,
      runDoctor: () => ({ status: 0 }),
      resolveClaude: () => '/fake/bin/claude',
      spawnClaude: (claudePath, args, spawnCwd) => {
        claudeCall = { claudePath, args, cwd: spawnCwd };
        return { status: 0 };
      },
      refreshUpdate: () => {},
      ...soundsIsolation,
      isTTY: false
    });

    // creator-root が読めないので、作業場が実在してもリダイレクトされず現行動作のまま。
    assert.equal(claudeCall?.cwd, rootDir);
    assert.ok(!lines.some((line) => line.startsWith('作業場')), '実出力: ' + JSON.stringify(lines));
  });
});
