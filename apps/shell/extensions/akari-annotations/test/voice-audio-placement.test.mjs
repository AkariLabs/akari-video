import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { voiceAudioPatch } from '../lib/common/voice-audio-patch.js';
import { insertAudioSfxPreferV2, insertTrack, updateItem } from '../lib/common/edit-v2-mutations.js';
import { toV2Edit } from './helpers/v2-fixture.mjs';

test('voiceTrack placement keeps speech metadata in one v2 document', () => {
    let edit = toV2Edit({ cuts: [{ in: 0, out: 20 }] });
    edit = insertTrack(edit, { index: 0, lane: 'audio' });
    const trackId = edit.tracks[0].id;
    edit.sources.push({ id: 'voice', path: 'assets/afreco/test.wav' });
    edit = insertAudioSfxPreferV2(edit, { trackId,
        item: { id: 'audio-1', role: 'speech', at: 375, duration: 120,
            source: { kind: 'media', src: 'voice', in: 0, out: 4 } },
        legacyItem: { id: 'audio-1', path: 'assets/afreco/test.wav', t: 12.5, track: 0 }
    });
    edit = updateItem(edit, { itemId: 'audio-1', patch: voiceAudioPatch({
        in: .25, denoise: { method: 'fft', strength: .5 }, script: '読む文',
        captionRef: 'c-0001', provenance: { provider: 'human', engine: 'microphone' }
    }, 4, 30) });
    assert.deepEqual(edit.tracks[0].items[0], {
        id: 'audio-1', role: 'speech', at: 375, duration: 113,
        source: { kind: 'media', src: 'voice', in: .25, out: 4 },
        denoise: { method: 'fft', strength: .5 }, script: '読む文',
        caption_ref: 'c-0001', provenance: { provider: 'human', engine: 'microphone' }
    });
    assert.deepEqual(voiceAudioPatch({ in: 0 }, 4, 30), {});
    const widgetSource = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
    assert.match(widgetSource, /createAudioTrack: voiceTrack, voiceTrack, audio/u);
    assert.match(widgetSource, /updateV2Item\(value, \{ itemId, patch: voiceAudioPatch\(options\.audio, durationSeconds, this\.fps\) \}\)/u);
});
