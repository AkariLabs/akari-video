import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { timelineApplyTarget } from '../lib/browser/library-apply-plan.js';

const source = ts.createSourceFile('widget.ts', readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const method = widget.members.find(member => member.name?.getText(source) === 'handleMaterialDragOver');
const compiled = ts.transpileModule(`class Harness { ${method.getText(source)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Harness = new Function('timelineApplyTarget', `${compiled}\nreturn Harness;`)(timelineApplyTarget);

function hover(kind, chipKind, chipId) {
    const handler = new Harness(), band = { style: { display: '' } };
    const chip = chipKind ? { dataset: { akariItemKind: chipKind, akariItemId: chipId },
        attributes: new Map(), setAttribute(key, value) { this.attributes.set(key, value); } } : undefined;
    let hidden = 0, placeGhost = 0;
    handler.cutItemIds = ['cut-1'];
    handler.isMaterialDragTransfer = () => true;
    handler.materialPanelDropPoint = () => ({ zone: 'strip', x: 50, y: 50 });
    handler.readLibraryTextStyleDropPayload = () => ({ kind, id: 'sample' });
    handler.node = { querySelectorAll: () => [] };
    handler.stripContent = { querySelector: () => band };
    handler.hideMaterialGhost = () => { hidden++; };
    handler.updateTextStyleDropGhost = () => { placeGhost++; };
    const dataTransfer = { dropEffect: 'none' };
    handler.handleMaterialDragOver({ clientX: 50, clientY: 50, dataTransfer,
        target: { closest: () => chip }, preventDefault() {}, stopPropagation() {} });
    return { chip, band, hidden, placeGhost, dropEffect: dataTransfer.dropEffect };
}

test('動き・フォントは文字、LUT は映像チップだけを光らせ、置く仮枠を消す', () => {
    for (const [kind, chipKind, id] of [
        ['textanim', 'caption', 'caption-1'], ['font', 'caption', 'caption-1'],
        ['lut', 'cut', '0'], ['lut', 'layer', 'photo-1']
    ]) {
        const result = hover(kind, chipKind, id);
        assert.ok(result.chip.attributes.has('data-akari-library-apply-target'));
        assert.equal(result.band.style.display, 'none');
        assert.equal(result.hidden, 1);
        assert.equal(result.placeGhost, 0);
        assert.equal(result.dropEffect, 'copy');
    }
    const blank = hover('textanim');
    assert.equal(blank.placeGhost, 0);
    assert.equal(blank.dropEffect, 'none');
});

test('スタイルは文字チップではかけ、チップ外では既存の置く仮枠を使う', () => {
    for (const kind of ['textstyle', 'mystyle']) {
        const onChip = hover(kind, 'caption', 'caption-1');
        assert.equal(onChip.band.style.display, 'none');
        assert.equal(onChip.placeGhost, 0);
        const blank = hover(kind);
        assert.equal(blank.band.style.display, '');
        assert.equal(blank.placeGhost, 1);
        assert.equal(blank.dropEffect, 'copy');
    }
});
