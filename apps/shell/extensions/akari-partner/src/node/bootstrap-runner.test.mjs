import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { bootstrapRunner } from '../../lib/node/bootstrap-runner.js';

const VERSION = '0.149.1';
const TAG = `rust-v${VERSION}`;

const PLATFORM_CASES = [
    ['darwin', 'arm64', 'aarch64-apple-darwin'],
    ['darwin', 'x64', 'x86_64-apple-darwin'],
    ['linux', 'arm64', 'aarch64-unknown-linux-musl'],
    ['linux', 'x64', 'x86_64-unknown-linux-musl'],
    ['win32', 'arm64', 'aarch64-pc-windows-msvc'],
    ['win32', 'x64', 'x86_64-pc-windows-msvc']
];

async function makeHome(prefix) {
    return mkdtemp(path.join(tmpdir(), prefix));
}

function writeTarString(header, offset, length, value) {
    Buffer.from(value).copy(header, offset, 0, Math.min(Buffer.byteLength(value), length));
}

function writeTarOctal(header, offset, length, value) {
    writeTarString(header, offset, length, value.toString(8).padStart(length - 1, '0'));
}

function tarEntry(name, content = Buffer.alloc(0), mode = 0o644, type = '0') {
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const header = Buffer.alloc(512);
    writeTarString(header, 0, 100, name);
    writeTarOctal(header, 100, 8, mode);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, body.length);
    writeTarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    writeTarString(header, 156, 1, type);
    writeTarString(header, 257, 6, 'ustar');
    writeTarString(header, 263, 2, '00');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
    const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
    return Buffer.concat([header, body, padding]);
}

function makeTar(entries) {
    return Buffer.concat([
        ...entries.map(entry => tarEntry(entry.name, entry.content, entry.mode, entry.type)),
        Buffer.alloc(1024)
    ]);
}

function bundleArchive(platform) {
    const suffix = platform === 'win32' ? '.exe' : '';
    return gzipSync(makeTar([
        { name: 'bin/', mode: 0o755, type: '5' },
        { name: `bin/codex${suffix}`, content: '#!/bin/sh\necho codex-cli 0.149.1\n', mode: 0o755 },
        { name: `bin/codex-code-mode-host${suffix}`, content: 'matching host', mode: 0o755 },
        { name: 'codex-path/', mode: 0o755, type: '5' },
        { name: 'codex-path/rg', content: '#!/bin/sh\n', mode: 0o755 },
        { name: 'codex-package.json', content: JSON.stringify({ version: VERSION }), mode: 0o644 }
    ]));
}

function hostArchive() {
    return gzipSync(makeTar([
        { name: 'codex-code-mode-host-aarch64-apple-darwin', content: 'repaired matching host', mode: 0o755 }
    ]));
}

function fixture(body, status = 200, contentType = 'application/octet-stream') {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    return { status, contentType, body: buffer.toString('base64') };
}

async function startFixtureServer(fixtures) {
    const server = createServer((request, response) => {
        const selected = fixtures[request.url] ?? fixture('', 404);
        response.statusCode = selected.status;
        response.setHeader('content-type', selected.contentType);
        const original = Buffer.from(selected.body, 'base64');
        response.end(selected.contentType === 'application/json'
            ? Buffer.from(original.toString().replaceAll('__ORIGIN__', serverOrigin))
            : original);
    });
    let serverOrigin = 'http://example.test';
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        serverOrigin = `http://127.0.0.1:${address.port}`;
        return {
            origin: serverOrigin,
            fixtures: undefined,
            close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        };
    } catch (error) {
        if (!error || error.code !== 'EPERM') {
            throw error;
        }
        return { origin: serverOrigin, fixtures, close: async () => undefined };
    }
}

