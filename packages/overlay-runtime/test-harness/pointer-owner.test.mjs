import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const canBegin = vm.runInNewContext(`${source.match(/function canBeginPointerInteraction\(owner\) \{[^}]+\}/)[0]}; canBeginPointerInteraction`);

test('a pointer owner blocks each ordinary pointerdown entry', () => {
    assert.equal(canBegin(null), true);
    assert.equal(canBegin('motion-draw'), false);
    assert.match(source, /function onPointerDown\(event\) \{\s*if \(!interactionEnabled \|\| !canBeginPointerInteraction\(pointerOwner\)\) return;/);
    assert.match(source, /function onKeyDown\(event\) \{\s*if \(!canBeginPointerInteraction\(pointerOwner\)\) return;/);
    assert.match(source, /listenerRoot\.addEventListener\("pointerdown", onPointerDown, true\)/);
    for (const operation of ['activeDrag', 'activeResize', 'activeRotate', 'activeLine', 'marqueeFrame']) {
        assert.match(source, new RegExp(`activePointerOperation[\\s\\S]*?${operation}`));
    }
});
