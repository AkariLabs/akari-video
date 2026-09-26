import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { previewSelectionSeekTime } from '../lib/common/preview-selection-seek.js';

const input = { range: [5, 8], playhead: 1, playing: false, multiple: false, origin: 'single' };

test('a paused single selection seeks to the item start only when outside', () => {
    assert.equal(previewSelectionSeekTime(input), 5);
    assert.equal(previewSelectionSeekTime({ ...input, playhead: 6 }), undefined);
    assert.equal(previewSelectionSeekTime({ ...input, playhead: 8 }), 5);
});

test('playback, added selections, marquee, all and history restoration do not seek', () => {
    assert.equal(previewSelectionSeekTime({ ...input, playing: true }), undefined);
    assert.equal(previewSelectionSeekTime({ ...input, multiple: true }), undefined);
    for (const origin of ['marquee', 'all', 'history']) {
        assert.equal(previewSelectionSeekTime({ ...input, origin }), undefined);
    }
});

test('applySelection applies the timeline and inspector before a seek that never ticks', () => {
    const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
    const start = source.indexOf('    applySelection(selection, notifyPreview = true, directSingle = false) {');
    const end = source.indexOf('    publishPrimaryPreviewSelection(selection) {', start);
    assert.ok(start >= 0 && end > start);
    const applySelection = vm.runInNewContext(`({${source.slice(start, end)}}).applySelection`, {
        preview_selection_seek_1: { previewSelectionSeekTime }
    });
    const events = [];
    const selection = { kind: 'caption', id: 'caption-a' };
    const widget = {
        playheadT: 6, visualPlaying: false, multiSelection: [], selection: undefined,
        focusRangeFor: () => [0, 3], selectionKey: value => value?.id ?? '',
        exitTrimmerModeUnlessSelected() {}, claimInspectorOwner() { events.push('owner'); },
        pushSelectionSnapshot() { events.push('snapshot'); },
        applySelectionClass() { events.push('class'); },
        publishPrimaryPreviewSelection() { events.push('preview'); },
        revealOutputPreview() { events.push('reveal'); },
        requestSeek(time) { events.push(`seek:${time}`); return new Promise(() => {}); }
    };
    applySelection.call(widget, selection, true, true);
    assert.equal(widget.selection, selection);
    assert.deepEqual(events, ['owner', 'snapshot', 'class', 'preview', 'reveal', 'seek:0']);
});
