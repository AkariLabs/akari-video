import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    AUDIO_CLIP_FX_RANGES,
    assertAudioClipFxValue,
    audioClipFxFieldsForSnapshot,
    buildAudioClipFxPatch,
    createAudioClipFxWriteRequest,
    updateAudioClipFxDocument
} from '../lib/browser/inspector/audio-clip-fx.js';
import { audioDocument, audioSnapshot, fxSections, handleAudioClipFxWrite } from './helpers/audio-clip-fx-fixture.mjs';

const timelineSource = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');

test('clip FX の patch は v2 source / item と legacy 平置きを区別する', () => {
    for (const [field, value, source] of [
        ['speed', 2, true], ['pitch_semitones', 7.5, true], ['formant', 'shift', true],
        ['denoise', { method: 'fft', strength: 0.6 }, false], ['lowcut_hz', 120, false]
    ]) {
        assert.deepEqual(buildAudioClipFxPatch('sfx', field, value), {
            itemPatch: source ? { source: { [field]: value } } : { [field]: value },
            legacyPatch: { [field]: value }
        });
    }
});

test('既定値と reset は全 5 キーを null patch にする', () => {
    for (const [field, defaultValue] of [
        ['speed', 1], ['pitch_semitones', 0], ['formant', 'preserve'],
        ['lowcut_hz', 0], ['denoise', 'off']
    ]) {
        for (const value of [defaultValue, null]) {
            const { itemPatch, legacyPatch } = buildAudioClipFxPatch('bgm', field, value);
            assert.deepEqual(legacyPatch, { [field]: null });
            assert.deepEqual(itemPatch, ['speed', 'pitch_semitones', 'formant'].includes(field)
                ? { source: { [field]: null } } : { [field]: null });
        }
    }
});

test('数値の境界と小数ピッチを許可し、範囲外・非有限値・型違いを拒否する', () => {
    assert.equal(AUDIO_CLIP_FX_RANGES.speed.exclusiveMin, true);
    for (const [field, accepted, rejected] of [
        ['speed', [0.25001, 1, 4], [0.25, 0, 4.01]],
        ['pitch_semitones', [-24, 0.5, 24], [-24.1, 24.1]],
        ['strength', [0, 0.6, 1], [-0.01, 1.01]],
        ['lowcut_hz', [0, 120, 400], [-1, 500]]
    ]) {
        for (const value of accepted) assert.doesNotThrow(() => assertAudioClipFxValue(field, value));
        for (const value of [...rejected, NaN, Infinity, -Infinity, '1', undefined]) {
            assert.throws(() => assertAudioClipFxValue(field, value), /範囲/);
        }
    }
});

test('ナレーションの速度・ピッチ・フォルマントは reset も拒否する', () => {
    for (const [field, value] of [['speed', 2], ['pitch_semitones', 7], ['formant', 'shift']]) {
        for (const input of [value, null]) {
            assert.throws(() => buildAudioClipFxPatch('narration', field, input),
                /ナレーションの速度・ピッチは TTS 側で調整します/);
        }
    }
    assert.doesNotThrow(() => buildAudioClipFxPatch('narration', 'lowcut_hz', 120));
});

test('denoise は常に対で書き、method 既定 fft / strength 既定 0.5 を補う', () => {
    const snapshot = audioSnapshot();
    assert.deepEqual(createAudioClipFxWriteRequest(snapshot, 'denoise-method', 'FFT').value,
        { method: 'fft', strength: 0.5 });
    assert.deepEqual(createAudioClipFxWriteRequest(snapshot, 'denoise-strength', '0.6').value,
        { method: 'fft', strength: 0.6 });
    const enabled = audioSnapshot('sfx', { denoise: { method: 'nlm', strength: 0 } });
    assert.deepEqual(createAudioClipFxWriteRequest(enabled, 'denoise-method', 'FFT').value,
        { method: 'fft', strength: 0 });
    assert.deepEqual(createAudioClipFxWriteRequest(enabled, 'denoise-strength', '0.6').value,
        { method: 'nlm', strength: 0.6 });
    assert.equal(createAudioClipFxWriteRequest(enabled, 'denoise-method', 'オフ').value, null);
    for (const invalid of [{ method: 'fft' }, { strength: 0.5 }, { method: 'bad', strength: 0.5 },
        { method: 'fft', strength: 2 }, { method: 'fft', strength: 0.5, extra: true }, []]) {
        assert.throws(() => buildAudioClipFxPatch('sfx', 'denoise', invalid));
    }
    assert.throws(() => buildAudioClipFxPatch('sfx', 'formant', 'bad'), /フォルマント/);
});

