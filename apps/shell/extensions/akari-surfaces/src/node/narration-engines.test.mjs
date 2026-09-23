import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NarrationCli } from '../../lib/node/narration-engines.js';

test('narration RPC は Electron node モードで CLI を呼び、鍵を返さず状態と操作を渡す', async () => {
    const calls = [];
    const spawnImpl = (command, args, options) => {
        calls.push([command, args, options]);
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        queueMicrotask(() => {
            child.stdout.emit('data', Buffer.from(JSON.stringify(args.includes('engines')
                ? { engines: [{ id: 'voicevox', availability: { state: 'needs', detail: { running: false, app_found: true } } }] }
                : { status: 'ok' })));
            child.emit('close', 0);
        });
        return child;
    };
    const cli = new NarrationCli({ env: { AKARI_GENERATE_CLI: '/fake/akari.mjs', FAL_KEY: 'never-expose' }, spawnImpl });
    const list = await cli.narrationEngines('http://127.0.0.1:4567');
    assert.equal(list.engines[0].availability.detail.app_found, true);
    assert.equal(JSON.stringify(list).includes('never-expose'), false);
    await cli.startNarrationEngine('voicevox');
    await cli.stopNarrationEngine('voicevox');
    assert.deepEqual(calls.filter(([, args]) => args[1] === 'narration').map(([, args]) => args.slice(2)), [
        ['engines', '--irodori-url', 'http://127.0.0.1:4567', '--json'], ['start', '--engine', 'voicevox', '--json'], ['stop', '--engine', 'voicevox', '--json']
    ]);
    assert.ok(calls.filter(([, args]) => args[1] === 'narration').every(([, , options]) => options.env.ELECTRON_RUN_AS_NODE === '1'));
});

test('VOICEVOX 試聴は一時プロジェクトの wav を data URL にして片付ける', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-rpc-test-'));
    try {
        const cli = new NarrationCli({ tempRoot: scratch, env: { AKARI_GENERATE_CLI: '/fake/akari.mjs' },
            spawnImpl: (command, args) => {
                const child = new EventEmitter();
                child.stdout = new EventEmitter();
                child.stderr = new EventEmitter();
                queueMicrotask(async () => {
                    const project = args[args.indexOf('--project') + 1];
                    await mkdir(join(project, 'out/narration'), { recursive: true });
                    await writeFile(join(project, 'out/narration/n-0001.wav'), Buffer.from('RIFFfake'));
                    child.stdout.emit('data', Buffer.from(JSON.stringify({ path: 'out/narration/n-0001.wav' })));
                    child.emit('close', 0);
                });
                return child;
            } });
        const url = await cli.previewVoicevox();
        assert.equal(url, `data:audio/wav;base64,${Buffer.from('RIFFfake').toString('base64')}`);
    } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('brew が存在して cask が無いときは追加探索せず公式サイト導線になる', async () => {
    const calls = [];
    const cli = new NarrationCli({ env: { AKARI_GENERATE_CLI: '/fake/akari.mjs' },
        spawnImpl: (command, args) => {
            calls.push([command, args]);
            const child = new EventEmitter();
            child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
            queueMicrotask(() => {
                if (args[1] === 'narration') child.stdout.emit('data', Buffer.from(JSON.stringify({ engines: [] })));
                child.emit('close', command === 'brew' ? 1 : 0);
            });
            return child;
        } });
    assert.equal((await cli.narrationEngines()).voicevoxCaskAvailable, false);
    assert.equal(calls.filter(([, args]) => args[0] === 'info').length, 1);
});
