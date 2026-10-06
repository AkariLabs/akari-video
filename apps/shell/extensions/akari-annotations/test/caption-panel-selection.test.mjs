import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captionPanelSelection, captionPanelFontRequest } from '../lib/browser/inspector/caption-panel-selection.js';
import { applyCaptionStyleBatch } from '../lib/browser/inspector/caption-style-batch.js';

const caption = id => ({ kind: 'caption', id, effectiveTextStyle: { fontFamily: 'Noto Sans JP' } });

test('フォントの入口は単独 caption・caption item・caption を含む複数選択を通す', () => {
    assert.equal(captionPanelSelection(caption('spoken'), [], 'font').primaryId, 'spoken');
    assert.equal(captionPanelSelection({ kind: 'item', id: 'caption-item#placed', itemKind: 'caption' },
        ['placed'], 'font').primaryId, 'placed');
    const multi = { kind: 'multi', items: [caption('spoken'), caption('placed')] };
    assert.deepEqual(captionPanelSelection(multi, ['spoken', 'placed'], 'font').ids, ['spoken', 'placed']);
    assert.equal(captionPanelSelection(multi, ['spoken', 'placed'], 'font').primaryCaption.id, 'spoken');
    assert.deepEqual(captionPanelSelection({ kind: 'multi', items: [
        { kind: 'layer', id: 'video' }, caption('placed')
    ] }, ['placed'], 'font').ids, ['placed']);
    assert.equal(captionPanelSelection(multi, ['spoken', 'placed'], 'style'), undefined);
    assert.equal(captionPanelSelection({ kind: 'multi', items: [{ kind: 'layer', id: 'video' }] },
        [], 'font'), undefined);
    assert.equal(captionPanelSelection({ kind: 'layer', id: 'video' }, [], 'font'), undefined);
    const contribution = readFileSync(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8');
    assert.match(contribution, /captionPanelSelection\(selection, this\.selectionModel\.selectedCaptionIds, argument\.panel\)/u);
});

test('複数フォントは 1 要求の targets で両方を書き、単独要求は従来どおり', () => {
    const multi = captionPanelSelection({ kind: 'multi', items: [caption('spoken'), caption('placed')] },
        ['spoken', 'placed'], 'font');
    const request = captionPanelFontRequest(multi, 'Klee One', 700);
    assert.deepEqual(request.targets, [{ kind: 'caption', id: 'spoken' }, { kind: 'caption', id: 'placed' }]);
    assert.deepEqual(request.value, { fontFamily: 'Klee One', fontWeight: 700, weight: 700 });
    const source = JSON.stringify({ captions: [
        { id: 'spoken', text_style: { font_family: 'Noto Sans JP' } },
        { id: 'placed', time_domain: 'output', text_style: { font_family: 'Noto Sans JP' } }
    ] });
    const next = applyCaptionStyleBatch(source, request.targets.map(target =>
        ({ id: target.id, style: request.value })));
    assert.deepEqual(JSON.parse(next).captions.map(row => row.text_style.font_family), ['Klee One', 'Klee One']);
    assert.equal('targets' in captionPanelFontRequest(captionPanelSelection(caption('spoken'), [], 'font'),
        'Klee One'), false);
});
