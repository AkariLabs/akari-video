import assert from 'node:assert/strict';
import test from 'node:test';
import { captionPaintOnlyChange } from '../lib/common/caption-paint-only-change.js';

const source = JSON.stringify({ captions: [{ id: 'c-0006', start: 7, end: 9,
    text: 'これ、AIと対話する', style_preset: 'plate-coral', text_style: { color: '#facc15' } }] });

test('paint edits can update the inspector without resolving every cue again', () => {
    const root = JSON.parse(source);
    root.captions[0].text_style = { color: '#FB923C', weight: 900, italic: true,
        background: { color: '#000000', opacity: 0 } };
    assert.equal(captionPaintOnlyChange(source, JSON.stringify(root)), true);
});

test('text, preset, geometry and runs still request the full caption layout', () => {
    for (const change of [
        cue => { cue.text = '改稿'; },
        cue => { cue.style_preset = 'subtitle-standard'; },
        cue => { cue.text_style.size_px = 90; },
        cue => { cue.runs = [{ from: 0, to: 1, style: { color: '#ffffff' } }]; }
    ]) {
        const root = JSON.parse(source);
        change(root.captions[0]);
        assert.equal(captionPaintOnlyChange(source, JSON.stringify(root)), false);
    }
});
