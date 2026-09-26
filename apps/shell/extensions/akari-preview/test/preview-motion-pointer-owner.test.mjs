import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMotionDrawPointerOwnership } from '../lib/common/preview-motion-pointer-owner.js';

const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
test('draw ownership is acquired and released once on every stop', () => {
    const calls = [];
    const ownership = createMotionDrawPointerOwnership(() => ({
        setPointerOwner(owner) { calls.push(['start', owner]); return true; },
        releasePointerOwner(owner) { calls.push(['stop', owner]); return true; }
    }));
    for (const end of ['pointerup', 'Escape', 'pointercancel', 'selection change']) {
        assert.equal(ownership.start(), true, end);
        assert.equal(ownership.armed, true);
        ownership.stop();
        ownership.stop();
        assert.equal(ownership.armed, false);
    }
    assert.deepEqual(calls, Array.from({ length: 4 }, () => [['start', 'motion-draw'], ['stop', 'motion-draw']]).flat());
    assert.match(handler, /motionDrawPointerOwnership\.start\(\)/);
    assert.match(handler, /window\.addEventListener\('pointerdown', \(\) => \{\s*if \(motionDraw\) motionDrawPointerOwnership\.start\(\)/);
    assert.match(handler, /const stopMotionDraw = \(\) => \{[\s\S]*?motionDrawPointerOwnership\.stop\(\)/);
    assert.match(handler, /event\.key === 'Escape' && \(motionDraw \|\| motionDrawPointerOwnership\.armed\)\) stopMotionDraw\(\)/);
    assert.match(handler, /window\.addEventListener\('pointercancel', \(\) => \{\s*if \(motionDraw\) stopMotionDraw\(\)/);
    assert.match(handler, /selected !== motionDraw\.id\) stopMotionDraw\(\)/);
});
