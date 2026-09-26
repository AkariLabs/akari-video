import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { motionDrawWriteGuard } from '../lib/common/motion-draw-write-guard.js';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('描画中に捨てるのは通常ドラッグの transform だけ（道筋・複製は通す）', () => {
    assert.equal(motionDrawWriteGuard({ transform: { x: 1, y: 2 } }), true);
    assert.equal(motionDrawWriteGuard({ transform: { x: 1 }, xyKeyframes: [{ t: 0, transform: { x: 0, y: 0 } }] }), false);
    assert.equal(motionDrawWriteGuard({ xyKeyframes: [] }), false);
    assert.equal(motionDrawWriteGuard({ transform: { x: 1 }, duplicate: true }), false);
    assert.equal(motionDrawWriteGuard({ text: 'a' }), false);
    assert.equal(motionDrawWriteGuard(undefined), false);
    assert.equal(motionDrawWriteGuard([]), false);
});

test('webview が描画中と描画直後の通常ドラッグ書き込みを捨てる配線', () => {
    for (const wiring of [
        'const motionDrawWriteGuardFn = (${motionDrawWriteGuard.toString()});',
        'window.akari.engine.overlayWrite = (editPath, overlayId, patch) =>',
        '(motionDraw || motionDrawWriteSuppress) && motionDrawWriteGuardFn(patch)',
        'motionDrawWriteSuppress = true;'
    ]) assert.ok(source.includes(wiring), wiring);
});