for (const audioKind of ['sfx', 'bgm', 'narration']) {
    for (const v2 of [true, false]) {
        test(`${audioKind} ${v2 ? 'v2' : 'legacy'} の保存・reset は未知キーと時刻を保持する`, () => {
            const original = audioDocument(audioKind, v2);
            const before = structuredClone(original);
            let doc = original;
            const values = [
                ...(audioKind === 'narration' ? [] : [['speed', 2], ['pitch_semitones', 7], ['formant', 'shift']]),
                ['denoise', { method: 'fft', strength: 0.6 }], ['lowcut_hz', 120]
            ];
            for (const [field, value] of values) {
                doc = updateAudioClipFxDocument(doc, { kind: 'audio-clip-fx', id: 'clip', audioKind, field, value });
                const entry = v2 ? doc.tracks[0].items[0]
                    : audioKind === 'bgm' ? doc.audio.bgm : doc.audio[audioKind][0];
                assert.deepEqual(v2 && ['speed', 'pitch_semitones', 'formant'].includes(field)
                    ? entry.source[field] : entry[field], value);
            }
            assert.deepEqual(original, before);
            for (const [field] of values) {
                doc = updateAudioClipFxDocument(doc, {
                    kind: 'audio-clip-fx', id: 'clip', audioKind, field,
                    value: field === 'denoise' ? 'off' : AUDIO_CLIP_FX_RANGES[field].default
                });
            }
            assert.deepEqual(doc, before);
        });
    }
}

test('v2 内の legacy 音声も新キーを失わず、BGM を同名 sfx へ誤配送しない', () => {
    for (const audioKind of ['sfx', 'bgm', 'narration']) {
        const doc = { ...audioDocument(audioKind, false), version: 2, tracks: [] };
        const result = updateAudioClipFxDocument(doc, {
            kind: 'audio-clip-fx', id: 'clip', audioKind, field: 'lowcut_hz', value: 120
        });
        assert.equal((audioKind === 'bgm' ? result.audio.bgm : result.audio[audioKind][0]).lowcut_hz, 120);
    }
    assert.throws(() => updateAudioClipFxDocument({ version: 2, tracks: [], audio: { sfx: [{ id: 'bgm' }] } }, {
        kind: 'audio-clip-fx', id: 'bgm', audioKind: 'bgm', field: 'speed', value: 2
    }), /audio.bgm/);
});

test('snapshot は未定義キーを省き、ゼロ・既定値と denoise を保持する', () => {
    assert.deepEqual(audioClipFxFieldsForSnapshot({}), {});
    const raw = { speed: 1, pitch_semitones: 0, formant: 'preserve',
        denoise: { method: 'nlm', strength: 0 }, lowcut_hz: 0 };
    assert.deepEqual(audioClipFxFieldsForSnapshot(raw), {
        speed: 1, pitchSemitones: 0, formant: 'preserve', denoise: raw.denoise, lowcutHz: 0
    });
    for (const variable of ['sfx', 'narration', 'this.audioBgm']) {
        assert.ok(timelineSource.includes(`...audioClipFxFieldsForSnapshot(${variable})`));
    }
});

