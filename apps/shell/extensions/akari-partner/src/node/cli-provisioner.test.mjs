import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    buildCliPathEnv,
    buildShimScript,
    cliShimFilePath,
    compareVersionTriplets,
    ensureCli,
    findRepoAkariLauncherMjs,
    isElectronExecutable,
    parseRegistryVersionMetadata,
    resolveCliRoot,
    resolveCliShimDir,
    resolveShellVersion,
    resolveTarBinary,
    selectVersionDirsToDelete,
    verifyTarballIntegrity
} from '../../lib/node/cli-provisioner.js';

// task/2026-08-17-shell-managed-cli: `akari` CLI のアプリ管理配備 (cli-provisioner.ts) のテスト。
// ネットワーク・tar は fetchImpl/spawnTar の注入で置き換え、配備先は一時ディレクトリへ注入する
// （実 ~/.akari には一切書き込まない）。

async function tempDir(prefix) {
    return mkdtemp(path.join(tmpdir(), prefix));
}

const PACKAGED_EXEC_PATH = '/Applications/AKARI Video.app/Contents/MacOS/AKARI Video';

async function writeShellPackageJson(dir, version) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@akari-video/shell', version }));
}

function makeFakeFetch({ version, tarballUrl, integrity }, tarballBuffer) {
    return async url => {
        if (url.endsWith(`/${version}`)) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ dist: { tarball: tarballUrl, integrity } })
            };
        }
        if (url === tarballUrl) {
            return {
                ok: true,
                status: 200,
                arrayBuffer: async () => tarballBuffer.buffer.slice(
                    tarballBuffer.byteOffset,
                    tarballBuffer.byteOffset + tarballBuffer.byteLength
                )
            };
        }
        throw new Error(`unexpected fetch url in test: ${url}`);
    };
}

/** 実 tar の代わりに `package/bin/akari.mjs` を destDir へ直接書く偽 spawnTar。 */
function makeFakeSpawnTar(mjsContent) {
    return (_command, args) => {
        const destDir = args[args.indexOf('-C') + 1];
        const binDir = path.join(destDir, 'package', 'bin');
        mkdirSync(binDir, { recursive: true });
        writeFileSync(path.join(binDir, 'akari.mjs'), mjsContent);
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from(''), error: undefined };
    };
}

// --- packument 解析・integrity 検証 ---------------------------------------------

test('parseRegistryVersionMetadata: dist.tarball / dist.integrity を抽出する', () => {
    const metadata = parseRegistryVersionMetadata({
        dist: { tarball: 'https://registry.npmjs.org/akari-video/-/akari-video-0.1.11.tgz', integrity: 'sha512-abc==' }
    });
    assert.deepEqual(metadata, {
        tarballUrl: 'https://registry.npmjs.org/akari-video/-/akari-video-0.1.11.tgz',
        integrity: 'sha512-abc=='
    });
});

test('parseRegistryVersionMetadata: dist が無い/欠けた応答は undefined', () => {
    assert.equal(parseRegistryVersionMetadata(null), undefined);
    assert.equal(parseRegistryVersionMetadata({}), undefined);
    assert.equal(parseRegistryVersionMetadata({ dist: { tarball: 'x' } }), undefined);
    assert.equal(parseRegistryVersionMetadata({ dist: { integrity: 'sha512-x' } }), undefined);
});

test('verifyTarballIntegrity: 一致する sha512 で true', () => {
    const buf = Buffer.from('hello world');
    const digest = createHash('sha512').update(buf).digest('base64');
    assert.equal(verifyTarballIntegrity(buf, `sha512-${digest}`), true);
});

test('verifyTarballIntegrity: 不一致は false', () => {
    const buf = Buffer.from('hello world');
    assert.equal(verifyTarballIntegrity(buf, 'sha512-thisIsNotTheRealHash=='), false);
});

