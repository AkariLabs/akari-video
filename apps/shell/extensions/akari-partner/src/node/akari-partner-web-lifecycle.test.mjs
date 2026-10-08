import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariPartnerServerImpl } from '../../lib/node/akari-partner-server.js';
import { DshWebEarlyExitError } from '../../lib/node/dsh-web-launcher.js';
import { dshWebPortCandidates, normalizeWebCwdKey } from '../../lib/node/dsh-web-port.js';

async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'akari-partner-web-'));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    const first = join(root, 'first');
    const second = join(root, 'second');
    await mkdir(first);
    await mkdir(second);
    const executable = join(root, process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
    await writeFile(executable, 'fixture');
    return { root, first, second, executable };
}

class StubWebServer extends AkariPartnerServerImpl {
    launches = 0;
    killed = [];
    alive = new Set();

    async launchNewWebPartner(_agent, cwd) {
        const pid = 41000 + ++this.launches;
        this.alive.add(pid);
        return { pid, cwd, url: `http://127.0.0.1:41000/?token=fixture-${pid}`,
            provider: 'deepseek-official', providerNote: 'fixture' };
    }
    webProcessAlive(pid) { return this.alive.has(pid); }
    killWebProcess(pid) { this.killed.push(pid); this.alive.delete(pid); }
}

test('unregistered pid cannot be stopped and a live cwd is reused', async t => {
    const { first, executable } = await fixture(t);
    const server = new StubWebServer();
    await server.stopWebPartner(99999, 'window-a');
    assert.deepEqual(server.killed, []);
    const uri = pathToFileURL(first).href;
    const initial = await server.startWebPartner('deepseek', uri, executable, 'window-a');
    const reused = await server.startWebPartner('deepseek', uri, executable, 'window-b');
    assert.deepEqual(reused, initial);
    assert.equal(initial.cwd, first);
    assert.equal(server.launches, 1);
    await server.stopWebPartner(initial.pid, 'window-a');
    assert.deepEqual(server.killed, []);
    await server.stopWebPartner(initial.pid, 'window-b');
    assert.deepEqual(server.killed, [initial.pid]);
});

test('reconcile releases only the calling window ownership', async t => {
    const { first, second, executable } = await fixture(t);
    const server = new StubWebServer();
    const firstUri = pathToFileURL(first).href;
    const secondUri = pathToFileURL(second).href;
    const shared = await server.startWebPartner('deepseek', firstUri, executable, 'window-a');
    await server.startWebPartner('deepseek', firstUri, executable, 'window-b');
    const other = await server.startWebPartner('deepseek', secondUri, executable, 'window-b');
    await server.reconcileWebPartners('window-a', []);
    assert.deepEqual(server.killed, []);
    await server.reconcileWebPartners('window-b', [firstUri]);
    assert.deepEqual(server.killed, [other.pid]);
    await server.reconcileWebPartners('window-b', []);
    assert.deepEqual(server.killed, [other.pid, shared.pid]);
});

test('realpath is only a reuse key; spawn and each returned cwd keep the requested path', async t => {
    const { root, first, second, executable } = await fixture(t);
    const previousHome = process.env.AKARI_HOME;
    const previousKey = process.env.DEEPSEEK_API_KEY;
    process.env.AKARI_HOME = join(root, 'home');
    delete process.env.DEEPSEEK_API_KEY;
    const uncKey = '\\\\server\\share\\project';
    class KeyedWebServer extends AkariPartnerServerImpl {
        keyInputs = [];
        spawnCwds = [];
        killed = [];
        async resolveWebCwdKey(cwd) { this.keyInputs.push(cwd); return uncKey; }
        async prepareLaunch(agent) { return { agent, args: [], log: [], env: {} }; }
        async launchWebProcess(input) {
            this.spawnCwds.push(input.cwd);
            return { url: 'http://127.0.0.1:41000/?token=fixture', pid: 41007 };
        }
        webProcessAlive() { return true; }
        killWebProcess(pid) { this.killed.push(pid); }
    }
    try {
        const server = new KeyedWebServer();
        const firstUri = pathToFileURL(first).href;
        const secondUri = pathToFileURL(second).href;
        const launched = await server.startWebPartner('deepseek', firstUri, executable, 'window-a');
        const reused = await server.startWebPartner('deepseek', secondUri, executable, 'window-b');
        assert.deepEqual(server.spawnCwds, [first]);
        assert.deepEqual(server.keyInputs, [first, second]);
        assert.equal(launched.cwd, first);
        assert.equal(reused.cwd, second);
        assert.equal(reused.pid, launched.pid);
        assert.equal(reused.url, launched.url);
        await server.reconcileWebPartners('window-a', []);
        await server.reconcileWebPartners('window-b', [secondUri]);
        assert.deepEqual(server.killed, []);
        await server.reconcileWebPartners('window-b', []);
        assert.deepEqual(server.killed, [launched.pid]);
    } finally {
        if (previousHome === undefined) delete process.env.AKARI_HOME;
        else process.env.AKARI_HOME = previousHome;
        if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
        else process.env.DEEPSEEK_API_KEY = previousKey;
    }
});

