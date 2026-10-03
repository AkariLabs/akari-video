import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const section = source.split('let pendingShapeLive = null;')[1].split('const paintLiveOverride =')[0];
const create = new Function('liveDom', 'window', 'stage', `let pendingShapeLive = null;${section}
    return { clearLiveOverride, pending: value => { pendingShapeLive = value; } };`);

test('字幕更新中は図形ライブ色を保ち、モデル確定時に古い色へ戻さない', () => {
    const shape = { dataset: { overlayId: 'box-a' }, innerHTML: '<svg fill="#112233"></svg>' };
    const liveDom = {
        clear() { shape.innerHTML = '<svg fill="#112233"></svg>'; },
        updateShape(_key, html) { shape.innerHTML = html; }
    };
    const window = { akari: { state: { summary: { overlays: [
        { id: 'box-a', html: '<svg fill="#112233"></svg>' }
    ] } } } };
    const stage = { querySelectorAll: () => [shape] };
    const handoff = create(liveDom, window, stage);
    const next = '<svg fill="#abcdef"></svg>';
    handoff.pending({ key: 'item:box-a', id: 'box-a', html: next });
    shape.innerHTML = next;
    handoff.clearLiveOverride();
    assert.equal(shape.innerHTML, next);
    window.akari.state.summary.overlays[0].html = next;
    handoff.clearLiveOverride();
    assert.equal(shape.innerHTML, next);
});
