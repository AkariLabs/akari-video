import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { libraryTextstyleApplyPayload } from '../lib/common/library-textstyle-apply.js';
import { planLibraryApply } from '../../akari-annotations/lib/browser/library-apply-plan.js';
import { replaceMyStylePartsInSource } from '../../akari-annotations/lib/browser/my-style-look.js';

test('既存字幕へ同梱スタイルを当てると大文字化と animation が captions.json に残る', () => {
    for (const id of ['glitch', 'neon', 'emphasis-red']) {
        const preset = JSON.parse(readFileSync(new URL(`../../../../../presets/textstyle/${id}.json`, import.meta.url)));
        const payload = libraryTextstyleApplyPayload({ kind: 'textstyle', id, name: preset.name,
            tags: [], style: preset.style });
        const plan = planLibraryApply(payload, { kind: 'caption', id: 'c-0001' });
        assert.equal(plan?.kind, 'caption');
        const source = JSON.stringify({ captions: [{ id: 'c-0001', start: 0, end: 2, text: 'sample',
            text_style: { color: '#333333', animation: { in: { id: 'old' } } } }] });
        const after = JSON.parse(replaceMyStylePartsInSource(source, ['c-0001'], plan.parts));
        const applied = after.captions[0].text_style;
        assert.equal(applied.text_transform, preset.style.text_transform);
        assert.deepEqual(applied.animation, preset.style.animation);
    }
});
