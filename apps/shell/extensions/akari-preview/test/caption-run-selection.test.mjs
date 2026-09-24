import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captionRunSelectionRange, captionRunToolbarPlacement } from '../lib/common/caption-run-selection.js';

test('DOM selection becomes displayed grapheme offsets, including joined emoji and combining marks', () => {
    assert.deepEqual(captionRunSelectionRange('A👩‍👩‍👧‍👦', 'e\u0301最高'), { from: 2, to: 5 });
    assert.deepEqual(captionRunSelectionRange('これは', '最高'), { from: 3, to: 5 });
    assert.equal(captionRunSelectionRange('abc', ''), undefined);
});

test('幅の狭い字幕でも範囲ツールバーをプレビュー内へ寄せる', () => {
    const frame = { left: 0, right: 640, top: 0, bottom: 360 };
    const tool = { width: 480, height: 72 };
    assert.deepEqual(captionRunToolbarPlacement(frame,
        { left: 10, right: 131, top: 250, bottom: 290 }, tool), { centerX: 246, top: 172 });
    assert.deepEqual(captionRunToolbarPlacement(frame,
        { left: 490, right: 611, top: 20, bottom: 60 }, tool), { centerX: 394, top: 66 });
});

test('インスペクターから styled span をまたぐ文字範囲を選べる', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    const start = source.indexOf('const selectEditorGraphemes =');
    const end = source.indexOf('const refreshActiveCaptionRuns =', start);
    assert.ok(start >= 0 && end > start);
    const nodes = ['これは', '最', '高', 'です'].map(textContent => ({ textContent }));
    let selected;
    const selection = { removeAllRanges() {}, addRange(range) { selected = range; } };
    const document = {
        createTreeWalker() {
            let index = 0;
            return { currentNode: null, nextNode() {
                this.currentNode = nodes[index++];
                return this.currentNode !== undefined;
            } };
        },
        createRange() { return {
            setStart(node, offset) { this.start = [node, offset]; },
            setEnd(node, offset) { this.end = [node, offset]; }
        }; }
    };
    const runSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const selectEditorGraphemes = new Function('runSegmenter', 'document', 'NodeFilter', 'window',
        `${source.slice(start, end)}\nreturn selectEditorGraphemes;`)(runSegmenter, document,
        { SHOW_TEXT: 4 }, { getSelection: () => selection });
    assert.equal(selectEditorGraphemes({ textContent: 'これは最高です' }, 3, 5), true);
    assert.deepEqual(selected.start, [nodes[0], 3]);
    assert.deepEqual(selected.end, [nodes[2], 1]);
    assert.equal(selectEditorGraphemes({ textContent: 'これは最高です' }, 5, 50), false);
});
