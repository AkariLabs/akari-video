import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { NarrationCliManager } from '../lib/node/narration-cli.js';

for (const engine of ['gemini-tts', 'fal-qwen3']) {
    test(`${engine}: 未承認なら spawn せず費用承認エラーを返す`, async () => {
        let spawned = 0;
        const manager = new NarrationCliManager(() => { spawned++; throw new Error('spawn must not run'); });
        const request = {
            projectRootUri: 'file:///unused', engine, voice: 'Leda', script: '表示原稿',
            reading: '読み原稿', t: 0, approved: false
        };
        await assert.rejects(manager.generate(request, '/unused'), /費用承認が必要です。/);
        await assert.rejects(manager.generate({ ...request, approved: undefined }, '/unused'), /費用承認が必要です。/);
        assert.equal(spawned, 0);
    });
}

test('彩 RPC は engines・voices・generate へ設定 URL と声の指示を渡す', async () => {
    const oldCli = process.env.AKARI_GENERATE_CLI;
    process.env.AKARI_GENERATE_CLI = '/fake/akari.mjs';
    const calls = [];
    try {
        const manager = new NarrationCliManager((_command, args) => {
            calls.push(args);
            const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
            queueMicrotask(() => { child.stdout.emit('data', Buffer.from('{"status":"ok"}')); child.emit('close', 0); });
            return child;
        });
        await manager.engines('http://127.0.0.1:4567');
        await manager.voices('irodori', 'http://127.0.0.1:4567');
        await manager.generate({ engine: 'irodori', voice: 'custom', style: '低い声', speed: 1.5,
            script: 'こんにちは', reading: 'こんにちは', t: 0, irodoriUrl: 'http://127.0.0.1:4567' }, '/unused');
        assert.ok(calls.every(args => args.includes('--irodori-url') && args[args.indexOf('--irodori-url') + 1] === 'http://127.0.0.1:4567'));
        assert.ok(calls[2].includes('--style') && calls[2].includes('低い声'));
        assert.ok(calls[2].includes('--speed') && calls[2].includes('1.5'));
    } finally {
        if (oldCli === undefined) delete process.env.AKARI_GENERATE_CLI; else process.env.AKARI_GENERATE_CLI = oldCli;
    }
});