test('実働行は値・reset を単一 audio-clip-fx kind に対応付ける', async () => {
    const snapshot = audioSnapshot();
    const requests = [];
    const rows = fxSections(snapshot, async request => { requests.push(request); return { ok: true }; })
        .flatMap(section => section.fields);
    for (const [name, input, field, value] of [
        ['audio-speed', '2', 'speed', 2], ['audio-pitch', '7', 'pitch_semitones', 7],
        ['audio-formant', '移動', 'formant', 'shift'],
        ['audio-denoise-method', 'FFT', 'denoise', { method: 'fft', strength: 0.5 }],
        ['audio-lowcut', '120', 'lowcut_hz', 120]
    ]) {
        const row = rows.find(candidate => candidate.name === name);
        assert.deepEqual(await row.write(snapshot, input), { ok: true });
        assert.deepEqual(requests.at(-1), { kind: 'audio-clip-fx', id: 'clip', audioKind: 'sfx', field, value });
        await row.reset(snapshot);
        assert.equal(requests.at(-1).value, null);
        assert.equal(row.liveField, undefined);
    }
    assert.equal(rows.find(row => row.name === 'audio-speed').getValue(snapshot), '1.00');
    assert.equal(rows.find(row => row.name === 'audio-denoise-strength').disabled, true);
    const invalid = await rows.find(row => row.name === 'audio-lowcut').write(snapshot, '500');
    assert.equal(invalid.ok, false);
    assert.match(invalid.message, /0〜400/);
    const voice = rows.at(-1);
    assert.equal(voice.label, 'ボイス分離');
    assert.equal(voice.getValue(snapshot), '近日');
    assert.equal(voice.disabled, true);
});

function handlerContext(document) {
    let text = JSON.stringify(document);
    const context = {
        editDocument: document, location: { editUri: 'edit.json' }, footer: {}, history: [],
        fileService: { readFile: async () => ({ value: text }) },
        writeEditSnapshotGuarded: async value => { text = value; },
        pushHistory: entry => context.history.push(entry),
        reloadEdit: async () => { context.editDocument = JSON.parse(text); },
        hideNotice() {}, showNotice() {}, errorMessage: error => error.message,
        getDocument: () => JSON.parse(text)
    };
    return context;
}

test('legacy handler は保存・undo・redo を実行し BGM の未知キーを保つ', async () => {
    const original = audioDocument('bgm', false);
    const context = handlerContext(original);
    const request = createAudioClipFxWriteRequest(audioSnapshot('bgm'), 'speed', '2');
    assert.deepEqual(await handleAudioClipFxWrite.call(context, request), { ok: true });
    assert.equal(context.getDocument().audio.bgm.speed, 2);
    assert.equal(context.history.length, 1);
    await context.history[0].undo();
    assert.deepEqual(context.getDocument(), original);
    await context.history[0].redo();
    assert.equal(context.getDocument().audio.bgm.speed, 2);
    assert.deepEqual(context.getDocument().audio.bgm.future, { keep: true });
});

test('handler は v2 では既存 commitEditMutation を使い、不正値と read-only は ok:false', async () => {
    const context = handlerContext(audioDocument());
    let commits = 0;
    context.commitEditMutation = async (_label, mutate) => {
        const next = mutate(context.editDocument);
        await context.writeEditSnapshotGuarded(JSON.stringify(next));
        await context.reloadEdit();
        commits++;
    };
    const request = createAudioClipFxWriteRequest(audioSnapshot(), 'speed', '2');
    assert.deepEqual(await handleAudioClipFxWrite.call(context, request), { ok: true });
    assert.equal(commits, 1);
    assert.equal(context.getDocument().tracks[0].items[0].source.speed, 2);
    for (const [change, message] of [
        [{ field: 'lowcut_hz', value: 500 }, /0〜400/],
        [{ audioKind: 'narration' }, /TTS/]
    ]) {
        const result = await handleAudioClipFxWrite.call(context, { ...request, ...change });
        assert.equal(result.ok, false);
        assert.match(result.message, message);
    }
    context.legacyReadOnly = true;
    const result = await handleAudioClipFxWrite.call(context, request);
    assert.equal(result.ok, false);
    assert.match(result.message, /古い edit.json を読み取り専用/);
    assert.equal(commits, 1);
    assert.match(timelineSource, /request.kind === 'audio-clip-fx'[\s\S]{0,180}handleAudioClipFxWrite/);
});
