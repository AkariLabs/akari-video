import assert from 'node:assert/strict';
import test from 'node:test';
import { captionRecordingsFromEdit, recordedBadge } from '../lib/common/daihon-recordings.js';

test('v2 caption recordings resolve paths, engines, frame times, and sort each line', () => {
    const edit = {
        sources: [{ id: 'take-a', path: 'audio/afreco-first.wav' }, { id: 'take-b', path: 'audio/afreco-last.wav' }],
        tracks: [{ items: [
            { id: 'mic-late', role: 'speech', at: 375, caption_ref: 'c-1', script: '元の文',
                provenance: { provider: 'human', engine: 'microphone' }, source: { src: 'take-b' } },
            { id: 'tts', role: 'narration', at: 300, caption_ref: 'c-1',
                provenance: { provider: 'voicevox' }, source: { src: 'missing' } },
            { id: 'mic-early', role: 'speech', at: 150, caption_ref: 'c-1', script: '元の文',
                provenance: { provider: 'human', engine: 'microphone' }, source: { src: 'take-a' } },
            { id: 'unlinked', role: 'speech', at: 75, provenance: { engine: 'microphone' } },
            { id: 'music', role: 'music', at: 30, caption_ref: 'c-1' }
        ] }] };
    const result = captionRecordingsFromEdit(edit, 30);
    assert.deepEqual([...result.keys()], ['c-1']);
    assert.deepEqual(result.get('c-1'), [
        { itemId: 'mic-early', atSec: 5, engine: 'microphone', script: '元の文', path: 'audio/afreco-first.wav' },
        { itemId: 'tts', atSec: 10, engine: 'tts' },
        { itemId: 'mic-late', atSec: 12.5, engine: 'microphone', script: '元の文', path: 'audio/afreco-last.wav' }
    ]);
});

test('legacy narration is included and malformed records are skipped', () => {
    const edit = { tracks: [{ items: null }, null, { items: [
        { id: 'bad', role: 'speech', at: '30', caption_ref: 'c-1' },
        { id: 'bad-2', role: 'speech', at: NaN, caption_ref: 'c-1' }
    ] }], audio: { narration: [
        { id: 'legacy', t: 2.25, caption_ref: 'c-2', path: 'voice/line.wav', script: '読む', provenance: { provider: 'voicevox' } },
        { id: 'no-time', t: '3', caption_ref: 'c-2' },
        { id: 'no-ref', t: 4 }, null
    ] } };
    assert.deepEqual([...captionRecordingsFromEdit(edit, 30)], [['c-2', [
        { itemId: 'legacy', atSec: 2.25, engine: 'tts', script: '読む', path: 'voice/line.wav' }
    ]]]);
    assert.equal(captionRecordingsFromEdit(null, 30).size, 0);
    assert.equal(captionRecordingsFromEdit({ tracks: 'bad', audio: { narration: {} } }, 30).size, 0);
    assert.equal(captionRecordingsFromEdit({ tracks: [{ items: [
        { id: 'v2', role: 'speech', at: 30, caption_ref: 'c-1' }
    ] }] }, 0).size, 0);
});

test('recorded badge counts microphones, detects stale script, and formats seek time', () => {
    const first = { itemId: 'first', atSec: 5, engine: 'microphone', script: '同じ 文', path: 'audio/afreco-first.wav' };
    const tts = { itemId: 'tts', atSec: 10, engine: 'tts' };
    const last = { itemId: 'last', atSec: 12.5, engine: 'microphone', script: '前の文', path: 'C:\\takes\\afreco-last.wav' };
    assert.equal(recordedBadge(undefined, '文'), undefined);
    assert.equal(recordedBadge([tts], '文'), undefined);
    assert.deepEqual(recordedBadge([first], '同じ文'), {
        label: '🎙 録音済み', stale: false,
        title: '録音 1 本 · 最新 00:05.0（afreco-first.wav）。押すとその位置へ', atSec: 5
    });
    assert.deepEqual(recordedBadge([first, tts, last], '今の文'), {
        label: '🎙 録音済み ×2 · 文が変わりました', stale: true,
        title: '録音 2 本 · 最新 00:12.5（afreco-last.wav）。押すとその位置へ', atSec: 12.5
    });
    assert.equal(recordedBadge([{ itemId: 'bare', atSec: 65, engine: 'microphone' }], '文')?.title,
        '録音 1 本 · 最新 01:05.0。押すとその位置へ');
});
