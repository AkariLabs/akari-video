import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisHasSpeakers, captionPopupStepNames, channelPersonVoiceSampleCount, clearVoicesDecided,
    mergeVoicesDecided, parseVoicesSidecar, speakerReviewRows, speakerTranscribeOptions, voiceEngineReady,
    voiceGateBlocks } from '../lib/common/caption-popup-speakers.js';

test('ordinary transcription keeps four steps and adds no options', () => {
    assert.deepEqual(captionPopupStepNames(false), ['素材', '起こし方', '起こす', '仕上げ']);
    assert.deepEqual(speakerTranscribeOptions({ split: false, count: 'auto', identify: false }), {});
});

test('speaker transcription adds a review step and requested options', () => {
    assert.deepEqual(captionPopupStepNames(true), ['素材', '起こし方', '起こす', '話者を確かめる', '仕上げ']);
    assert.deepEqual(speakerTranscribeOptions({ split: true, count: '2', identify: true, people: ['p-one'] }),
        { diarize: true, speakers: '2', identify: true, people: ['p-one'] });
    assert.deepEqual(speakerTranscribeOptions({ split: true, count: 'auto', identify: false }),
        { diarize: true, speakers: 'auto', identify: false });
});

test('voice engine readiness and valid sample counts', () => {
    assert.equal(voiceEngineReady([]), false);
    assert.equal(voiceEngineReady([{ id: 'voice', available: false }]), false);
    assert.equal(voiceEngineReady([{ id: 'voice', available: true }]), true);
    assert.equal(channelPersonVoiceSampleCount(JSON.stringify({ entries: [{ id: 'p-one', voice: {
        samples: [{ file: 'a.wav' }, { file: 'b.wav' }, { bad: true }] } }] }), 'p-one'), 2);
});

test('analysis reports existing speaker tracks only for a nonempty array', () => {
    assert.equal(analysisHasSpeakers({ tracks: { speakers: [{ id: 'A' }] } }), true);
    for (const analysis of [undefined, {}, { tracks: {} }, { tracks: { speakers: [] } },
        { tracks: { speakers: 'A' } }]) {
        assert.equal(analysisHasSpeakers(analysis), false);
    }
});

test('voice engine gate applies only when speaker transcription will run', () => {
    const gate = (split, needsRun, availabilityLoaded, engineReady) =>
        voiceGateBlocks({ split, needsRun, availabilityLoaded, engineReady });
    assert.equal(gate(true, true, true, false), true);
    assert.equal(gate(true, false, true, false), false);
    assert.equal(gate(false, true, true, false), false);
    assert.equal(gate(true, true, false, false), false);
    assert.equal(gate(true, true, true, true), false);
});

test('sidecar parsing drops embedding and review uses spans and first speech', () => {
    const source = JSON.stringify({ schema: 'akari.voices/0', key: { model: 'test' }, speakers: {
        A: { seconds: 12, embedding: 'secret', suggestion: { name: '中島さん', person: 'channel/p-one', score: .86, level: 'strong' } }
    } });
    const voices = parseVoicesSidecar(source);
    assert.equal(JSON.stringify(voices).includes('secret'), false);
    const rows = speakerReviewRows(voices, { tracks: { speakers: [{ id: 'A', spans: [[1, 3]] }] },
        transcript: [{ speaker: 'A', text: 'こんにちは', start: 1, end: 3 }] });
    assert.deepEqual(rows[0].firstSpan, { start: 1, end: 3 });
    assert.equal(rows[0].firstLine, 'こんにちは');
    assert.equal(rows[0].seconds, 12);
    assert.equal(speakerReviewRows(undefined, { tracks: { speakers: [{ id: 'B', spans: [[1, 3], { start: 5, end: 8 }] }] } })[0].seconds, 5);
});

test('deciding a person preserves other sidecar keys and name only makes no change', () => {
    const raw = JSON.stringify({ schema: 'akari.voices/0', key: { model: 'test' }, speakers: { A: { embedding: 'secret' } }, decided: { B: 'x' } });
    const merged = JSON.parse(mergeVoicesDecided(raw, 'A', 'channel/p-one'));
    assert.deepEqual(merged.decided, { A: 'channel/p-one', B: 'x' });
    assert.equal(merged.speakers.A.embedding, 'secret');
    assert.deepEqual(JSON.parse(mergeVoicesDecided(raw, 'A', undefined)), JSON.parse(raw));
    assert.deepEqual(JSON.parse(clearVoicesDecided(raw, 'B')).decided, {});
});