async function runBootstrap({ agent = 'codex', home, mock, platform = 'darwin', arch = 'arm64', force = false, pathEnv = '' }) {
    const sourceLines = [
        `Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });`,
        `Object.defineProperty(process, 'arch', { value: ${JSON.stringify(arch)} });`
    ];
    if (mock.fixtures) {
        const encoded = Buffer.from(JSON.stringify(mock.fixtures)).toString('base64');
        sourceLines.push(
            `const fixtures = JSON.parse(Buffer.from('${encoded}', 'base64').toString());`,
            `globalThis.fetch = async value => {`,
            `  const selected = fixtures[new URL(String(value)).pathname] || { status: 404, contentType: 'text/plain', body: '' };`,
            `  const original = Buffer.from(selected.body, 'base64');`,
            `  const body = selected.contentType === 'application/json'`,
            `    ? Buffer.from(original.toString().replaceAll('__ORIGIN__', ${JSON.stringify(mock.origin)}))`,
            `    : original;`,
            `  return new Response(body, { status: selected.status, headers: { 'content-type': selected.contentType } });`,
            `};`
        );
    }
    sourceLines.push(`(${bootstrapRunner.toString()})()`);
    const source = sourceLines.join('\n');
    const sourcePath = path.join(home, 'bootstrap-runner-test.cjs');
    await writeFile(sourcePath, source, 'utf8');
    const env = {
        ...process.env,
        HOME: home,
        LOCALAPPDATA: path.join(home, 'local-app-data'),
        PATH: pathEnv,
        AKARI_PARTNER_CODEX_RELEASE_API_URL: `${mock.origin}/latest`,
        AKARI_PARTNER_CODEX_RELEASE_TAG_API_URL_TEMPLATE: `${mock.origin}/tags/{tag}`,
        ...(force ? { AKARI_PARTNER_FORCE_REINSTALL: '1' } : {})
    };
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [sourcePath, agent], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => stdout += chunk.toString());
        child.stderr.on('data', chunk => stderr += chunk.toString());
        child.on('error', reject);
        child.on('exit', code => resolve({ code, stdout, stderr }));
    });
}