test('resolveTarBinary: darwin/linux は /usr/bin/tar絶対パス', () => {
    assert.equal(resolveTarBinary('darwin'), '/usr/bin/tar');
    assert.equal(resolveTarBinary('linux'), '/usr/bin/tar');
});

test('resolveTarBinary: win32 は SystemRoot 配下の System32\\tar.exe を指す', () => {
    // ホストの `path` モジュール（この test はいつも POSIX ホストで走る）で join するため、
    // 区切り文字はホスト依存 — ここではセグメントの中身だけを検証する（実 Windows では
    // 同じ import が Windows 版 path を使うため区切りは正しく `\` になる）。
    const result = resolveTarBinary('win32', { SystemRoot: 'C:\\Windows' });
    assert.match(result, /^C:\\Windows[\\/]System32[\\/]tar\.exe$/);
});

test('resolveTarBinary: win32 で SystemRoot 未設定なら C:\\Windows を既定とする', () => {
    const result = resolveTarBinary('win32', {});
    assert.match(result, /^C:\\Windows[\\/]System32[\\/]tar\.exe$/);
});

// --- シム内容生成（darwin/win32 x dev/packaged の 4 象限） -----------------------

test('buildShimScript: darwin packaged はベイクした Electron 実行体を経由するフォールバックを含む', () => {
    const targetMjsPath = '/Users/x/.akari/cli/0.1.11/package/bin/akari.mjs';
    const script = buildShimScript({ platform: 'darwin', targetMjsPath, bakedNodeExecPath: PACKAGED_EXEC_PATH });
    assert.ok(script.startsWith('#!/bin/sh'));
    assert.ok(script.includes('AKARI_NODE_BIN'));
    assert.ok(script.includes(`ELECTRON_RUN_AS_NODE=1 exec "${PACKAGED_EXEC_PATH}" "${targetMjsPath}" "$@"`));
    assert.ok(script.includes(`exec node "${targetMjsPath}" "$@"`));
});

test('buildShimScript: darwin dev は bakedNodeExecPath 無しで PATH の node へフォールバック', () => {
    const targetMjsPath = '/repo/packages/akari-launcher/bin/akari.mjs';
    const script = buildShimScript({ platform: 'darwin', targetMjsPath });
    assert.ok(!script.includes('ELECTRON_RUN_AS_NODE'));
    assert.ok(script.includes(`exec node "${targetMjsPath}" "$@"`));
});

test('buildShimScript: win32 packaged は .cmd 形式で ELECTRON_RUN_AS_NODE を設定する', () => {
    const targetMjsPath = 'C:\\Users\\x\\.akari\\cli\\0.1.11\\package\\bin\\akari.mjs';
    const bakedNodeExecPath = 'C:\\Program Files\\AKARI Video\\AKARI Video.exe';
    const script = buildShimScript({ platform: 'win32', targetMjsPath, bakedNodeExecPath });
    assert.ok(script.startsWith('@echo off'));
    assert.ok(script.includes('set ELECTRON_RUN_AS_NODE=1'));
    assert.ok(script.includes(`"${bakedNodeExecPath}" "${targetMjsPath}" %*`));
});

test('buildShimScript: win32 dev は bakedNodeExecPath 無しで PATH の node を呼ぶ', () => {
    const targetMjsPath = 'C:\\repo\\packages\\akari-launcher\\bin\\akari.mjs';
    const script = buildShimScript({ platform: 'win32', targetMjsPath });
    assert.ok(!script.includes('ELECTRON_RUN_AS_NODE'));
    assert.ok(script.includes(`node "${targetMjsPath}" %*`));
});

// --- 旧版掃除（直近 1 世代だけ残す） ---------------------------------------------

test('selectVersionDirsToDelete: 現行版以外は直近 1 世代だけ残して削除対象にする', () => {
    const toDelete = selectVersionDirsToDelete(['0.1.9', '0.1.10', '0.1.11', 'bin', '.download-tmp'], '0.1.11');
    assert.deepEqual(toDelete, ['0.1.9']);
});

