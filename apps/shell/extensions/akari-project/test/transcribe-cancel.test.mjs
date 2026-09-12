import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

class Service extends AkariProjectServiceImpl {
    constructor(script) { super(); this.script = script; }
    async findMediaTool() { return this.script; }
    async resolveFfmpegPath() { return undefined; }
    async resolveFfprobePath() { return undefined; }
}

async function until(condition, timeout = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        if (await condition()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('timeout');
}

async function fixture(t, ignoreTerm) {
    const root = await mkdtemp(join(tmpdir(), 'transcribe-cancel-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets/voice.wav'), 'fixture');
    const ready = join(root, 'ready');
    const script = join(root, 'media.mjs');
    await writeFile(script, [
        "import { writeFile } from 'node:fs/promises';",
        ignoreTerm ? "process.on('SIGTERM', () => {});" : '',
        `await writeFile(${JSON.stringify(ready)}, String(process.pid));`,
        'setInterval(() => {}, 1000);'
    ].join('\n'));
    return { root, ready, service: new Service(script), request: { projectRoot: root, relativePath: 'assets/voice.wav' } };
}

async function recordedEvents(root) {
    const directory = join(root, '.akari/events');
    return Promise.all((await readdir(directory)).map(async name => JSON.parse(await readFile(join(directory, name), 'utf8'))));
}

for (const [label, ignoreTerm] of [['SIGTERM', false], ['3 秒後の SIGKILL', true]]) {
    test(`cancelTranscribe は実子プロセスを ${label} で止め cancelled イベントを記録する`, { timeout: 9000 }, async t => {
        const { root, ready, service, request } = await fixture(t, ignoreTerm);
        const running = service.transcribeMaterial(request);
        const rejected = assert.rejects(running, /文字起こしを中止しました/);
        await until(async () => readFile(ready, 'utf8').then(() => true, () => false));
        const pid = Number(await readFile(ready, 'utf8'));
        const started = Date.now();
        await service.cancelTranscribe(request);
        await rejected;
        assert.throws(() => process.kill(pid, 0), error => error?.code === 'ESRCH');
        if (ignoreTerm) assert.ok(Date.now() - started >= 2800, 'SIGKILL grace period must elapse');
        const events = await recordedEvents(root);
        assert.ok(events.some(event => event.status === 'cancelled' && event.stage === 'transcribing'));
        assert.ok(events.some(event => event.status === 'cancelled' && event.stage === 'completed'));
    });
}