test('Windows の Hermes Agent は既存のユーザー領域 venv を検出し、再インストールせずに再利用する', async () => {
    const home = await makeHome('akari-hermes-win32-');
    const executable = path.join(home, 'local-app-data', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe');
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, 'hermes');
    await chmod(executable, 0o755);
    try {
        const result = await runBootstrap({
            agent: 'hermes',
            home,
            mock: { origin: 'http://unused.test', fixtures: undefined },
            platform: 'win32',
            arch: 'x64'
        });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /既存の hermes を検出/);
        assert.match(result.stdout, /"reused":true/);
        assert.match(result.stdout, /hermes\.exe/);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

function latestRelease(origin = '__ORIGIN__') {
    return {
        tag_name: TAG,
        assets: PLATFORM_CASES.map(([, , target]) => ({
            name: `codex-package-${target}.tar.gz`,
            browser_download_url: `${origin}/assets/codex-package-${target}.tar.gz`
        }))
    };
}

test('Codex バンドルアセット名を全対応 platform / arch で表引きする', async () => {
    const fixtures = {
        '/latest': fixture(JSON.stringify(latestRelease()), 200, 'application/json')
    };
    for (const [, , target] of PLATFORM_CASES) {
        fixtures[`/assets/codex-package-${target}.tar.gz`] = fixture(bundleArchive(target.includes('windows') ? 'win32' : 'darwin'));
    }
    const mock = await startFixtureServer(fixtures);
    const homes = [];
    try {
        for (const [platform, arch, target] of PLATFORM_CASES) {
            const home = await makeHome('akari-codex-map-');
            homes.push(home);
            const result = await runBootstrap({ home, mock, platform, arch, force: true });
            assert.equal(result.code, 0, `${platform}-${arch}: ${result.stderr || result.stdout}`);
            assert.match(result.stdout, new RegExp(`codex-package-${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.tar\\.gz`));
        }
    } finally {
        await mock.close();
        await Promise.all(homes.map(home => rm(home, { recursive: true, force: true })));
    }
});

test('クリーンインストールで多ファイル tar・サブディレクトリ・実行属性・host 隣接を復元する', async () => {
    const home = await makeHome('akari-codex-clean-');
    const mock = await startFixtureServer({
        '/latest': fixture(JSON.stringify(latestRelease()), 200, 'application/json'),
        '/assets/codex-package-aarch64-apple-darwin.tar.gz': fixture(bundleArchive('darwin'))
    });
    try {
        const result = await runBootstrap({ home, mock, force: true });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /Codex code-mode host: OK/);
        const shim = path.join(home, '.local', 'bin', 'codex');
        assert.ok((await lstat(shim)).isSymbolicLink());
        const executable = await realpath(shim);
        const versionDir = path.dirname(path.dirname(executable));
        assert.equal(await readFile(path.join(versionDir, 'bin', 'codex-code-mode-host'), 'utf8'), 'matching host');
        assert.equal(await readFile(path.join(versionDir, 'codex-package.json'), 'utf8'), JSON.stringify({ version: VERSION }));
        assert.ok(((await stat(path.join(versionDir, 'codex-path', 'rg'))).mode & 0o111) !== 0);
    } finally {
        await mock.close();
        await rm(home, { recursive: true, force: true });
    }
});

test('PATH 上の AKARI 管理外 codex は既存 Codex として検出せず隣へ host を書かない', async () => {
    const home = await makeHome('akari-codex-path-home-');
    const foreignDir = await makeHome('akari-codex-foreign-');
    const foreignCodex = path.join(foreignDir, 'codex');
    await writeFile(foreignCodex, '#!/bin/sh\necho codex-cli 0.149.1\n');
    await chmod(foreignCodex, 0o755);
    const mock = await startFixtureServer({
        '/latest': fixture(JSON.stringify(latestRelease()), 200, 'application/json'),
        '/assets/codex-package-aarch64-apple-darwin.tar.gz': fixture(bundleArchive('darwin'))
    });
    try {
        const result = await runBootstrap({ home, mock, pathEnv: foreignDir });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.doesNotMatch(result.stdout, new RegExp(`既存の codex を検出: ${foreignCodex}`));
        assert.equal(await readFile(foreignCodex, 'utf8'), '#!/bin/sh\necho codex-cli 0.149.1\n');
        await assert.rejects(readFile(path.join(foreignDir, 'codex-code-mode-host')));
        assert.ok((await lstat(path.join(home, '.local', 'bin', 'codex'))).isSymbolicLink());
    } finally {
        await mock.close();
        await rm(home, { recursive: true, force: true });
        await rm(foreignDir, { recursive: true, force: true });
    }
});

test('host の無い既存 Codex は codex --version と同じタグから host だけを補充する', async () => {
    const home = await makeHome('akari-codex-repair-');
    const binDir = path.join(home, '.local', 'bin');
    await mkdir(binDir, { recursive: true });
    const codex = path.join(binDir, 'codex');
    await writeFile(codex, '#!/bin/sh\necho codex-cli 0.149.1\n');
    await chmod(codex, 0o755);
    const mock = await startFixtureServer({
        [`/tags/${TAG}`]: fixture(JSON.stringify({
            tag_name: TAG,
            assets: [{
                name: 'codex-code-mode-host-aarch64-apple-darwin.tar.gz',
                browser_download_url: '__ORIGIN__/assets/host.tar.gz'
            }]
        }), 200, 'application/json'),
        '/assets/host.tar.gz': fixture(hostArchive()),
        '/latest': fixture('', 500)
    });
    try {
        const result = await runBootstrap({ home, mock });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /Codex code-mode host: 補充した/);
        assert.doesNotMatch(result.stdout, /Codex リリース情報を取得しています/);
        assert.equal(await readFile(path.join(binDir, 'codex-code-mode-host'), 'utf8'), 'repaired matching host');
        assert.equal(await readFile(codex, 'utf8'), '#!/bin/sh\necho codex-cli 0.149.1\n');
    } finally {
        await mock.close();
        await rm(home, { recursive: true, force: true });
    }
});

test('同版 host のタグ取得に失敗したら既存本体を触らず公式バンドルへフォールバックする', async () => {
    const home = await makeHome('akari-codex-fallback-');
    const binDir = path.join(home, '.local', 'bin');
    await mkdir(binDir, { recursive: true });
    const codex = path.join(binDir, 'codex');
    await writeFile(codex, '#!/bin/sh\necho codex-cli 0.149.1\n');
    await chmod(codex, 0o755);
    const mock = await startFixtureServer({
        [`/tags/${TAG}`]: fixture('', 404),
        '/latest': fixture(JSON.stringify(latestRelease()), 200, 'application/json'),
        '/assets/codex-package-aarch64-apple-darwin.tar.gz': fixture(bundleArchive('darwin'))
    });
    try {
        const result = await runBootstrap({ home, mock });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /公式バンドルへ切り替えます/);
        assert.ok((await lstat(codex)).isSymbolicLink());
        const executable = await realpath(codex);
        assert.match(executable, /share\/akari-video\/codex\/0\.149\.1\/bin\/codex$/);
        assert.equal(await readFile(path.join(path.dirname(executable), 'codex-code-mode-host'), 'utf8'), 'matching host');
    } finally {
        await mock.close();
        await rm(home, { recursive: true, force: true });
    }
});
