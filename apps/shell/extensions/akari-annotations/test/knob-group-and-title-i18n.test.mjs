import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseInspectorKnobs } from '../lib/browser/inspector/knob-resolver.js';
import { OVERLAY_SECTIONS } from '../lib/browser/inspector/sections/overlay-sections.js';

test('inspector translates group heading while retaining group id for controls', () => {
    const meta = { knobs: [{ cssVar: '--font-size', type: 'slider', group: 'typography', label: '名前サイズ' }],
        i18n: { en: { knobs: { '--font-size': 'Name size' }, groups: { typography: 'Typography' } } } };
    const [english] = parseInspectorKnobs(meta, 'en');
    const [japanese] = parseInspectorKnobs(meta, 'ja');
    assert.equal(english.group, 'typography');
    assert.equal(english.groupLabel, 'Typography');
    assert.equal(english.label, 'Name size');
    assert.equal(japanese.group, 'typography');
    assert.equal(japanese.groupLabel, '文字');
    assert.equal(japanese.label, '名前サイズ');
});

test('inspector row label exposes the full localized text as a title', () => {
    const snapshot = { kind: 'overlay', id: 'item', outputStart: 0, duration: 3,
        payload: { html: 'assets/overlay/demo/fragment.html', vars: { '--tone': '#ffffff', '--plain': 'text' } } };
    const knobs = [{ name: '--tone', type: 'color', group: 'style', label: 'Full translated tone label' }];
    const fields = OVERLAY_SECTIONS(snapshot, async () => ({ ok: true }), knobs)
        .filter(section => section.id.startsWith('knobs:')).flatMap(section => section.fields);
    assert.deepEqual(fields.map(field => [field.label, field.title]), [
        ['Full translated tone label', 'Full translated tone label'],
        ['vars.--plain', 'vars.--plain']
    ]);
    const renderer = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
    assert.match(renderer, /if \(field\.title\) row\.title = field\.title;/u);
});
