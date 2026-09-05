import assert from 'node:assert/strict';
import test from 'node:test';
import {
    audioClipFxOf,
    hasAudioClipFx,
    previewAudioSidecarRequestFor
} from '../lib/common/audio-clip-fx.js';

test('audioClipFxOf adopts clip FX for sfx and bgm without mutating the declaration', () => {
    const denoise = Object.freeze({ method: 'fft', strength: 0.6 });
    const raw = Object.freeze({ speed: 2, pitch_semitones: 7, formant: 'shift', denoise, lowcut_hz: 120, gain_db: -6 });
    for (const kind of ['sfx', 'bgm']) {
        assert.deepEqual(audioClipFxOf(raw, kind), { speed: 2, pitch_semitones: 7, formant: 'shift', denoise, lowcut_hz: 120 });
        assert.deepEqual(audioClipFxOf({ speed: 2, pitch_semitones: 7, denoise, lowcut_hz: 120 }, kind), {
            speed: 2, pitch_semitones: 7, denoise, lowcut_hz: 120
        });
        assert.deepEqual(audioClipFxOf({ formant: 'preserve' }, kind), { formant: 'preserve' });
    }
});

test('audioClipFxOf narration adopts only denoise and lowcut', () => {
    const denoise = { method: 'nlm', strength: 0.6 };
    assert.deepEqual(audioClipFxOf({ speed: 2, pitch_semitones: 7, formant: 'shift', denoise, lowcut_hz: 120 }, 'narration'), {
        denoise, lowcut_hz: 120
    });
    assert.deepEqual(audioClipFxOf({ speed: 2, pitch_semitones: 7, formant: 'shift' }, 'narration'), {});
});

test('audioClipFxOf ignores nonobjects and invalid field types or nonfinite numbers', () => {
    for (const raw of [undefined, null, false, 2, 'clip', [], {}]) {
        assert.deepEqual(audioClipFxOf(raw, 'sfx'), {});
    }
    for (const invalid of [undefined, null, false, '2', NaN, Infinity, -Infinity, {}, []]) {
        for (const field of ['speed', 'pitch_semitones', 'lowcut_hz']) {
            assert.deepEqual(audioClipFxOf({ [field]: invalid }, 'sfx'), {});
        }
    }
    for (const formant of ['invalid', true, 1, {}, null]) {
        assert.deepEqual(audioClipFxOf({ formant }, 'bgm'), {});
    }
    for (const denoise of [undefined, null, false, true, 'fft', 0, 1]) {
        assert.deepEqual(audioClipFxOf({ denoise }, 'sfx'), {});
    }
});

test('audioClipFxOf defers numeric range and denoise content normalization', () => {
    const raw = { speed: -2, pitch_semitones: 25, lowcut_hz: -1 };
    assert.deepEqual(audioClipFxOf(raw, 'sfx'), raw);
    for (const denoise of [{}, [], { method: 'unknown', strength: 2 }]) {
        assert.deepEqual(audioClipFxOf({ denoise }, 'sfx'), { denoise });
        assert.equal(hasAudioClipFx(audioClipFxOf({ denoise }, 'sfx')), false);
    }
});

test('hasAudioClipFx is false for defaults and formant alone', () => {
    for (const clipFx of [undefined, null, {}, { speed: 1, pitch_semitones: 0, formant: 'preserve', lowcut_hz: 0 }, { formant: 'shift' }]) {
        assert.equal(hasAudioClipFx(clipFx), false);
    }
});

test('hasAudioClipFx detects speed, pitch, denoise and lowcut independently', () => {
    for (const clipFx of [{ speed: 2 }, { speed: 0.5 }, { pitch_semitones: 7 }, { pitch_semitones: -7 }, { lowcut_hz: 120 }]) {
        assert.equal(hasAudioClipFx(clipFx), true);
    }
    for (const method of ['fft', 'nlm']) {
        for (const strength of [0, 0.6, 1]) {
            assert.equal(hasAudioClipFx({ denoise: { method, strength } }), true);
        }
    }
});

test('hasAudioClipFx normalizes invalid numeric values to defaults', () => {
    for (const invalid of [undefined, null, false, '2', NaN, Infinity, -Infinity]) {
        for (const field of ['speed', 'pitch_semitones', 'lowcut_hz']) {
            assert.equal(hasAudioClipFx({ [field]: invalid }), false);
        }
    }
    for (const speed of [0, -1]) assert.equal(hasAudioClipFx({ speed }), false);
    assert.equal(hasAudioClipFx({ lowcut_hz: -1 }), false);
});

test('hasAudioClipFx rejects denoise unless method and finite strength are valid', () => {
    for (const denoise of [undefined, null, false, true, 'fft', [], {}, { method: 'other', strength: 0.5 }]) {
        assert.equal(hasAudioClipFx({ denoise }), false);
    }
    for (const method of ['fft', 'nlm']) {
        for (const strength of [undefined, null, false, '0.6', -0.1, 1.1, NaN, Infinity, -Infinity]) {
            assert.equal(hasAudioClipFx({ denoise: { method, strength } }), false);
        }
    }
});

test('previewAudioSidecarRequestFor omits clipFx for default or inactive effects', () => {
    for (const clipFx of [{}, { speed: 1, pitch_semitones: 0, formant: 'preserve', lowcut_hz: 0 }, { formant: 'shift' }, { denoise: {} }]) {
        assert.deepEqual(previewAudioSidecarRequestFor(clipFx), { speed: 1 });
    }
});

test('previewAudioSidecarRequestFor forwards active effects and the declared speed', () => {
    assert.deepEqual(previewAudioSidecarRequestFor({ speed: 2 }), { speed: 2, clipFx: { speed: 2 } });
    for (const clipFx of [{ pitch_semitones: 7 }, { denoise: { method: 'fft', strength: 0 } }, { lowcut_hz: 120 }]) {
        assert.deepEqual(previewAudioSidecarRequestFor(clipFx), { speed: 1, clipFx });
    }
});
