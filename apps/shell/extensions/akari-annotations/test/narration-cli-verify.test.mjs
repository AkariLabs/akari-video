import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { NarrationCliManager } from '../lib/node/narration-cli.js';

test('RPC は VOICEVOX start、backend 確認、ローカル verify を CLI に渡す', async () => {
    const prior = process.env.AKARI_GENERATE_CLI;
    process.env.AKARI_GENERATE_CLI = '/fake/akari.mjs';
    const calls = [];
    try {
        const manager = new NarrationCliManager((_command, args) => {
            calls.push(args.slice(1));
            const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
            queueMicrotask(() => {
                child.stdout.emit('data', JSON.stringify(args.includes('--check-backend')
                    ? { status: 'unavailable', reason: 'backend missing' } : { status: 'ok' }));
                child.emit('close', args.includes('--check-backend') ? 3 : 0);
            });
            return child;
        });
        assert.equal((await manager.start('voicevox')).status, 'ok');
        await assert.rejects(manager.start('irodori'), /VOICEVOX/);
        assert.deepEqual(await manager.verificationBackend('/project'), { status: 'unavailable', reason: 'backend missing' });
        assert.equal((await manager.verify({ audio: 'out/narration/n-0001.wav', text: '字幕', reading: '読み' }, '/project')).status, 'ok');
        assert.deepEqual(calls[0], ['narration', 'start', '--engine', 'voicevox', '--json']);
        assert.deepEqual(calls[1], ['narration', 'verify', '--project', '/project', '--check-backend', '--json']);
        assert.deepEqual(calls[2], ['narration', 'verify', '--project', '/project', '--audio', 'out/narration/n-0001.wav',
            '--text', '字幕', '--reading', '読み', '--json']);
    } finally {
        if (prior === undefined) delete process.env.AKARI_GENERATE_CLI; else process.env.AKARI_GENERATE_CLI = prior;
    }
});
