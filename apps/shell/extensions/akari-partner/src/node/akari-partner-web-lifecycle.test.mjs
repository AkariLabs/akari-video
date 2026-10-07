import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariPartnerServerImpl } from '../../lib/node/akari-partner-server.js';

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
