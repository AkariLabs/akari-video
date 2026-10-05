import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PREVIEW_CAPTION_ONE_SHOT_LOOP_IDS } = require('../../akari-preview/lib/common/caption-text-animation-recipes.js');
const source = readFileSync(new URL('../src/browser/inspector/caption-motion-panel.ts', import.meta.url), 'utf8');
const expression = source.match(/const direction = ([\s\S]*?);\s*sample\.style\.animation =/u)?.[1];

test('sample goes forward once per cycle for entry rotations in emphasis slot', () => {
    assert.ok(expression, 'sample direction expression');
    const direction = new Function('item', 'oneShotLoopIds', `return ${expression};`);
    const expectedOneShotIds = ['spin-in', 'rotate-in', 'roll-in', 'spiral-in'];
    const oneShotLoopIds = new Set(expectedOneShotIds);
    for (const animation of expectedOneShotIds) {
        assert.equal(direction({ slot: 'loop', animation }, oneShotLoopIds), 'normal', animation);
    }
    assert.deepEqual([...(PREVIEW_CAPTION_ONE_SHOT_LOOP_IDS ?? [])].sort(), [...expectedOneShotIds].sort());
    for (const animation of ['float', 'heartbeat', 'wobble']) {
        assert.equal(direction({ slot: 'loop', animation }, oneShotLoopIds), 'alternate', animation);
    }
    assert.equal(direction({ slot: 'out', animation: 'spin-in' }, oneShotLoopIds), 'reverse');
});
