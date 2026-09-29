import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('audio status initializes before the later playback declaration without a TDZ error', () => {
    const statusStart = source.indexOf('                const audioStatus = document.getElementById');
    const statusEnd = source.indexOf('                const updateAudio = message => {', statusStart);
    const firstUpdate = source.indexOf('                updateAudioStatus();\n                window.akariFrameEngineAudioDebug', statusEnd);
    const playbackDeclaration = source.indexOf('                let playing = false;', statusEnd);
    assert.ok(statusStart >= 0 && statusEnd > statusStart);
    assert.ok(firstUpdate > statusEnd && playbackDeclaration > firstUpdate,
        'the first status update runs before the playback declaration in the webview');

    const audioStatus = { textContent: '', hidden: true };
    const supply = { phase: 'ready', required: ['bgm:bed'], ready: ['bgm:bed'],
        failed: [], noAudio: [], gate: { holding: false, heldMs: 0 } };
    const script = `(() => {
        ${source.slice(statusStart, statusEnd)}
        updateAudioStatus();
        let playing = false;
        return audioStatus.hidden;
    })()`;
    const hidden = vm.runInNewContext(script, {
        document: { getElementById: () => audioStatus },
        audioSupply: { debug: () => ({ playing: false, supply }) },
        disposed: false,
        performance: { now: () => 0 },
    });
    assert.equal(hidden, true);
    assert.equal(audioStatus.textContent, '');
});
