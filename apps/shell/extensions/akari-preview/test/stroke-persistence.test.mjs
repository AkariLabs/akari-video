import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { normalizePersistentStrokeItems } from '../lib/common/pen-canvas-visuals.js';

const sourceUrl = new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url);

test('persistent geometry remains normalized and supports pen plus rect', () => {
    assert.deepEqual(normalizePersistentStrokeItems([
        { tool: 'pen', points: [[0.125, 0.25], [0.75, 0.875]] },
        { tool: 'rect', box: [0.1, 0.2, 0.3, 0.4] }
    ]), [
        { tool: 'pen', points: [[0.125, 0.25], [0.75, 0.875]] },
        { tool: 'rect', box: [0.1, 0.2, 0.3, 0.4] }
    ]);
});

test('completed strokes enter the static overlay before the existing fade effect runs', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    const penPersist = source.indexOf("persistentStrokeItems.push({ tool: 'pen'");
    const penFade = source.indexOf('completed.fadeStartedAt = performance.now()', penPersist);
    const rectPersist = source.indexOf("persistentStrokeItems.push({ tool: 'rect'");
    const rectFade = source.indexOf('completed.fadeStartedAt = performance.now()', rectPersist);
    assert.ok(penPersist >= 0 && penFade > penPersist);
    assert.ok(rectPersist >= 0 && rectFade > rectPersist);
    assert.match(source, /#pen-layer \{[^}]*pointer-events: none/);
});

test('annotation-panel toggle defaults on and webview handles off/on plus session replay', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    assert.match(source, /setAttribute\('aria-label', '注釈描線を表示'\)/);
    assert.match(source, /reviewStrokeVisibilityByEdit\.get\(editUri\) \?\? true/);
    assert.match(source, /akari-preview-set-stroke-visibility/);
    assert.match(source, /akari-preview-show-session-strokes/);
    assert.match(source, /data-review-session-strokes/);
});
