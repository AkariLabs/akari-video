import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { AkariPreviewServerServiceImpl } from '../lib/node/akari-preview-server-service.js';

/** spawn() の戻りを模す偽の子プロセス（実 CLI を起動しない — quick-export-service.test.mjs の流儀）。 */
class FakeChild extends EventEmitter {
    constructor(pid, onKill) {
        super();
        this.pid = pid;
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
        this.exitCode = null;
        this.signalCode = null;
        this.kills = [];
        this.onKill = onKill;
    }

    kill(signal) {
        this.kills.push(signal ?? '(default)');
        if (this.onKill) {
            this.onKill(this);
        }
        // 実プロセス同様、kill の後に close が非同期で届く。
        setImmediate(() => this.close(null, 'SIGTERM'));
        return true;
    }

    /** server.mjs の起動完了ログ（URL 行を含む 4 行）を stdout に流す。 */
    ready(port) {
        this.stdout.emit(
            'data',
            `\n  AKARI Video Preview Server\n  http://127.0.0.1:${port}\n  bind: 127.0.0.1:${port}\n  project: /project\n`
        );
    }

    close(code, signal = null) {
        if (this.exitCode !== null || this.signalCode !== null) {
            return;
        }
        this.exitCode = code;
        this.signalCode = signal;
        this.emit('close', code, signal);
    }
}

/** spawn / ポートプローブ / 入口解決を差し替えたテスト用サービス。 */
class FakeService extends AkariPreviewServerServiceImpl {
    events = [];
    children = [];
    spawnedArgs = [];
    busyPorts = new Set();
    autoReady = true;

    async findServerEntry() {
        return '/resources/packages/preview-server/src/server.mjs';
    }

    async probePort(port) {
        return !this.busyPorts.has(port);
    }

    childEnvironment() {
        return {};
    }

    installExitHook() {
        // テストプロセスに exit フックを残さない。
    }

    fsPath(uri) {
        return uri.replace('file://', '');
    }

    spawnServer(entry, args) {
        const port = Number(args[args.indexOf('--port') + 1]);
        const child = new FakeChild(1000 + this.children.length, killed => this.events.push(`kill:${killed.pid}`));
        this.children.push(child);
        this.spawnedArgs.push(args);
        this.events.push(`spawn:${child.pid}:${port}`);
        if (this.autoReady) {
            setImmediate(() => child.ready(port));
        }
        return child;
    }
}

test('(a) start: 偽 stdout に URL 行が流れると running + url + port', async () => {
    const service = new FakeService();
    const status = await service.start({ projectRootUri: 'file:///project' });
    assert.equal(status.phase, 'running');
    assert.equal(status.url, 'http://127.0.0.1:4567');
    assert.equal(status.port, 4567);
    assert.equal(status.pid, 1000);
    assert.equal(status.projectRootUri, 'file:///project');
    assert.match(status.logTail, /AKARI Video Preview Server/);
    assert.deepEqual(await service.getStatus(), status);
});

test('(b) start: 準備完了前の exit 1 + stderr EADDRINUSE は failed で「使用中」', async () => {
    const service = new FakeService();
    service.autoReady = false;
    const started = service.start({ projectRootUri: 'file:///project' });
    await waitForImmediate();
    const child = service.children[0];
    child.stderr.emit('data', 'Error: listen EADDRINUSE: address already in use 127.0.0.1:4567');
    child.close(1);
    const status = await started;
    assert.equal(status.phase, 'failed');
    assert.match(status.failureSummary, /使用中/);
    assert.match(status.failureSummary, /4567/);
});

test('(c) running 中の予期しない close は failed（stderr 末尾つき）', async () => {
    const service = new FakeService();
    await service.start({ projectRootUri: 'file:///project' });
    const child = service.children[0];
    child.stderr.emit('data', 'Error: boom\n');
    child.close(1);
    await waitForImmediate();
    const status = await service.getStatus();
    assert.equal(status.phase, 'failed');
    assert.match(status.failureSummary, /予期せず終了/);
    assert.match(status.failureSummary, /boom/);
});