test('a directly opened UNC project is rejected before spawn', async t => {
    const { executable } = await fixture(t);
    const server = new StubWebServer();
    for (const cwd of ['\\\\server\\share\\project', '//server/share/project']) {
        await assert.rejects(server.startWebPartner('deepseek', cwd, executable, 'window-a'), error => {
            assert.match(error.message, /ネットワークの場所/);
            assert.match(error.message, /ドライブ文字を割り当てて開き直してください/);
            return true;
        });
    }
    assert.equal(server.launches, 0);
});

test('web launch validates executable and project folder before spawning', async t => {
    const { root, first, executable } = await fixture(t);
    const server = new StubWebServer();
    const uri = pathToFileURL(first).href;
    await assert.rejects(server.startWebPartner('deepseek', undefined, executable, 'window-a'), /プロジェクトを開いて/);
    await assert.rejects(server.startWebPartner('deepseek', uri, 'dsh', 'window-a'), /絶対パス/);
    const wrongName = join(root, 'other.cmd');
    await writeFile(wrongName, 'fixture');
    await assert.rejects(server.startWebPartner('deepseek', uri, wrongName, 'window-a'), /dsh \/ dsh.cmd/);
    await assert.rejects(server.startWebPartner('deepseek', uri, join(root, 'missing', 'dsh.cmd'), 'window-a'), /見つかりません/);
    await assert.rejects(server.startWebPartner('deepseek', pathToFileURL(join(root, 'missing')).href,
        executable, 'window-a'), /フォルダが見つかりません/);
    assert.equal(server.launches, 0);
});

test('server masks credentials and token in web logs and errors', async t => {
    const { root, first, executable } = await fixture(t);
    const previousHome = process.env.AKARI_HOME;
    const previousKey = process.env.DEEPSEEK_API_KEY;
    const secret = 'fixture-secret-for-mask';
    process.env.AKARI_HOME = join(root, 'home');
    process.env.DEEPSEEK_API_KEY = secret;
    class FailingWebServer extends AkariPartnerServerImpl {
        async prepareLaunch(agent) { return { agent, args: [], log: [], env: {} }; }
        async launchWebProcess(input) {
            assert.equal(input.timeoutMs, 120_000);
            input.log(`request token=fixture-token key=${secret}`);
            throw new Error(`failure token=fixture-token key=${secret}`);
        }
    }
    try {
        const server = new FailingWebServer();
        await assert.rejects(server.startWebPartner('deepseek', pathToFileURL(first).href, executable, 'window-a'), error => {
            assert.match(error.message, /token=\*\*\*/);
            assert.ok(!error.message.includes(secret));
            assert.ok(!error.message.includes('fixture-token'));
            return true;
        });
        const log = await readFile(join(root, 'home', 'partners', 'deepseek', 'web.log'), 'utf8');
        assert.match(log, /token=\*\*\*/);
        assert.ok(!log.includes(secret));
        assert.ok(!log.includes('fixture-token'));
        const disclosure = await server.getInstallDisclosure('deepseek');
        assert.doesNotMatch(disclosure.environment, /接続先:/);
        assert.match(disclosure.connectionNote, /^接続先: DeepSeek 公式 API/);
        assert.equal((await server.getInstallDisclosure('claude')).connectionNote, undefined);
    } finally {
        if (previousHome === undefined) delete process.env.AKARI_HOME;
        else process.env.AKARI_HOME = previousHome;
        if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
        else process.env.DEEPSEEK_API_KEY = previousKey;
    }
});