test('selectVersionDirsToDelete: 旧版が無ければ削除対象は空', () => {
    assert.deepEqual(selectVersionDirsToDelete(['0.1.11', 'bin'], '0.1.11'), []);
});

test('compareVersionTriplets: セマンティックに比較する（辞書順ではない）', () => {
    assert.ok(compareVersionTriplets('0.1.9', '0.1.10') < 0);
    assert.ok(compareVersionTriplets('0.2.0', '0.1.99') > 0);
    assert.equal(compareVersionTriplets('0.1.11', '0.1.11'), 0);
});

// --- prepareLaunch の PATH 合成 -------------------------------------------------

test('buildCliPathEnv: シムが存在すれば PATH の先頭に前置する', async () => {
    const home = await tempDir('akari-cli-path-ready-');
    const shimDir = resolveCliShimDir(home);
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(cliShimFilePath(shimDir, 'darwin'), '#!/bin/sh\n');
    const env = buildCliPathEnv({ akariHome: home, platform: 'darwin', existingPath: '/usr/bin:/bin' });
    assert.equal(env.PATH, `${shimDir}:/usr/bin:/bin`);
});

test('buildCliPathEnv: シム未配備なら PATH を一切変更しない', async () => {
    const home = await tempDir('akari-cli-path-missing-');
    const env = buildCliPathEnv({ akariHome: home, platform: 'darwin', existingPath: '/usr/bin:/bin' });
    assert.deepEqual(env, {});
});

// --- Electron 実行体判定 ---------------------------------------------------------

test('isElectronExecutable: electron を含む実行体パスまたは Electron ランタイムを packaged とみなす', () => {
    assert.equal(isElectronExecutable(PACKAGED_EXEC_PATH, false), true);
    assert.equal(isElectronExecutable('/usr/local/bin/node', true), true);
    assert.equal(isElectronExecutable('/usr/local/bin/node', false), false);
});

// --- シェル自身の版の解決 ---------------------------------------------------------

test('resolveShellVersion: 上方探索で @akari-video/shell の package.json を見つける', async () => {
    const root = await tempDir('akari-shell-version-');
    const nested = path.join(root, 'apps', 'shell', 'src', 'node');
    await mkdir(nested, { recursive: true });
    await writeShellPackageJson(path.join(root, 'apps', 'shell'), '0.1.11');
    assert.equal(await resolveShellVersion({ startDirs: [nested] }), '0.1.11');
});

test('resolveShellVersion: 名前が一致しない package.json はスキップして探索を続ける', async () => {
    const root = await tempDir('akari-shell-version-skip-');
    const nested = path.join(root, 'apps', 'shell', 'src', 'node');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, 'apps', 'shell', 'src', 'package.json'), JSON.stringify({ name: 'some-other-package', version: '9.9.9' }));
    await writeShellPackageJson(path.join(root, 'apps', 'shell'), '0.1.11');
    assert.equal(await resolveShellVersion({ startDirs: [nested] }), '0.1.11');
});

test('resolveShellVersion: 見つからなければ undefined', async () => {
    const root = await tempDir('akari-shell-version-none-');
    assert.equal(await resolveShellVersion({ startDirs: [root] }), undefined);
});

// --- dev 実行時のリポ探索 ---------------------------------------------------------

test('findRepoAkariLauncherMjs: リポ上方探索で packages/akari-launcher/bin/akari.mjs を見つける', async () => {
    const root = await tempDir('akari-repo-search-');
    const nested = path.join(root, 'apps', 'shell', 'extensions', 'akari-partner', 'src', 'node');
    await mkdir(nested, { recursive: true });
    const mjsDir = path.join(root, 'packages', 'akari-launcher', 'bin');
    await mkdir(mjsDir, { recursive: true });
    await writeFile(path.join(mjsDir, 'akari.mjs'), '#!/usr/bin/env node\n');
    assert.equal(await findRepoAkariLauncherMjs([nested]), path.join(mjsDir, 'akari.mjs'));
});

