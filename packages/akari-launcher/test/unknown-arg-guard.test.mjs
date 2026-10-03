import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { run } from '../src/cli.mjs';

const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'akari.mjs');

async function inScratch(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-unknown-arg-'));
  try {
    const cwd = join(root, 'cwd');
    const home = join(root, 'home');
    const pathDir = join(root, 'path');
    await Promise.all([mkdir(cwd), mkdir(home), mkdir(pathDir)]);
    return await callback({ root, cwd, home, pathDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function isolatedEnv({ home, pathDir }) {
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(HOME|USERPROFILE|AKARI_HOME|PATH)$/i.test(key)));
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    AKARI_HOME: home,
    PATH: pathDir,
    AKARI_NO_AUTO_UPDATE: '1',
    AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/latest.json',
  };
}

for (const [input, suggestion] of [
  ['--help;', '--help'], ['--helpx', '--help'], ['--hepl', '--help'],
  ['-help', '--help'], ['--verison', '--version'], ['--version=1', '--version'],
  ['capure', 'capture'], ['doctr', 'doctor'], ['storybord', 'storyboard'],
  ['doctor;', 'doctor'], ['doctor ', 'doctor'], ['doctor\r', 'doctor'], ['clen', 'clean'],
]) {
  test(`入口: ${input} は ${suggestion} を案内して何も作らない`, async () => {
    await inScratch(async (scratch) => {
      const result = spawnSync(process.execPath, [bin, input], {
        cwd: scratch.cwd, env: isolatedEnv(scratch), encoding: 'utf8', timeout: 15000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /のことですか/);
      assert.ok(result.stderr.includes(suggestion), result.stderr);
      assert.match(result.stderr, /プロジェクトの作成も AI エージェントの起動もしていません/);
      assert.match(result.stderr, /akari -- /);
      assert.deepEqual(await readdir(scratch.cwd), []);
      assert.deepEqual(await readdir(scratch.home), []);
    });
  });
}

for (const args of [
  ['-p', 'hello'], ['--', 'hello'], ['--resume'], ['--model', 'sonnet'], ['この動画を編集して'], ['help'],
  ['mcp'], ['config'], ['install'], ['plugin'], ['edit'], ['exit'], ['quit'], ['info'],
  ['git'], ['in'], ['it'], ['plan'], ['work'], ['start'], ['--', 'edit'], ['--opencode'],
]) {
  test(`入口: ${args[0]} は非対話ガードまで素通しする`, async () => {
    await inScratch(async (scratch) => {
      const result = spawnSync(process.execPath, [bin, ...args], {
        cwd: scratch.cwd, env: isolatedEnv(scratch), encoding: 'utf8', timeout: 15000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
      assert.doesNotMatch(result.stderr, /のことですか/);
      assert.match(result.stderr, /--yes/);
      assert.equal(result.stdout, '');
      assert.deepEqual(await readdir(scratch.cwd), []);
      assert.deepEqual(await readdir(scratch.home), []);
    });
  });
}

test('入口: 非対話の未作成フォルダーで引数がなければ状態確認だけを表示する', async () => {
  await inScratch(async (scratch) => {
    const result = spawnSync(process.execPath, [bin], {
      cwd: scratch.cwd, env: isolatedEnv(scratch), encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /状態確認のみ/);
    assert.equal(result.stderr, '');
    assert.deepEqual(await readdir(scratch.cwd), []);
  });
});

const assets = { templateDir: 'fixture', scaffoldModulePath: 'fixture', schemasSourceDir: null, doctorScript: null };

function runOptions(cwd, overrides = {}) {
  const calls = { scaffold: 0, spawnClaude: 0 };
  const lines = [];
  const errors = [];
  const claudeArgs = [];
  const opencodeCalls = [];
  return {
    calls, lines, errors, claudeArgs, opencodeCalls,
    options: {
      projectRoot: cwd,
      assets,
      env: { HOME: cwd, USERPROFILE: cwd, AKARI_HOME: join(cwd, 'akari-home'), PATH: cwd },
      isTTY: false,
      log: line => lines.push(line),
      error: line => errors.push(line),
      loadCreatorRootModule: async () => null,
      scaffold: async () => { calls.scaffold++; return { copy: { copiedFiles: [] }, fallback: { writtenFiles: [] }, git: { action: 'none' } }; },
      resolveClaude: () => 'fake-claude',
      spawnClaude: (_path, args) => { calls.spawnClaude++; claudeArgs.push(args); return { status: 0 }; },
      spawnOpencode: (...args) => { opencodeCalls.push(args); return { status: 0 }; },
      refreshUpdate: () => {},
      showAssetIntro: async () => {},
      ...overrides,
    },
  };
}

test('run: 非対話の未作成フォルダーで引数があれば何もしない', async () => {
  await inScratch(async ({ cwd }) => {
    const { calls, lines, errors, options } = runOptions(cwd);
    const result = await run(['-p', 'hello'], options);
    assert.equal(result.exitCode, 2);
    assert.deepEqual(calls, { scaffold: 0, spawnClaude: 0 });
    assert.deepEqual(lines, []);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /まだセットアップされていません/);
    assert.match(errors.join('\n'), /--yes/);
    assert.match(errors.join('\n'), /--here/);
    assert.deepEqual(await readdir(cwd), []);
  });
});

test('run: 非対話の未作成フォルダーで --opencode だけなら何も起動しない', async () => {
  await inScratch(async ({ cwd }) => {
    const { calls, opencodeCalls, options } = runOptions(cwd);
    const result = await run(['--opencode'], options);
    assert.equal(result.exitCode, 2);
    assert.deepEqual(calls, { scaffold: 0, spawnClaude: 0 });
    assert.deepEqual(opencodeCalls, []);
    assert.deepEqual(await readdir(cwd), []);
  });
});

for (const flag of ['--yes', '--here', '-y']) {
  test(`run: 非対話でも ${flag} で作成と起動を行う`, async () => {
    await inScratch(async ({ cwd }) => {
      const { calls, options } = runOptions(cwd);
      const result = await run([flag, '-p', 'hello'], options);
      assert.equal(result.exitCode, 0);
      assert.deepEqual(calls, { scaffold: 1, spawnClaude: 1 });
    });
  });
}

test('run: 対話端末では作成と起動を行う', async () => {
  await inScratch(async ({ cwd }) => {
    const { calls, options } = runOptions(cwd, { isTTY: true });
    const result = await run(['-p', 'hello'], options);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls, { scaffold: 1, spawnClaude: 1 });
  });
});

test('run: 既存プロジェクトでは非対話でも起動する', async () => {
  await inScratch(async ({ cwd }) => {
    await mkdir(join(cwd, '.akari'));
    await writeFile(join(cwd, '.akari', 'connections.json'), '{}');
    const { calls, options } = runOptions(cwd);
    const result = await run(['-p', 'hello'], options);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls, { scaffold: 0, spawnClaude: 1 });
  });
});

for (const args of [['--', 'edit'], ['edit']]) {
  test(`run: 既存プロジェクトから ${args.join(' ')} をそのまま AI エージェントへ渡す`, async () => {
    await inScratch(async ({ cwd }) => {
      await mkdir(join(cwd, '.akari'));
      await writeFile(join(cwd, '.akari', 'connections.json'), '{}');
      const { calls, claudeArgs, options } = runOptions(cwd);
      const result = await run(args, options);
      assert.equal(result.exitCode, 0);
      assert.deepEqual(calls, { scaffold: 0, spawnClaude: 1 });
      assert.deepEqual(claudeArgs, [args]);
    });
  });
}

test('run: 非対話の未作成フォルダーで引数がなければ状態確認だけで終了する', async () => {
  await inScratch(async ({ cwd }) => {
    const { calls, lines, errors, options } = runOptions(cwd);
    const result = await run([], options);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls, { scaffold: 0, spawnClaude: 0 });
    assert.equal(lines.length, 2);
    assert.match(lines.join('\n'), /状態確認のみ/);
    assert.deepEqual(errors, []);
    assert.deepEqual(await readdir(cwd), []);
  });
});