test('early exit with a selected port retries exactly once without --port', async t => {
    const { root, first, executable } = await fixture(t);
    const previousHome = process.env.AKARI_HOME;
    process.env.AKARI_HOME = join(root, 'home');
    class RetryWebServer extends AkariPartnerServerImpl {
        ports = [];
        async prepareLaunch(agent) { return { agent, args: [], log: [], env: {} }; }
        async launchWebProcess(input) {
            this.ports.push(input.port);
            if (this.ports.length === 1) throw new DshWebEarlyExitError('fixture early exit');
            return { url: 'http://127.0.0.1:41000/?token=fixture', pid: 41007 };
        }
        webProcessAlive() { return true; }
    }
    try {
        const server = new RetryWebServer();
        const launch = await server.startWebPartner('deepseek', pathToFileURL(first).href, executable, 'window-a');
        assert.equal(launch.pid, 41007);
        const expected = dshWebPortCandidates(normalizeWebCwdKey(first))[0];
        assert.equal(server.ports[0], expected);
        assert.deepEqual(server.ports, [expected, undefined]);
        const log = await readFile(join(root, 'home', 'partners', 'deepseek', 'web.log'), 'utf8');
        assert.match(log, new RegExp(`dsh web port: ${expected}; skipped:`));
        assert.match(log, /dsh web port: 0 \(OS が選ぶ\); retrying once/);
    } finally {
        if (previousHome === undefined) delete process.env.AKARI_HOME;
        else process.env.AKARI_HOME = previousHome;
    }
});

test('startup timeout does not retry without --port', async t => {
    const { root, first, executable } = await fixture(t);
    const previousHome = process.env.AKARI_HOME;
    process.env.AKARI_HOME = join(root, 'home');
    class TimeoutWebServer extends AkariPartnerServerImpl {
        ports = [];
        async prepareLaunch(agent) { return { agent, args: [], log: [], env: {} }; }
        async launchWebProcess(input) {
            this.ports.push(input.port);
            throw new Error('dsh web startup timed out');
        }
    }
    try {
        const server = new TimeoutWebServer();
        await assert.rejects(server.startWebPartner('deepseek', pathToFileURL(first).href, executable, 'window-a'),
            /startup timed out/);
        assert.equal(server.ports.length, 1);
    } finally {
        if (previousHome === undefined) delete process.env.AKARI_HOME;
        else process.env.AKARI_HOME = previousHome;
    }
});

test('a failed automatic-port retry is the final attempt', async t => {
    const { root, first, executable } = await fixture(t);
    const previousHome = process.env.AKARI_HOME;
    process.env.AKARI_HOME = join(root, 'home');
    class TwiceFailingWebServer extends AkariPartnerServerImpl {
        ports = [];
        async prepareLaunch(agent) { return { agent, args: [], log: [], env: {} }; }
        async launchWebProcess(input) {
            this.ports.push(input.port);
            if (this.ports.length === 1) {
                throw new DshWebEarlyExitError('dsh web exited with code 7\nfirst stderr token=fixture-token');
            }
            throw new DshWebEarlyExitError('dsh web exited with code 9\nretry stderr');
        }
    }
    try {
        const server = new TwiceFailingWebServer();
        await assert.rejects(server.startWebPartner('deepseek', pathToFileURL(first).href, executable, 'window-a'),
            error => {
                assert.match(error.message, /code 7/);
                assert.match(error.message, /first stderr token=\*\*\*/);
                assert.match(error.message, /code 9/);
                assert.doesNotMatch(error.message, /fixture-token/);
                return true;
            });
        assert.equal(server.ports.length, 2);
        assert.equal(server.ports[1], undefined);
    } finally {
        if (previousHome === undefined) delete process.env.AKARI_HOME;
        else process.env.AKARI_HOME = previousHome;
    }
});
