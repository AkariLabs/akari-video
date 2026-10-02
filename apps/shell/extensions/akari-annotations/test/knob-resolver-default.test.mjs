import assert from 'node:assert/strict';
import test from 'node:test';
import { isFontFamilyKnob, parseInspectorKnobs } from '../lib/browser/inspector/knob-resolver.js';

test('reads valid knob defaults and ignores defaults with the wrong type', () => {
    const knobs = parseInspectorKnobs({ knobs: [
        { cssVar: '--fontFamily', type: 'text', group: 'typography', default: 'Noto Sans JP' },
        { cssVar: '--size', type: 'slider', group: 'typography', default: 24 },
        { cssVar: '--bad', type: 'slider', group: 'typography', default: '24' }
    ] });
    assert.deepEqual(knobs.map(knob => knob.default), ['Noto Sans JP', 24, undefined]);
});

test('font knobs use the caption font selector', () => {
    assert.equal(isFontFamilyKnob({ name: '--fontFamily', type: 'text', group: 'other' }), true);
    assert.equal(isFontFamilyKnob({ name: '--font-choice', type: 'text', group: 'typography' }), true);
    assert.equal(isFontFamilyKnob({ name: '--font-size', type: 'slider', group: 'typography' }), false);
});
