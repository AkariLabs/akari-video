import test from 'node:test';
import assert from 'node:assert/strict';
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