test('(d) stop: idle になり kill は 1 回', async () => {
    const service = new FakeService();
    await service.start({ projectRootUri: 'file:///project' });
    const status = await service.stop();
    assert.equal(status.phase, 'idle');
    assert.equal(service.children[0].kills.length, 1);
    assert.equal((await service.getStatus()).phase, 'idle');
});

test('(e) 別 projectRootUri での start は旧 child の kill 後に新規 spawn（順序を記録）', async () => {
    const service = new FakeService();
    await service.start({ projectRootUri: 'file:///project-a' });
    const status = await service.start({ projectRootUri: 'file:///project-b' });
    assert.equal(status.phase, 'running');
    assert.equal(status.projectRootUri, 'file:///project-b');
    assert.deepEqual(service.events, ['spawn:1000:4567', 'kill:1000', 'spawn:1001:4567']);
});

test('(f) 同じ projectRootUri の再 start は spawn 回数を増やさない', async () => {
    const service = new FakeService();
    const first = await service.start({ projectRootUri: 'file:///project' });
    const second = await service.start({ projectRootUri: 'file:///project' });
    assert.equal(second.phase, 'running');
    assert.equal(second.url, first.url);
    assert.equal(service.children.length, 1);
});

test('(f2) starting 中の再入は同じ起動を待つ（二重 spawn しない）', async () => {
    const service = new FakeService();
    service.autoReady = false;
    const first = service.start({ projectRootUri: 'file:///project' });
    const second = service.start({ projectRootUri: 'file:///project' });
    await waitForImmediate();
    service.children[0].ready(4567);
    const [statusA, statusB] = await Promise.all([first, second]);
    assert.equal(statusA.phase, 'running');
    assert.deepEqual(statusA, statusB);
    assert.equal(service.children.length, 1);
});

test('(g) 入口不在は failed + logTail に試した候補一覧', async () => {
    class MissingEntryService extends AkariPreviewServerServiceImpl {
        fsImpl = { stat: async () => { throw new Error('ENOENT'); } };
    }
    const service = new MissingEntryService();
    const status = await service.start({ projectRootUri: 'file:///project' });
    assert.equal(status.phase, 'failed');
    assert.match(status.failureSummary, /preview-server が見つかりません/);
    assert.match(status.logTail, /解決に失敗/);
    assert.match(status.logTail, /src[\\/]server\.mjs/);
    assert.match(status.logTail, /  - /);
});

test('(h) 空きポート探索: 4567 が塞がっていれば 4568 を選ぶ', async () => {
    const service = new FakeService();
    service.busyPorts.add(4567);
    const status = await service.start({ projectRootUri: 'file:///project' });
    assert.equal(status.phase, 'running');
    assert.equal(status.port, 4568);
    assert.equal(status.url, 'http://127.0.0.1:4568');
    assert.deepEqual(service.spawnedArgs[0], ['/project', '--port', '4568', '--host', '127.0.0.1']);
});

test('(h2) ポート 4567〜4576 が全滅なら spawn せず failed', async () => {
    const service = new FakeService();
    for (let port = 4567; port <= 4576; port++) {
        service.busyPorts.add(port);
    }
    const status = await service.start({ projectRootUri: 'file:///project' });
    assert.equal(status.phase, 'failed');
    assert.match(status.failureSummary, /4567〜4576 がすべて使用中/);
    assert.equal(service.children.length, 0);
});

test('(i) 準備完了がタイムアウトすると failed になり子は kill される', async () => {
    const service = new FakeService();
    service.autoReady = false;
    service.readyTimeoutMs = 50;
    const status = await service.start({ projectRootUri: 'file:///project' });
    assert.equal(status.phase, 'failed');
    assert.match(status.failureSummary, /秒以内に起動しませんでした/);
    assert.equal(service.children[0].kills.length, 1);
});
