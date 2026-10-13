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

test('inspector knob labels follow the supplied UI language', () => {
    const meta = { knobs: [
        { cssVar: '--tone', type: 'color', group: 'style', label: '色調' },
        { param: 'speed', type: 'slider', group: 'motion', label: '速さ' }
    ], i18n: { en: { knobs: { '--tone': 'Tone', speed: 'Speed' } } } };
    assert.deepEqual(parseInspectorKnobs(meta, 'en').map(knob => knob.label), ['Tone', 'Speed']);
    assert.deepEqual(parseInspectorKnobs(meta, 'ja').map(knob => knob.label), ['色調', '速さ']);
    const withoutBase = { knobs: [{ cssVar: '--tone', type: 'color', group: 'style' }],
        i18n: { en: { knobs: { '--tone': 'Tone' } } } };
    assert.equal(parseInspectorKnobs(withoutBase, 'en')[0].label, 'Tone');
    assert.equal(parseInspectorKnobs(withoutBase, 'ja')[0].label, undefined);
});


test('malformed knob translation uses the base label and never exposes a non-string label', () => {
    const meta = { knobs: [
        { cssVar: '--a', type: 'color', group: 'style', label: 'Base' },
        { cssVar: '--b', type: 'color', group: 'style', label: 5 }
    ], i18n: { en: { knobs: { '--a': 3, '--b': 'English' } } } };
    const [first, second] = parseInspectorKnobs(meta, 'en');
    assert.equal(first.label, 'Base');
    assert.equal(second.label, 'English');
    assert.equal(parseInspectorKnobs(meta, 'ja')[1].label, undefined);
    const broken = { knobs: [{ cssVar: '--a', type: 'color', group: 'style', label: 'Base' }],
        i18n: { en: { knobs: { '--a': 5 } } } };
    assert.equal(parseInspectorKnobs(broken, 'en')[0].label, 'Base');
});
