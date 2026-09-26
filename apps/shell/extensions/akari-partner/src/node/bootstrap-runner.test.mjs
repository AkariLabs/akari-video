import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync, gzipSync } from 'node:zlib';
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

function tarEntry(name, content = Buffer.alloc(0), mode = 0o644, type = '0', linkpath = '') {
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
    writeTarString(header, 157, 100, linkpath);
    writeTarString(header, 257, 6, 'ustar');
    writeTarString(header, 263, 2, '00');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
    const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
    return Buffer.concat([header, body, padding]);
}

function makeTar(entries) {
    return Buffer.concat([
        ...entries.map(entry => tarEntry(entry.name, entry.content, entry.mode, entry.type, entry.linkpath)),
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

async function runBootstrap({ home, mock, agent = 'codex', platform = 'darwin', arch = 'arm64', force = false, pathEnv = '', extraEnv = {} }) {
    const sourceLines = [
        `const hostPlatform = process.platform;`,
        `Object.defineProperty(require('os'), 'platform', { value: () => hostPlatform });`,
        `Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });`,
        `Object.defineProperty(process, 'arch', { value: ${JSON.stringify(arch)} });`
    ];
    if (mock.hideWellKnownNode) {
        sourceLines.push(
            `const originalAccess = require('fs').promises.access;`,
            `require('fs').promises.access = (file, ...args) =>`,
            `  /^\\/(?:opt\\/homebrew\\/bin|usr\\/local\\/bin|usr\\/bin)\\/(?:node|npm)$/.test(String(file))`,
            `    ? Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' })) : originalAccess(file, ...args);`
        );
    }
    if (mock.fixtures) {
        const encoded = Buffer.from(JSON.stringify(mock.fixtures)).toString('base64');
        sourceLines.push(
            `const fixtures = JSON.parse(Buffer.from('${encoded}', 'base64').toString());`,
            `globalThis.fetch = async value => {`,
            ...(mock.requestLogPath ? [`  require('fs').appendFileSync(${JSON.stringify(mock.requestLogPath)}, String(value) + '\\n');`] : []),
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
    const env = {
        ...process.env,
        HOME: home,
        LOCALAPPDATA: path.join(home, 'local-app-data'),
        PATH: pathEnv,
        AKARI_HOME: home,
        AKARI_PARTNER_CODEX_RELEASE_API_URL: `${mock.origin}/latest`,
        AKARI_PARTNER_CODEX_RELEASE_TAG_API_URL_TEMPLATE: `${mock.origin}/tags/{tag}`,
        ...(force ? { AKARI_PARTNER_FORCE_REINSTALL: '1' } : {}),
        ...extraEnv
    };
    if (!Object.hasOwn(extraEnv, 'AKARI_PARTNER_NODE_DIST_BASE_URL')) {
        delete env.AKARI_PARTNER_NODE_DIST_BASE_URL;
    }
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', source, agent], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => stdout += chunk.toString());
        child.stderr.on('data', chunk => stderr += chunk.toString());
        child.on('error', reject);
        child.on('exit', code => resolve({ code, stdout, stderr }));
    });
}

const NODE_VERSION = '24.21.0';
const NODE_ASSET = `node-v${NODE_VERSION}-darwin-arm64.tar.gz`;
const NODE_ROOT = `node-v${NODE_VERSION}-darwin-arm64`;
const fakeNodeScript = `#!/bin/sh
if [ "$1" = "-p" ]; then echo ${NODE_VERSION}; else exec ${JSON.stringify(process.execPath)} "$@"; fi
`;
const fakeNpmScript = `#!/bin/sh
/bin/mkdir -p "$HOME/.local/bin"
printf '%s\\n' '#!/bin/sh' 'echo 1.45.0' > "$HOME/.local/bin/command-code"
/bin/chmod +x "$HOME/.local/bin/command-code"
printf '%s\\n' '#!/bin/sh' 'echo 1.45.0' > "$HOME/.local/command-code.cmd"
/bin/chmod +x "$HOME/.local/command-code.cmd"
`;

function privateNodeArchive(agent = 'commandcode') {
    const npmScript = agent === 'pi'
        ? fakeNpmScript.replaceAll('command-code', 'pi')
            .replace('#!/bin/sh\n', '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$HOME/npm-args.txt"\n')
        : fakeNpmScript;
    return gzipSync(makeTar([
        { name: `${NODE_ROOT}/`, type: '5', mode: 0o755 },
        { name: `${NODE_ROOT}/bin/`, type: '5', mode: 0o755 },
        { name: `${NODE_ROOT}/bin/node`, content: fakeNodeScript, mode: 0o755 },
        { name: `${NODE_ROOT}/lib/node_modules/npm/bin/`, type: '5', mode: 0o755 },
        { name: `${NODE_ROOT}/lib/node_modules/npm/bin/npm-cli.js`, content: npmScript, mode: 0o755 },
        { name: `${NODE_ROOT}/bin/npm`, type: '2', linkpath: '../lib/node_modules/npm/bin/npm-cli.js', mode: 0o777 }
    ]));
}

function paxRecord(key, value) {
    const body = ` ${key}=${value}\n`;
    let length = Buffer.byteLength(body) + 1;
    while (Buffer.byteLength(`${length}${body}`) !== length) {
        length = Buffer.byteLength(`${length}${body}`);
    }
    return `${length}${body}`;
}

function privateNodePaxArchive() {
    return gzipSync(makeTar([
        { name: `${NODE_ROOT}/`, type: '5', mode: 0o755 },
        { name: `${NODE_ROOT}/bin/`, type: '5', mode: 0o755 },
        { name: 'pax-node', type: 'x', content: paxRecord('path', `${NODE_ROOT}/bin/node`) },
        { name: `${NODE_ROOT}/bin/placeholder`, content: fakeNodeScript, mode: 0o755 },
        { name: `${NODE_ROOT}/lib/node_modules/npm/bin/`, type: '5', mode: 0o755 },
        { name: `${NODE_ROOT}/lib/node_modules/npm/bin/npm-cli.js`, content: fakeNpmScript, mode: 0o755 },
        { name: 'pax-link', type: 'x', content: paxRecord('linkpath', '../lib/node_modules/npm/bin/npm-cli.js') },
        { name: `${NODE_ROOT}/bin/npm`, type: '2', linkpath: '../../outside', mode: 0o777 }
    ]));
}

function nodeMock(archive, asset = NODE_ASSET, requestLogPath) {
    return {
        origin: 'http://example.test',
        fixtures: { [`/v${NODE_VERSION}/${asset}`]: fixture(archive) },
        requestLogPath
    };
}

function nodeEnv(archive, asset = NODE_ASSET) {
    return {
        AKARI_PARTNER_IGNORE_SYSTEM_NODE: '1',
        AKARI_PARTNER_NODE_DIST_BASE_URL: 'http://example.test',
        AKARI_PARTNER_NODE_SHA256_OVERRIDE_JSON: JSON.stringify({
            [asset]: createHash('sha256').update(archive).digest('hex')
        })
    };
}

test('PATH 上の既存 Command Code を再利用する', async () => {
    const home = await makeHome('akari-commandcode-existing-home-');
    const binDir = await makeHome('akari-commandcode-existing-bin-');
    const executable = path.join(binDir, 'command-code');
    await writeFile(executable, '#!/bin/sh\necho 1.45.0\n');
    await chmod(executable, 0o755);
    try {
        const result = await runBootstrap({
            home,
            mock: { origin: 'http://example.test' },
            agent: 'commandcode',
            pathEnv: binDir
        });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, new RegExp(`既存の commandcode 1\\.45\\.0 を検出: ${executable}`));
        assert.match(result.stdout, /"reused":true/);
    } finally {
        await rm(home, { recursive: true, force: true });
        await rm(binDir, { recursive: true, force: true });
    }
});

test('Pi は Node 22.18 では専用 Node を使い npm の現行パッケージを導入する', async () => {
    const home = await makeHome('akari-pi-private-home-');
    const toolsDir = await makeHome('akari-pi-node2218-tools-');
    const archive = privateNodeArchive('pi');
    await writeFile(path.join(toolsDir, 'node'), '#!/bin/sh\necho 22.18.0\n', { mode: 0o755 });
    await writeFile(path.join(toolsDir, 'npm'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    try {
        const result = await runBootstrap({
            home, agent: 'pi', pathEnv: toolsDir,
            mock: { ...nodeMock(archive), hideWellKnownNode: true },
            extraEnv: {
                AKARI_PARTNER_NODE_DIST_BASE_URL: 'http://example.test',
                AKARI_PARTNER_NODE_SHA256_OVERRIDE_JSON: nodeEnv(archive).AKARI_PARTNER_NODE_SHA256_OVERRIDE_JSON
            }
        });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /"nodeSource":"private"/);
        assert.equal(await readFile(path.join(home, 'runtime/node', `v${NODE_VERSION}`, 'pi-installed'), 'utf8'), 'private\n');
        assert.match(result.stdout, /Pi 1\.45\.0 を検出/);
        assert.match(await readFile(path.join(home, 'npm-args.txt'), 'utf8'), /@earendil-works\/pi-coding-agent\n$/);
    } finally {
        await rm(home, { recursive: true, force: true });
        await rm(toolsDir, { recursive: true, force: true });
    }
});

test('npm 製エージェントの起動確認エラーは必要な Node.js 版を示す', async () => {
    for (const [agent, executableName, expectedVersion] of [
        ['commandcode', 'command-code', '22'],
        ['pi', 'pi', '22.19']
    ]) {
        const home = await makeHome(`akari-${agent}-version-error-home-`);
        const toolsDir = await makeHome(`akari-${agent}-version-error-tools-`);
        await writeFile(path.join(toolsDir, 'node'), '#!/bin/sh\necho 24.21.0\n', { mode: 0o755 });
        await writeFile(path.join(toolsDir, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        await writeFile(path.join(toolsDir, executableName), '#!/bin/sh\necho version failed >&2\nexit 2\n', { mode: 0o755 });
        try {
            const result = await runBootstrap({ home, agent, pathEnv: toolsDir, mock: { origin: 'http://example.test' } });
            assert.notEqual(result.code, 0);
            assert.match(result.stderr, new RegExp(`Node\\.js ${expectedVersion.replace('.', '\\.') } 以上を確認して再インストールしてください`));
        } finally {
            await rm(home, { recursive: true, force: true });
            await rm(toolsDir, { recursive: true, force: true });
        }
    }
});

const noisyInstallerProgress = `for ((i=0; i<80; i++)); do
  printf '\\033[32mprogress-%03d: %060d\\033[0m\\r' "$i" "$i" >&2
done
echo 'Error: Login canceled' >&2
`;

test('Devin installer の setup が非 0 でも実体と --version が成功すれば導入済みと判定する', async () => {
    const home = await makeHome('akari-devin-home-');
    const script = `#!/usr/bin/env bash
[[ -n "$HOME" ]] || exit 90
mkdir -p "$HOME/.local/bin"
printf '%s\\n' '#!/bin/sh' 'echo "devin 3000.11.3"' > "$HOME/.local/bin/devin"
chmod +x "$HOME/.local/bin/devin"
${noisyInstallerProgress}
exit 1
`;
    try {
        const result = await runBootstrap({
            home, agent: 'devin',
            mock: { origin: 'http://example.test', fixtures: { '/devin-install': fixture(script, 200, 'text/plain') } },
            extraEnv: { AKARI_PARTNER_DEVIN_INSTALL_URL: 'http://example.test/devin-install' }
        });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /--version \(devin 3000\.11\.3\) が成功/);
        assert.match(result.stdout, /判定します: Error: Login canceled\n/);
        assert.doesNotMatch(result.stdout, /progress-/);
        assert.match(result.stdout, /"reused":false/);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('Devin installer の非 0 終了は --version 失敗時に成功扱いしない', async () => {
    const home = await makeHome('akari-devin-broken-home-');
    const script = `#!/usr/bin/env bash
mkdir -p "$HOME/.local/bin"
printf '%s\\n' '#!/bin/sh' 'printf "\\033[31mprogress-999\\033[0m\\rError: version failed\\n" >&2; exit 2' > "$HOME/.local/bin/devin"
chmod +x "$HOME/.local/bin/devin"
${noisyInstallerProgress}
exit 1
`;
    try {
        const result = await runBootstrap({
            home, agent: 'devin',
            mock: { origin: 'http://example.test', fixtures: { '/devin-install': fixture(script, 200, 'text/plain') } },
            extraEnv: { AKARI_PARTNER_DEVIN_INSTALL_URL: 'http://example.test/devin-install' }
        });
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /インストールと起動確認に失敗/);
        const summary = result.stderr.trim().split('\n').at(-1);
        assert.match(summary, /\(Error: Login canceled; Error: version failed\)$/);
        assert.doesNotMatch(summary, /progress-/);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('Devin installer が失敗し実行ファイルも無い場合、エラーは最後の 1 行だけを含む', async () => {
    const home = await makeHome('akari-devin-missing-home-');
    const script = `#!/usr/bin/env bash\n${noisyInstallerProgress}exit 1\n`;
    try {
        const result = await runBootstrap({
            home, agent: 'devin',
            mock: { origin: 'http://example.test', fixtures: { '/devin-install': fixture(script, 200, 'text/plain') } },
            extraEnv: { AKARI_PARTNER_DEVIN_INSTALL_URL: 'http://example.test/devin-install' }
        });
        assert.notEqual(result.code, 0);
        const summary = result.stderr.trim().split('\n').at(-1);
        assert.match(summary, /実行ファイルが見つかりませんでした.*\(Error: Login canceled\)$/);
        assert.doesNotMatch(summary, /progress-/);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('Devin は Windows の LOCALAPPDATA 配下にある既存 exe を検出する', async () => {
    const home = await makeHome('akari-devin-win-home-');
    const executable = path.join(home, 'local-app-data', 'devin', 'cli', 'bin', 'devin.exe');
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, '#!/bin/sh\necho devin 3000.11.3\n', { mode: 0o755 });
    try {
        const result = await runBootstrap({ home, agent: 'devin', platform: 'win32',
            mock: { origin: 'http://example.test' } });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /"reused":true/);
        assert.match(result.stdout, /devin\.exe/);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('Command Code を公式 npm パッケージからユーザー領域へ導入する', async () => {
    const home = await makeHome('akari-commandcode-install-home-');
    const toolsDir = await makeHome('akari-commandcode-install-tools-');
    const fakeNode = path.join(toolsDir, 'node');
    const fakeNpm = path.join(toolsDir, 'npm');
    await writeFile(fakeNode, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
    await writeFile(fakeNpm, `#!/bin/sh
printf '%s\\n' "$@" > "$HOME/npm-args.txt"
mkdir -p "$HOME/.local/bin"
printf '%s\\n' '#!/bin/sh' 'echo 1.45.0' > "$HOME/.local/bin/command-code"
chmod +x "$HOME/.local/bin/command-code"
`);
    await Promise.all([chmod(fakeNode, 0o755), chmod(fakeNpm, 0o755)]);
    try {
        const result = await runBootstrap({
            home,
            mock: { origin: 'http://example.test' },
            agent: 'commandcode',
            force: true,
            pathEnv: toolsDir
        });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /Command Code を npm 公式パッケージからユーザー領域へインストールしています/);
        assert.match(result.stdout, /Command Code 1\.45\.0 を検出/);
        assert.match(result.stdout, /"reused":false/);
        assert.equal(
            await readFile(path.join(home, 'npm-args.txt'), 'utf8'),
            `install\n--global\n--prefix\n${path.join(home, '.local')}\n--no-audit\n--no-fund\ncommand-code\n`
        );
    } finally {
        await rm(home, { recursive: true, force: true });
        await rm(toolsDir, { recursive: true, force: true });
    }
});

test('Command Code は Node.js 22 未満なら専用 Node を取得してインストールする', async () => {
    const home = await makeHome('akari-commandcode-node20-home-');
    const toolsDir = await makeHome('akari-commandcode-node20-tools-');
    const fakeNode = path.join(toolsDir, 'node');
    const fakeNpm = path.join(toolsDir, 'npm');
    await writeFile(fakeNode, '#!/bin/sh\necho 20.19.0\n');
    await writeFile(fakeNpm, '#!/bin/sh\nexit 99\n');
    await Promise.all([chmod(fakeNode, 0o755), chmod(fakeNpm, 0o755)]);
    const archive = privateNodeArchive();
    try {
        const result = await runBootstrap({
            home,
            mock: { ...nodeMock(archive), hideWellKnownNode: true },
            agent: 'commandcode',
            force: true,
            pathEnv: toolsDir,
            extraEnv: {
                AKARI_PARTNER_NODE_DIST_BASE_URL: 'http://example.test',
                AKARI_PARTNER_NODE_SHA256_OVERRIDE_JSON: nodeEnv(archive).AKARI_PARTNER_NODE_SHA256_OVERRIDE_JSON
            }
        });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /Node.js archive sha256 検証 OK/);
        assert.match(result.stdout, /"nodeSource":"private"/);
        assert.equal(await readFile(path.join(home, 'runtime/node', `v${NODE_VERSION}`, 'command-code-installed'), 'utf8'), 'private\n');
    } finally {
        await rm(home, { recursive: true, force: true });
        await rm(toolsDir, { recursive: true, force: true });
    }
});

test('Command Code はシステム Node が使えれば専用 Node を取得しない', async () => {
    const home = await makeHome('akari-commandcode-system-home-');
    const toolsDir = await makeHome('akari-commandcode-system-tools-');
    const requestLogPath = path.join(home, 'requests.txt');
    await writeFile(path.join(toolsDir, 'node'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 });
    await writeFile(path.join(toolsDir, 'npm'), fakeNpmScript, { mode: 0o755 });
    try {
        const result = await runBootstrap({ home, mock: { origin: 'http://example.test', fixtures: {}, requestLogPath },
            agent: 'commandcode', pathEnv: toolsDir, force: true });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /"nodeSource":"system"/);
        await assert.rejects(readFile(requestLogPath));
    } finally {
        await rm(home, { recursive: true, force: true });
        await rm(toolsDir, { recursive: true, force: true });
    }
});

test('Command Code はシステム Node が無ければ専用 Node を取得し、次回は再取得しない', async () => {
    const home = await makeHome('akari-commandcode-private-home-');
    const archive = privateNodeArchive();
    const requestLogPath = path.join(home, 'requests.txt');
    try {
        const first = await runBootstrap({ home, mock: nodeMock(archive, NODE_ASSET, requestLogPath),
            agent: 'commandcode', extraEnv: nodeEnv(archive) });
        assert.equal(first.code, 0, first.stderr || first.stdout);
        assert.match(first.stdout, /"nodeSource":"private"/);
        assert.equal((await lstat(path.join(home, 'runtime/node', `v${NODE_VERSION}`, 'bin/npm'))).isSymbolicLink(), true);
        assert.equal((await readFile(requestLogPath, 'utf8')).trim().split('\n').length, 1);
        await rm(requestLogPath);
        const second = await runBootstrap({ home, mock: nodeMock(archive, NODE_ASSET, requestLogPath),
            agent: 'commandcode', extraEnv: nodeEnv(archive) });
        assert.equal(second.code, 0, second.stderr || second.stdout);
        assert.match(second.stdout, /用意済みの AKARI 専用 Node.js を使います/);
        assert.match(second.stdout, /"reused":true/);
        await assert.rejects(readFile(requestLogPath));
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('既存の Command Code も Node が無ければ専用 Node を用意して再利用する', async () => {
    const home = await makeHome('akari-commandcode-existing-private-home-');
    const archive = privateNodeArchive();
    const executable = path.join(home, '.local/bin/command-code');
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, '#!/usr/bin/env node\nconsole.log("1.45.0")\n', { mode: 0o755 });
    try {
        const result = await runBootstrap({ home, mock: nodeMock(archive), agent: 'commandcode', extraEnv: nodeEnv(archive) });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /"reused":true,"nodeSource":"private"/);
        assert.equal(await readFile(path.join(home, 'runtime/node', `v${NODE_VERSION}`, 'command-code-installed'), 'utf8'), 'private\n');
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('専用 Node tar は pax の path と linkpath を使って展開する', async () => {
    const home = await makeHome('akari-commandcode-pax-home-');
    const archive = privateNodePaxArchive();
    try {
        const result = await runBootstrap({ home, mock: nodeMock(archive), agent: 'commandcode', extraEnv: nodeEnv(archive) });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.equal((await lstat(path.join(home, 'runtime/node', `v${NODE_VERSION}`, 'bin/npm'))).isSymbolicLink(), true);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('専用 Node の sha256 不一致は確定ディレクトリを作らない', async () => {
    const home = await makeHome('akari-commandcode-hash-home-');
    const archive = privateNodeArchive();
    try {
        const result = await runBootstrap({ home, mock: nodeMock(archive), agent: 'commandcode',
            extraEnv: { ...nodeEnv(archive), AKARI_PARTNER_NODE_SHA256_OVERRIDE_JSON: JSON.stringify({ [NODE_ASSET]: '0'.repeat(64) }) } });
        assert.equal(result.code, 1);
        assert.match(result.stderr, /sha256 mismatch/);
        await assert.rejects(stat(path.join(home, 'runtime/node', `v${NODE_VERSION}`)));
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('配布元 URL の上書きなしでは sha256 上書きを無視し、固定値で検証する', async () => {
    const home = await makeHome('akari-commandcode-pinned-hash-home-');
    const archive = privateNodeArchive();
    const requestLogPath = path.join(home, 'requests.txt');
    try {
        const result = await runBootstrap({ home, mock: {
            ...nodeMock(archive, NODE_ASSET, requestLogPath),
            fixtures: { [`/dist/v${NODE_VERSION}/${NODE_ASSET}`]: fixture(archive) }
        }, agent: 'commandcode',
            extraEnv: {
                AKARI_PARTNER_IGNORE_SYSTEM_NODE: '1',
                AKARI_PARTNER_NODE_SHA256_OVERRIDE_JSON: JSON.stringify({
                    [NODE_ASSET]: createHash('sha256').update(archive).digest('hex')
                })
            } });
        assert.equal(result.code, 1);
        assert.match(result.stderr, /sha256 mismatch/);
        assert.match(result.stderr, /bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057/);
        assert.equal(await readFile(requestLogPath, 'utf8'), `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ASSET}\n`);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

function makeZip(entries) {
    const local = [];
    const central = [];
    let offset = 0;
    for (const { name, content, method = 0 } of entries) {
        const nameBytes = Buffer.from(name);
        const raw = Buffer.from(content);
        const compressed = method === 8 ? deflateRawSync(raw) : raw;
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(method, 8);
        header.writeUInt32LE(compressed.length, 18);
        header.writeUInt32LE(raw.length, 22);
        header.writeUInt16LE(nameBytes.length, 26);
        local.push(header, nameBytes, compressed);
        const record = Buffer.alloc(46);
        record.writeUInt32LE(0x02014b50, 0);
        record.writeUInt16LE(method, 10);
        record.writeUInt32LE(compressed.length, 20);
        record.writeUInt32LE(raw.length, 24);
        record.writeUInt16LE(nameBytes.length, 28);
        record.writeUInt32LE(offset, 42);
        central.push(record, nameBytes);
        offset += header.length + nameBytes.length + compressed.length;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, directory, end]);
}

test('Windows の専用 Node zip は全ファイルを展開する', async () => {
    const home = await makeHome('akari-commandcode-win-node-home-');
    const asset = `node-v${NODE_VERSION}-win-x64.zip`;
    const root = `node-v${NODE_VERSION}-win-x64`;
    const archive = makeZip([
        { name: `${root}/node.exe`, content: fakeNodeScript },
        { name: `${root}/npm.cmd`, content: fakeNpmScript, method: 8 },
        { name: `${root}/node_modules/npm/package.json`, content: '{"name":"npm"}', method: 8 }
    ]);
    try {
        const result = await runBootstrap({ home, mock: nodeMock(archive, asset), agent: 'commandcode',
            platform: 'win32', arch: 'x64', extraEnv: nodeEnv(archive, asset) });
        assert.equal(result.code, 0, result.stderr || result.stdout);
        assert.equal(await readFile(path.join(home, 'runtime/node', `v${NODE_VERSION}`, 'node_modules/npm/package.json'), 'utf8'), '{"name":"npm"}');
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('Windows の専用 Node zip はディレクトリ外への書き込みを拒否する', async () => {
    const home = await makeHome('akari-commandcode-win-zipslip-home-');
    const asset = `node-v${NODE_VERSION}-win-x64.zip`;
    const archive = makeZip([{ name: '../escape.txt', content: 'unsafe' }]);
    try {
        const result = await runBootstrap({ home, mock: nodeMock(archive, asset), agent: 'commandcode',
            platform: 'win32', arch: 'x64', extraEnv: nodeEnv(archive, asset) });
        assert.equal(result.code, 1);
        assert.match(result.stderr, /unsafe path/);
        await assert.rejects(stat(path.join(home, 'runtime/node', `v${NODE_VERSION}`)));
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('Windows の .cmd 起動は空白入りの command と各引数を引用する', () => {
    const source = bootstrapRunner.toString();
    const start = source.indexOf('function shellInvocation(');
    const end = source.indexOf('async function run(', start);
    assert.ok(start >= 0 && end > start);
    const shellInvocation = new Function('process', 'os', `${source.slice(start, end)}\nreturn shellInvocation;`)(
        { platform: 'win32' }, { platform: () => 'win32' }
    );
    const command = 'C:\\Users\\A B\\.local\\command-code.cmd';
    const prefix = 'C:\\Users\\A B\\.local';
    assert.deepEqual(shellInvocation(command, ['--prefix', prefix]), {
        command: `"${command}"`, args: ['"--prefix"', `"${prefix}"`], shell: true
    });
    assert.equal(shellInvocation('C:\\A"B\\npm.cmd', []).command, '"C:\\A\\"B\\npm.cmd"');
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
