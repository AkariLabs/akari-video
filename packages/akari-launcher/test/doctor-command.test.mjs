import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { runUpdateCommand } from '../src/cli.mjs';
import { runDoctorCommand } from '../src/doctor-command.mjs';
import {
  determineDoctorVerdict,
  doctorExitCode,
  resolveAppBundle,
  resolveDoctorReport,
  resolveRuntimePaths,
} from '../src/runtime-diagnostics.mjs';
import { runStatusCommand } from '../src/status-command.mjs';

async function withFixture(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-doctor-test-'));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function put(file, contents = '#!/usr/bin/env node\n') {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents, { mode: 0o755 });
}

test('render-cut 解決順は monorepo → managed-app → app-bundle → none', async () => {
  await withFixture(async (root) => {
    const launcherDirectory = join(root, 'checkout', 'packages', 'akari-launcher', 'src');
    const monorepo = join(root, 'checkout', 'packages', 'render-cut', 'bin', 'render-cut.mjs');
    const managedRoot = join(root, 'home', 'app');
    const managed = join(managedRoot, 'packages', 'render-cut', 'bin', 'render-cut.mjs');
    const bundleRoot = join(root, 'bundle', 'resources');
    const bundled = join(bundleRoot, 'packages', 'render-cut', 'bin', 'render-cut.mjs');
    await mkdir(launcherDirectory, { recursive: true });
    await put(monorepo);
    await put(managed);
    await put(bundled);

    const options = {
      env: { AKARI_HOME: join(root, 'home') },
      launcherDirectory,
      installInfo: { status: 'valid', version: '1.0.0', path: join(managedRoot, '.akari-install-ref') },
      appBundle: { found: true, path: bundleRoot, version: '1.0.0' },
    };
    assert.deepEqual(resolveRuntimePaths(options).render_cut, { path: monorepo, origin: 'monorepo' });
    await rm(monorepo);
    assert.deepEqual(resolveRuntimePaths(options).render_cut, { path: managed, origin: 'managed-app' });
    await rm(managed);
    assert.deepEqual(resolveRuntimePaths(options).render_cut, { path: bundled, origin: 'app-bundle' });
    await rm(bundled);
    assert.deepEqual(resolveRuntimePaths(options).render_cut, { path: null, origin: 'none' });
  });
});

test('app bundle は AKARI_APP_RESOURCES と launcher manifest から版を読む', async () => {
  await withFixture(async (root) => {
    const resources = join(root, 'desktop', 'resources');
    await put(
      join(resources, 'packages', 'akari-launcher', 'package.json'),
      JSON.stringify({ version: '2.3.4' }),
    );
    assert.deepEqual(resolveAppBundle({
      env: { AKARI_APP_RESOURCES: resources },
      defaultAppResources: [],
    }), { found: true, path: resources, version: '2.3.4' });
  });
});

test('media-bin と puppeteer が import 不能でも PATH / cache 探索へ安全に縮退する', async () => {
  await withFixture(async (root) => {
    const binDirectory = join(root, 'bin');
    const launcherDirectory = join(root, 'checkout', 'packages', 'akari-launcher', 'src');
    await put(join(binDirectory, 'ffmpeg'));
    await put(join(binDirectory, 'ffprobe'));
    await put(join(root, 'checkout', 'packages', 'render-cut', 'bin', 'render-cut.mjs'));
    await put(join(root, 'checkout', 'packages', 'edit-lint', 'bin', 'edit-lint.mjs'));
    await mkdir(launcherDirectory, { recursive: true });
    const report = await resolveDoctorReport({
      env: { AKARI_HOME: join(root, 'home'), PATH: binDirectory },
      launcherDirectory,
      defaultAppResources: [],
      chromeCacheDir: join(root, 'chrome-cache'),
      loadMediaBin: async () => { throw new Error('fixture unavailable'); },
      loadBrowsers: async () => { throw new Error('fixture unavailable'); },
      entryPath: 'akari.mjs',
    });
    assert.deepEqual(report.ffmpeg, { path: join(binDirectory, 'ffmpeg'), origin: 'path' });
    assert.deepEqual(report.ffprobe, { path: join(binDirectory, 'ffprobe'), origin: 'path' });
    assert.equal(report.chrome.found, false);
    assert.equal(report.verdict, 'ok');
  });
});

test('verdict と exit code は ok/degraded=0、broken=1', async () => {
  const base = {
    app_managed: { status: 'valid' },
    render_cut: { origin: 'monorepo' },
    edit_lint: { origin: 'monorepo' },
    ffmpeg: { origin: 'path' },
    ffprobe: { origin: 'path' },
    path: { on_path: true },
  };
  const ok = determineDoctorVerdict(base);
  const degraded = determineDoctorVerdict({ ...base, edit_lint: { origin: 'none' } });
  const broken = determineDoctorVerdict({ ...base, ffmpeg: { origin: 'none' } });
  assert.deepEqual([ok, degraded, broken], ['ok', 'degraded', 'broken']);
  assert.deepEqual([doctorExitCode(ok), doctorExitCode(degraded), doctorExitCode(broken)], [0, 0, 1]);

  for (const [verdict, exitCode] of [['ok', 0], ['degraded', 0], ['broken', 1]]) {
    const output = [];
    const result = await runDoctorCommand(['--json'], {
      log: (line) => output.push(line),
      report: { ...base, cli: {}, app_bundle: {}, chrome: {}, verdict, next_steps: [] },
    });
    assert.equal(result.exitCode, exitCode);
    assert.equal(output.length, 1);
    assert.equal(JSON.parse(output[0]).verdict, verdict);
  }
});

