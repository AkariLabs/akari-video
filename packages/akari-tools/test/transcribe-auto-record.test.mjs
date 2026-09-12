import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { transcribeMedia } from '../src/media/transcribe.mjs';
import { fixture, json } from './fixtures/transcribe-compare/helpers.mjs';

test('backend 未指定の auto は解決 backend 名で transcripts に記録し auto.json を作らない', async t => {
    const f = await fixture(t, []);
    const result = await transcribeMedia(f.target, {
        ...f.options,
        speechAnalyzerAvailable: true,
        unrecognized: false,
        backendRunner: async ({ backend }) => {
            assert.equal(backend, 'speech-analyzer');
            return [{ start: 0, end: 1, text: '発話' }];
        }
    });
    assert.equal(result.backend, 'speech-analyzer');
    assert.deepEqual(await readdir(path.join(f.directory, 'transcripts')), ['speech-analyzer.json']);
    assert.equal(existsSync(path.join(f.directory, 'transcripts/auto.json')), false);
    assert.equal((await json(path.join(f.directory, 'transcripts/speech-analyzer.json'))).backend, 'speech-analyzer');
});
