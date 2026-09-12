import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    SPEAKER_COLORS, parseSpeakerDictionary, speakerColorMap, speakerLabel
} = require('../lib/browser/daihon/daihon-speaker-chips.js');

test('話者色は null 行を飛ばし、出現順で 6 色をローテーションする', () => {
    const rows = [null, 'b', 'a', 'b', 'c', 'd', 'e', 'f', 'g'].map(speaker => ({ speaker }));
    const colors = speakerColorMap(rows);
    assert.deepEqual([...colors.keys()], ['b', 'a', 'c', 'd', 'e', 'f', 'g']);
    assert.deepEqual([...colors.values()], [...SPEAKER_COLORS, SPEAKER_COLORS[0]]);
});

test('辞書は string と name を表示名にし、配列形・未知 id はキー名を保つ', () => {
    const dictionary = parseSpeakerDictionary(JSON.stringify({ speakers: {
        a: '明里', b: { name: '番場' }, c: [{ hear: '語', write: '語' }]
    } }));
    assert.equal(speakerLabel('a', dictionary), '明里');
    assert.equal(speakerLabel('b', dictionary), '番場');
    assert.equal(speakerLabel('c', dictionary), 'c');
    assert.equal(speakerLabel('missing', dictionary), 'missing');
    assert.deepEqual(parseSpeakerDictionary('{broken'), {});
    assert.deepEqual(parseSpeakerDictionary(JSON.stringify({ speakers: [] })), {});
});
