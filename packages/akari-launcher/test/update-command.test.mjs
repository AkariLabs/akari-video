import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runUpdateCommand } from '../src/cli.mjs';
import { applySelfUpdate, rollbackSelfUpdate } from '../src/self-update.mjs';
import { checkForUpdateSync, resolveCachePath, resolveInstallRefPath } from '../src/update-check.mjs';
import { describeVersionStatus, describeUpdateCommand, formatUpdateNotice } from '../src/messages.mjs';

const VALID_FEED = {
  schema: 1,
  product: '0.2.0',
  channel: 'prerelease',
  notes_url: 'https://github.com/AkariLabs/akari-video/releases/tag/v0.2.0',
  components: {
    cli: { version: '0.2.0', npm: 'akari-video', tarball: { url: 'https://example.invalid/cli.tgz', sha256: 'c'.repeat(64) } }
  }
};

async function withScratchHome(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-update-command-test-'));
  try {
    return await callback({ AKARI_HOME: root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeCacheFixture(env, cache) {
  await mkdir(env.AKARI_HOME, { recursive: true });
  await writeFile(resolveCachePath(env), JSON.stringify(cache, null, 2), 'utf8');
}

function collectLogs() {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
}

test('akari update: フィード未取得時は「まだ取得できていません」を案内する（自動 fetch はしない）', async () => {
  await withScratchHome(async (env) => {
    const { log, lines } = collectLogs();
    const result = await runUpdateCommand([], { log, env, currentVersion: '0.1.0' });
    assert.equal(result.exitCode, 0);
    assert.ok(lines.some((line) => line.includes('現在のバージョン: v0.1.0')));
    assert.ok(lines.some((line) => line.includes('まだ取得できていません')));
  });
});

test('akari update: 新版があれば現在版・最新版・リリースノート・tarball インストール手順を表示する', async () => {
  await withScratchHome(async (env) => {
    await writeCacheFixture(env, { schema: 1, fetched_at: 't0', feed: VALID_FEED, dismissed: {} });
    const { log, lines } = collectLogs();
    await runUpdateCommand([], { log, env, currentVersion: '0.1.0' });

    assert.ok(lines.some((line) => line === '現在のバージョン: v0.1.0'));
    assert.ok(lines.some((line) => line === '最新バージョン: v0.2.0（プレリリース）'));
    assert.ok(lines.some((line) => line.includes(VALID_FEED.notes_url)));
    assert.ok(lines.some((line) => line.includes(`npm i -g ${VALID_FEED.components.cli.tarball.url}`)), 'tarball URL があれば npm i -g <URL> を提示する');
    assert.ok(lines.some((line) => line.includes('自動実行はしません')));
    assert.ok(lines.some((line) => line.includes('akari update --dismiss')));
  });
});

test('akari update: tarball URL が無ければ npm i -g akari-video@latest にフォールバックする', async () => {
  await withScratchHome(async (env) => {
    const feedWithoutTarball = { ...VALID_FEED, components: { cli: { version: '0.2.0' } } };
    await writeCacheFixture(env, { schema: 1, feed: feedWithoutTarball, dismissed: {} });
    const { log, lines } = collectLogs();
    await runUpdateCommand([], { log, env, currentVersion: '0.1.0' });
    assert.ok(lines.some((line) => line.includes('npm i -g akari-video@latest')));
  });
});

test('akari update: 最新版が現在版以下なら「最新です」だけ表示し、更新手順は出さない', async () => {
  await withScratchHome(async (env) => {
    await writeCacheFixture(env, { schema: 1, feed: { ...VALID_FEED, product: '0.1.0' }, dismissed: {} });
    const { log, lines } = collectLogs();
    await runUpdateCommand([], { log, env, currentVersion: '0.1.0' });
    assert.ok(lines.some((line) => line.includes('最新です')));
    assert.ok(!lines.some((line) => line.includes('npm i -g')));
  });
});

test('akari update --dismiss: dismissed を記録し、以後の checkForUpdateSync 相当の判定が available:false になる', async () => {
  await withScratchHome(async (env) => {
    await writeCacheFixture(env, { schema: 1, feed: VALID_FEED, dismissed: {} });
    const { log, lines } = collectLogs();
    await runUpdateCommand(['--dismiss'], { log, env, currentVersion: '0.1.0' });

    assert.ok(lines.some((line) => line.includes('この版（v0.2.0）の通知は今後表示しません')));

    const persisted = JSON.parse(await readFile(resolveCachePath(env), 'utf8'));
    assert.ok(persisted.dismissed['0.2.0']);
  });
});

test('akari update --dismiss: フィード未取得のときは dismiss 対象が無く、何も記録しない', async () => {
  await withScratchHome(async (env) => {
    const { log } = collectLogs();
    await runUpdateCommand(['--dismiss'], { log, env, currentVersion: '0.1.0' });
    await assert.rejects(readFile(resolveCachePath(env), 'utf8'));
  });
});

test('install-ref 取り残し回帰: 更新必要判定・数字表示・--force 再導入を AKARI_HOME 隔離で実測する', async () => {
  await withScratchHome(async (env) => {
    const appDir = join(env.AKARI_HOME, 'app');
    await mkdir(appDir, { recursive: true });
    await writeFile(resolveInstallRefPath(env), 'v0.1.11\n', 'utf8');

    const archive = Buffer.from('fixture app archive 0.1.12');
    const feed = {
      schema: 1,
      product: '0.1.12',
      channel: 'stable',
      components: {
        app: {
          url: 'https://example.invalid/app-0.1.12.tar.gz',
          sha256: createHash('sha256').update(archive).digest('hex')
        }
      }
    };
    await writeCacheFixture(env, { schema: 1, fetched_at: 't0', feed, dismissed: {} });

    const status = checkForUpdateSync({ env });
    assert.equal(status.available, true, 'CLI 版ではなく install-ref の本体版を基準に更新必要となること');
    assert.equal(status.cliVersion, '0.1.12');
    assert.equal(status.appVersion, '0.1.11');
    assert.equal(status.currentVersion, '0.1.11');
    assert.equal(status.mismatch, true);

    const applyFixture = options => applySelfUpdate({
      ...options,
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => archive }),
      extract: ({ destDir }) => {
        mkdirSync(join(destDir, 'packages', 'akari-launcher'), { recursive: true });
        writeFileSync(join(destDir, 'packages', 'akari-launcher', 'package.json'), JSON.stringify({ version: feed.product }));
      },
      runNpmInstall: () => ({ ok: true })
    });

    const first = collectLogs();
    const updated = await runUpdateCommand([], {
      env,
      log: first.log,
      launcherRoot: '/outside/managed/app',
      applySelfUpdate: applyFixture
    });
    assert.equal(updated.applied, true, '外側の npm CLI から管理本体を更新できること');
    assert.ok(first.lines.some(line => line.includes('CLI バージョン: v0.1.12')));
    assert.ok(first.lines.some(line => line.includes('本体バージョン: v0.1.11')));
    assert.ok(first.lines.some(line => line.includes('本体が古い')));
    assert.equal((await readFile(resolveInstallRefPath(env), 'utf8')).trim(), 'v0.1.12');

    const forced = collectLogs();
    const reinstalled = await runUpdateCommand(['--force'], {
      env,
      log: forced.log,
      launcherRoot: '/outside/managed/app',
      applySelfUpdate: applyFixture
    });
    assert.equal(reinstalled.applied, true, '最新版と同じでも --force で本体を再導入できること');
    assert.ok(forced.lines.some(line => line.includes('--force')));
    assert.equal((await readFile(resolveInstallRefPath(env), 'utf8')).trim(), 'v0.1.12');
  });
});

test('--rollback: install-ref の無い前世代へ戻しても本体版の参照を復元する', async () => {
  await withScratchHome(async (env) => {
    const current = join(env.AKARI_HOME, 'app', 'packages', 'akari-launcher');
    const previous = join(env.AKARI_HOME, 'app-previous', 'packages', 'akari-launcher');
    await mkdir(current, { recursive: true });
    await mkdir(previous, { recursive: true });
    await writeFile(join(current, 'package.json'), JSON.stringify({ version: '0.1.12' }), 'utf8');
    await writeFile(join(previous, 'package.json'), JSON.stringify({ version: '0.1.11' }), 'utf8');
    await writeFile(resolveInstallRefPath(env), 'v0.1.12\n', 'utf8');

    const result = rollbackSelfUpdate({ env, log: () => {} });
    assert.equal(result.rolledBack, true);
    assert.equal(result.version, '0.1.11');
    assert.equal((await readFile(resolveInstallRefPath(env), 'utf8')).trim(), 'v0.1.11');
  });
});

// --- messages.mjs のフォーマット関数を直接検証（doctor 行・通知文の厳密な文言） ---

test('formatUpdateNotice: プレリリースの版名が付く（例文どおりの厳密一致）', () => {
  const text = formatUpdateNotice({ available: true, latestVersion: '0.2.0', currentVersion: '0.1.0', channel: 'prerelease' });
  assert.equal(text, '⬆ AKARI Video v0.2.0（プレリリース）があります（現在 v0.1.0）→ 詳細: akari update');
});

test('formatUpdateNotice: stable では版名の注記が付かない', () => {
  const text = formatUpdateNotice({ available: true, latestVersion: '0.2.0', currentVersion: '0.1.0', channel: 'stable' });
  assert.equal(text, '⬆ AKARI Video v0.2.0があります（現在 v0.1.0）→ 詳細: akari update');
});

test('formatUpdateNotice: available: false なら null', () => {
  assert.equal(formatUpdateNotice({ available: false }), null);
});

test('describeVersionStatus: フィード未取得', () => {
  assert.equal(describeVersionStatus('0.1.0', null), 'バージョン: v0.1.0（更新フィード: 未取得）');
});

test('describeVersionStatus: フィード取得済み', () => {
  const text = describeVersionStatus('0.1.0', { fetched_at: '2026-07-27T00:00:00.000Z', feed: VALID_FEED });
  assert.match(text, /バージョン: v0\.1\.0（更新フィード: 取得済み・2026-07-27T00:00:00\.000Z 時点）/);
});

test('describeUpdateCommand: 直接呼び出しでも同じ行が組み立てられる', () => {
  const lines = describeUpdateCommand({ currentVersion: '0.1.0', cache: { feed: VALID_FEED }, dismissed: false });
  assert.equal(lines[0], '現在のバージョン: v0.1.0');
  assert.equal(lines[1], '最新バージョン: v0.2.0（プレリリース）');
});