test('update --force は managed app 不在時に install.sh を案内し、npm 不在なら cli.tgz を出さない', async () => {
  await withFixture(async (root) => {
    const lines = [];
    let applied = false;
    const feed = updateFeed('1.1.0');
    const result = await runUpdateCommand(['--force'], {
      env: { AKARI_HOME: join(root, 'home'), PATH: '' },
      log: (line) => lines.push(line),
      refreshUpdateFeed: async () => ({ feed }),
      runtimeDiagnostics: runtimeFixture('app-bundle'),
      isRunningFromAppDir: () => false,
      applySelfUpdate: () => {
        applied = true;
        return { exitCode: 0 };
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(applied, false);
    assert.match(lines.join('\n'), /この CLI からは install\.sh 経路の本体を入れ直せません/u);
    assert.match(lines.join('\n'), /raw\.githubusercontent\.com\/AkariLabs\/akari-video\/main\/install\.sh/u);
    assert.doesNotMatch(lines.join('\n'), /cli\.tgz/u);
  });
});

test('update --force は render-cut も managed app も不在なら install.sh の復旧案内を出す', async () => {
  await withFixture(async (root) => {
    const lines = [];
    let applied = false;
    const result = await runUpdateCommand(['--force'], {
      env: { AKARI_HOME: join(root, 'home'), PATH: '' },
      log: (line) => lines.push(line),
      refreshUpdateFeed: async () => ({ feed: updateFeed('1.1.0') }),
      runtimeDiagnostics: runtimeFixture('none'),
      isRunningFromAppDir: () => false,
      applySelfUpdate: () => {
        applied = true;
        return { exitCode: 0 };
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(applied, false);
    assert.match(lines.join('\n'), /この CLI からは install\.sh 経路の本体を入れ直せません/u);
    assert.match(lines.join('\n'), /raw\.githubusercontent\.com\/AkariLabs\/akari-video\/main\/install\.sh/u);
  });
});

test('update --force の npm / monorepo 起動判定は従来の CLI 更新案内を維持する', async () => {
  await withFixture(async (root) => {
    const lines = [];
    const result = await runUpdateCommand(['--force'], {
      cliVersion: '1.0.0',
      env: { AKARI_HOME: join(root, 'home'), PATH: process.env.PATH ?? '' },
      npmAvailable: true,
      log: (line) => lines.push(line),
      refreshUpdateFeed: async () => ({ feed: updateFeed('1.1.0') }),
      runtimeDiagnostics: runtimeFixture('monorepo'),
      isRunningFromAppDir: () => false,
    });
    assert.equal(result.exitCode, 0);
    assert.match(lines.join('\n'), /npm i -g https:\/\/example\.invalid\/cli\.tgz/u);
    assert.doesNotMatch(lines.join('\n'), /この CLI からは install\.sh/u);
  });
});

test('status は install.sh 経路 missing を render-cut の実解決元付きで表示する', async () => {
  await withFixture(async (root) => {
    const lines = [];
    const result = await runStatusCommand([root], {
      env: { AKARI_HOME: join(root, 'home') },
      log: (line) => lines.push(line),
      runtimeDiagnostics: runtimeFixture('app-bundle'),
    });
    assert.ok(result.exitCode === 0 || result.exitCode === 1);
    const output = lines.join('');
    assert.match(output, /install\.sh 経路の本体は未導入/u);
    assert.match(output, /書き出しは app-bundle の render-cut を使います/u);
    assert.match(output, /詳細: `akari doctor`/u);
    assert.doesNotMatch(output, /本体バージョン: 未記録/u);
  });
});

test('status は render-cut が none のときだけ書き出し不能と復旧案内を表示する', async () => {
  await withFixture(async (root) => {
    const lines = [];
    await runStatusCommand([root], {
      env: { AKARI_HOME: join(root, 'home') },
      log: (line) => lines.push(line),
      runtimeDiagnostics: runtimeFixture('none'),
    });
    const output = lines.join('');
    assert.match(output, /書き出しできません/u);
    assert.match(output, /復旧するには/u);
  });
});

function updateFeed(version) {
  return {
    schema: 1,
    product: version,
    components: {
      app: { url: 'https://example.invalid/app.tgz', sha256: 'a'.repeat(64) },
      cli: { tarball: { url: 'https://example.invalid/cli.tgz' } },
    },
  };
}

function runtimeFixture(origin) {
  return {
    app_managed: { status: 'missing', version: null, path: 'managed-app' },
    app_bundle: { found: origin === 'app-bundle', path: origin === 'app-bundle' ? 'resources' : null, version: '1.0.0' },
    render_cut: { path: origin === 'none' ? null : 'render-cut.mjs', origin },
    edit_lint: { path: 'edit-lint.mjs', origin: origin === 'none' ? 'none' : origin },
  };
}
