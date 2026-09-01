import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { replaceCaptionLine } = require('../../lib/browser/akari-block-writeback.js');

test('caption block writeback は未編集語の words と他行 bytes を温存する', () => {
    const records = [
        {
            id: 'c-0001', start: 0, end: 3, text: 'alpha beta gamma', speaker: null,
            sourceRef: null, edited: false, style: 'karaoke',
            words: [
                { start: 0.1, end: 0.7, text: 'alpha' },
                { start: 0.8, end: 1.6, text: 'beta' },
                { start: 1.7, end: 2.9, text: 'gamma' },
            ],
        },
        { id: 'c-0002', start: 3, end: 4, text: 'untouched', speaker: null, sourceRef: null, edited: false },
    ];
    const source = `[\n  ${JSON.stringify(records[0])},\n  ${JSON.stringify(records[1])}\n]\n`;
    const updated = replaceCaptionLine(source, 'c-0001', 'alpha delta gamma');
    const result = JSON.parse(updated);

    assert.deepEqual(result[0].words[0], records[0].words[0]);
    assert.deepEqual(result[0].words[2], records[0].words[2]);
    assert.equal(result[0].words[1].text, 'delta');
    assert.equal(updated.split('\n')[2], source.split('\n')[2]);
});