test('findRepoAkariLauncherMjs: 見つからなければ undefined', async () => {
    const root = await tempDir('akari-repo-search-none-');
    assert.equal(await findRepoAkariLauncherMjs([root]), undefined);
});

// --- ensureCli 統合（fetch/tar を差し替えた fail-soft 経路の一気通貫確認） -------

test('ensureCli: dev 実行はダウンロードせずリポの akari.mjs を直接シムへ焼き込む', async () => {
    const home = await tempDir('akari-ensure-dev-home-');
    const repoRoot = await tempDir('akari-ensure-dev-repo-');
    const nested = path.join(repoRoot, 'apps', 'shell', 'extensions', 'akari-partner', 'src', 'node');
    await mkdir(nested, { recursive: true });
    const mjsDir = path.join(repoRoot, 'packages', 'akari-launcher', 'bin');
    await mkdir(mjsDir, { recursive: true });
    await writeFile(path.join(mjsDir, 'akari.mjs'), '#!/usr/bin/env node\n');

    const result = await ensureCli({
        akariHome: home,
        execPath: '/usr/local/bin/node',
        hasElectronRuntime: false,
        platform: 'darwin',
        repoSearchStartDirs: [nested]
    });

    assert.equal(result.status, 'ready');
    assert.equal(result.version, undefined);
    const shimPath = cliShimFilePath(resolveCliShimDir(home), 'darwin');
    assert.ok(existsSync(shimPath));
    const shimContent = await readFile(shimPath, 'utf8');
    assert.ok(shimContent.includes(path.join(mjsDir, 'akari.mjs')));
    assert.ok(!shimContent.includes('ELECTRON_RUN_AS_NODE'));
});

test('ensureCli: dev 実行でリポの akari.mjs が見つからなければ skipped（シムは作らない）', async () => {
    const home = await tempDir('akari-ensure-dev-missing-home-');
    const emptyRepo = await tempDir('akari-ensure-dev-missing-repo-');
    const result = await ensureCli({
        akariHome: home,
        execPath: '/usr/local/bin/node',
        hasElectronRuntime: false,
        platform: 'darwin',
        repoSearchStartDirs: [emptyRepo]
    });
    assert.equal(result.status, 'skipped');
    assert.ok(!existsSync(cliShimFilePath(resolveCliShimDir(home), 'darwin')));
});

test('ensureCli: packaged 実行は registry から取得し integrity 検証の上で配備・シム生成する', async () => {
    const home = await tempDir('akari-ensure-pkg-home-');
    const shellRoot = await tempDir('akari-ensure-pkg-shell-');
    await writeShellPackageJson(shellRoot, '0.1.11');

    const tarballBuffer = Buffer.from('fake tarball bytes');
    const integrity = `sha512-${createHash('sha512').update(tarballBuffer).digest('base64')}`;

    const result = await ensureCli({
        akariHome: home,
        execPath: PACKAGED_EXEC_PATH,
        hasElectronRuntime: true,
        platform: 'darwin',
        shellPackageJsonStartDirs: [shellRoot],
        fetchImpl: makeFakeFetch(
            { version: '0.1.11', tarballUrl: 'https://registry.npmjs.org/akari-video/-/akari-video-0.1.11.tgz', integrity },
            tarballBuffer
        ),
        spawnTar: makeFakeSpawnTar('#!/usr/bin/env node\n// fake akari.mjs')
    });

    assert.equal(result.status, 'ready');
    assert.equal(result.version, '0.1.11');
    const versionMjs = path.join(resolveCliRoot(home), '0.1.11', 'package', 'bin', 'akari.mjs');
    assert.ok(existsSync(versionMjs));
    const shimContent = await readFile(cliShimFilePath(resolveCliShimDir(home), 'darwin'), 'utf8');
    assert.ok(shimContent.includes(versionMjs));
    assert.ok(shimContent.includes('ELECTRON_RUN_AS_NODE=1'));
    assert.ok(shimContent.includes(PACKAGED_EXEC_PATH));
});

