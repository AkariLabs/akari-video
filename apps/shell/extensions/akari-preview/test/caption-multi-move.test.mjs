import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    captionCuePositionFromRects,
    updateCaptionCuePositionsSource
} from '../lib/common/caption-zone-write.js';

test('one output-pixel delta is distributed to three cue positions', () => {
    const frame = { x: 0, y: 0, width: 1280, height: 720 };
    const rects = [
        { left: 400, right: 600, top: 560, bottom: 620 },
        { left: 500, right: 800, top: 540, bottom: 640 },
        { left: 200, right: 350, top: 50, bottom: 100 }
    ];
    for (const rect of rects) {
        const before = captionCuePositionFromRects(rect, frame, { clamp: false, anchor: 'bc' });
        const moved = Object.fromEntries(Object.entries(rect).map(([key, value]) =>
            [key, value + (key === 'left' || key === 'right' ? 40 : -20)]));
        const after = captionCuePositionFromRects(moved, frame, { clamp: false, anchor: 'bc' });
        assert.ok(Math.abs((after.position.x - before.position.x) * frame.width - 40) < 0.1);
        assert.ok(Math.abs((after.position.y - before.position.y) * frame.height + 20) < 0.1);
    }
});

test('batch position source writes all three cues in one document and preserves unrelated fields', () => {
    for (const objectRoot of [false, true]) {
        const cues = [
            { id: 'a', text_style: { zone: 'bottom', color: '#abcdef' } },
            { id: 'b', text_style: { size_px: 48 } },
            { id: 'c' },
            { id: 'untouched', text_style: { zone: 'top' } }
        ];
        const source = JSON.stringify(objectRoot ? { default_text_style: { size_px: 38 }, captions: cues } : cues);
        const positions = ['a', 'b', 'c'].map((captionId, index) => ({
            captionId, value: { anchor: 'bc', position: { x: 0.2 + index * 0.1, y: 0.8 } }
        }));
        const result = JSON.parse(updateCaptionCuePositionsSource(source, positions));
        const saved = objectRoot ? result.captions : result;
        assert.deepEqual(saved.slice(0, 3).map(cue => Number(cue.text_style.position.x.toFixed(4))), [0.2, 0.3, 0.4]);
        assert.equal(saved[0].text_style.color, '#abcdef');
        assert.equal(saved[0].text_style.zone, undefined);
        assert.equal(saved[1].text_style.size_px, 48);
        assert.deepEqual(saved[3], cues[3]);
        if (objectRoot) assert.deepEqual(result.default_text_style, { size_px: 38 });
        assert.throws(() => updateCaptionCuePositionsSource(source, [...positions, positions[0]]), /重複/u);
    }
});

test('preview multi-move sends one batch request while keeping all-captions mode separate', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    assert.match(source, /if \(groupMode\)[\s\S]*?else if \(multiMove\)[\s\S]*?captionWrite\(cueId, \{ cuePositions \}\)/u);
    assert.match(source, /const multiMove = moveIds\.length > 1/u);
    assert.match(source, /const snap = window\.akari\.interaction\.computeSnapCorrection\(/u);
});

test('timeline caption selection message carries IDs and primary into the webview', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    assert.match(source, /window\.addEventListener\('akari\.timeline\.captionSelectionChanged', onTimelineCaptionSelectionChanged\)/u);
    assert.match(source, /sendMessage\(\{ type: 'akari-preview-set-selected-captions', \.\.\.selection \}\)/u);
    assert.match(source, /selectedCaptionIds = new Set\(Array\.isArray\(message\.captionIds\)/u);
    assert.match(source, /selectCaption\(selectedCaptionIds\.has\(message\.primaryCaptionId\)/u);
});