test('ensureCli: 配備済みの版は再取得せず ready を返す（冪等・fetch は呼ばれない）', async () => {
    const home = await tempDir('akari-ensure-idem-home-');
    const shellRoot = await tempDir('akari-ensure-idem-shell-');
    await writeShellPackageJson(shellRoot, '0.1.11');
    const versionMjsDir = path.join(resolveCliRoot(home), '0.1.11', 'package', 'bin');
    mkdirSync(versionMjsDir, { recursive: true });
    writeFileSync(path.join(versionMjsDir, 'akari.mjs'), '// already deployed');

    const result = await ensureCli({
        akariHome: home,
        execPath: PACKAGED_EXEC_PATH,
        hasElectronRuntime: true,
        platform: 'darwin',
        shellPackageJsonStartDirs: [shellRoot],
        fetchImpl: async () => {
            throw new Error('fetch should not be called when the target version is already deployed');
        }
    });

    assert.equal(result.status, 'ready');
    assert.equal(result.version, '0.1.11');
});

test('ensureCli: 版が変わったら新版を配備しシムを差し替え、旧版は直近 1 世代だけ残す', async () => {
    const home = await tempDir('akari-ensure-upgrade-home-');
    for (const oldVersion of ['0.1.9', '0.1.10']) {
        const dir = path.join(resolveCliRoot(home), oldVersion, 'package', 'bin');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'akari.mjs'), `// ${oldVersion}`);
    }
    const shellRoot = await tempDir('akari-ensure-upgrade-shell-');
    await writeShellPackageJson(shellRoot, '0.1.11');

    const tarballBuffer = Buffer.from('fake tarball bytes v0.1.11');
    const integrity = `sha512-${createHash('sha512').update(tarballBuffer).digest('base64')}`;

    const result = await ensureCli({
        akariHome: home,
        execPath: PACKAGED_EXEC_PATH,
        hasElectronRuntime: true,
        platform: 'darwin',
        shellPackageJsonStartDirs: [shellRoot],
        fetchImpl: makeFakeFetch(
            { version: '0.1.11', tarballUrl: 'https://registry.npmjs.org/akari-video/-/akari-video-0.1.11.tgz', integrity },
            tarballBuffer
        ),
        spawnTar: makeFakeSpawnTar('// 0.1.11')
    });

    assert.equal(result.status, 'ready');
    const remaining = readdirSync(resolveCliRoot(home))
        .filter(name => name !== 'bin' && !name.startsWith('.'))
        .sort();
    // 新版 (0.1.11) + 直近旧版 1 世代 (0.1.10) だけ残る。もっと古い 0.1.9 は掃除済み。
    assert.deepEqual(remaining, ['0.1.10', '0.1.11']);
});

test('ensureCli: tarball の integrity 不一致は failed を返しファイルを残さない', async () => {
    const home = await tempDir('akari-ensure-integrity-home-');
    const shellRoot = await tempDir('akari-ensure-integrity-shell-');
    await writeShellPackageJson(shellRoot, '0.1.11');

    const tarballBuffer = Buffer.from('fake tarball bytes');
    const result = await ensureCli({
        akariHome: home,
        execPath: PACKAGED_EXEC_PATH,
        hasElectronRuntime: true,
        platform: 'darwin',
        shellPackageJsonStartDirs: [shellRoot],
        fetchImpl: makeFakeFetch(
            {
                version: '0.1.11',
                tarballUrl: 'https://registry.npmjs.org/akari-video/-/akari-video-0.1.11.tgz',
                integrity: 'sha512-thisDoesNotMatchTheTarball=='
            },
            tarballBuffer
        ),
        spawnTar: makeFakeSpawnTar('// should never be reached')
    });

    assert.equal(result.status, 'failed');
    assert.ok(result.log.some(line => line.includes('integrity')));
    assert.ok(!existsSync(path.join(resolveCliRoot(home), '0.1.11')));
    assert.ok(!existsSync(cliShimFilePath(resolveCliShimDir(home), 'darwin')));
});

test('ensureCli: registry 404（未公開版）は例外を投げず fail-soft を返す', async () => {
    const home = await tempDir('akari-ensure-404-home-');
    const shellRoot = await tempDir('akari-ensure-404-shell-');
    await writeShellPackageJson(shellRoot, '9.9.9-dev');

    const result = await ensureCli({
        akariHome: home,
        execPath: PACKAGED_EXEC_PATH,
        hasElectronRuntime: true,
        platform: 'darwin',
        shellPackageJsonStartDirs: [shellRoot],
        fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) })
    });

    assert.ok(result.status === 'failed' || result.status === 'skipped');
    assert.equal(result.version, '9.9.9-dev');
    assert.ok(result.log.some(line => line.includes('404')));
});

test('ensureCli: ネットワーク不通は例外を投げず fail-soft を返す（接続フローを止めない）', async () => {
    const home = await tempDir('akari-ensure-network-home-');
    const shellRoot = await tempDir('akari-ensure-network-shell-');
    await writeShellPackageJson(shellRoot, '0.1.11');

    const result = await ensureCli({
        akariHome: home,
        execPath: PACKAGED_EXEC_PATH,
        hasElectronRuntime: true,
        platform: 'darwin',
        shellPackageJsonStartDirs: [shellRoot],
        fetchImpl: async () => {
            throw new Error('ENOTFOUND registry.npmjs.org');
        }
    });

    assert.ok(result.status === 'failed' || result.status === 'skipped');
    assert.ok(result.log.some(line => line.includes('ENOTFOUND')));
});

// --- ensureCli → buildCliPathEnv: 接続フロー全体の PATH 合成確認 -----------------

test('ensureCli → buildCliPathEnv: ready 配備後は PATH がシム dir で始まる', async () => {
    const home = await tempDir('akari-ensure-path-ready-home-');
    const repoRoot = await tempDir('akari-ensure-path-ready-repo-');
    const nested = path.join(repoRoot, 'apps', 'shell', 'extensions', 'akari-partner', 'src', 'node');
    await mkdir(nested, { recursive: true });
    const mjsDir = path.join(repoRoot, 'packages', 'akari-launcher', 'bin');
    await mkdir(mjsDir, { recursive: true });
    await writeFile(path.join(mjsDir, 'akari.mjs'), '#!/usr/bin/env node\n');

    const ensured = await ensureCli({
        akariHome: home,
        execPath: '/usr/local/bin/node',
        hasElectronRuntime: false,
        platform: 'darwin',
        repoSearchStartDirs: [nested]
    });
    assert.equal(ensured.status, 'ready');

    const env = buildCliPathEnv({ akariHome: home, platform: 'darwin', existingPath: '/usr/bin:/bin' });
    assert.ok(env.PATH.startsWith(`${resolveCliShimDir(home)}:`));
});

test('ensureCli → buildCliPathEnv: failed 時は PATH を一切変更しない', async () => {
    const home = await tempDir('akari-ensure-path-failed-home-');
    const shellRoot = await tempDir('akari-ensure-path-failed-shell-');
    await writeShellPackageJson(shellRoot, '0.1.11');

    const ensured = await ensureCli({
        akariHome: home,
        execPath: PACKAGED_EXEC_PATH,
        hasElectronRuntime: true,
        platform: 'darwin',
        shellPackageJsonStartDirs: [shellRoot],
        fetchImpl: async () => {
            throw new Error('ENOTFOUND');
        }
    });
    assert.equal(ensured.status, 'failed');

    const env = buildCliPathEnv({ akariHome: home, platform: 'darwin', existingPath: '/usr/bin:/bin' });
    assert.deepEqual(env, {});
});
