import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { planLibraryApply } from '../lib/browser/library-apply-plan.js';
import { replaceMyStylePartsInSource } from '../lib/browser/my-style-look.js';
import { updateInspectorAdjust } from '../lib/browser/inspector/adjust-fields.js';

const source = ts.createSourceFile('widget.ts', readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const method = widget.members.find(member => member.name?.getText(source) === 'applyLibraryItem');
const compiled = ts.transpileModule(`class Harness { ${method.getText(source)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Harness = new Function('planLibraryApply', `${compiled}\nreturn Harness;`)(planLibraryApply);

const originalCaption = { captions: [{ id: 'caption-1', text: '文字', start: 1, end: 4,
    text_style: { position: { x: 0.24, y: 0.68 }, color: '#333333', font_family: 'Old Family' } }] };
const originalItem = { id: 'photo-1', transform: { x: 18, y: -11, scale: 0.7 },
    adjust: { basic: { contrast: 12 } } };

function fixture() {
    const handler = new Harness();
    const writes = [], history = [], notices = [];
    let captions = structuredClone(originalCaption);
    let item = structuredClone(originalItem);
    handler.location = { editUri: { toString: () => 'edit.json' } };
    handler.messages = { info: text => notices.push(text), warn: text => notices.push(text) };
    handler.selectCaptions = () => {};
    handler.applySelection = () => {};
    handler.handleInspectorWrite = async request => {
        writes.push(request);
        const beforeCaptions = structuredClone(captions), beforeItem = structuredClone(item);
        if (request.kind === 'caption-style-my-style') {
            captions = JSON.parse(replaceMyStylePartsInSource(JSON.stringify(captions), [request.id], request.value.parts));
        } else if (request.kind === 'caption-style-font-family') {
            captions.captions[0].text_style.font_family = request.value;
        } else if (request.kind === 'item-field') {
            item.adjust = updateInspectorAdjust(item.adjust, request.path, request.value);
        } else assert.fail(request.kind);
        history.push({ undo: () => { captions = beforeCaptions; item = beforeItem; } });
        return { ok: true };
    };
    handler.applyMyStyle = async detail => handler.handleInspectorWrite({ kind: 'caption-style-my-style',
        id: detail.ids[0], value: { parts: detail.style.parts } });
    return { handler, writes, history, notices, get captions() { return captions; }, get item() { return item; } };
}

for (const [payload, target, expectedKind] of [
    [{ kind: 'textanim', id: 'fade', slot: 'in' }, { kind: 'caption', id: 'caption-1' }, 'caption-style-my-style'],
    [{ kind: 'textstyle', id: 'news', style: { color: '#ffffff' } }, { kind: 'caption', id: 'caption-1' }, 'caption-style-my-style'],
    [{ kind: 'mystyle', style: { parts: [{ kind: 'look', text_style: { color: '#ee5500' } }] } },
        { kind: 'caption', id: 'caption-1' }, 'caption-style-my-style'],
    [{ kind: 'font', id: 'dela-gothic-one', fontFamily: 'Dela Gothic One' },
        { kind: 'caption', id: 'caption-1' }, 'caption-style-font-family'],
    [{ kind: 'lut', id: 'warm' }, { kind: 'layer', id: 'photo-1' }, 'item-field']
]) {
    test(`${payload.kind}: widget は 1 書き込み・1 履歴で位置を保ち、undo 1 回で戻す`, async () => {
        const state = fixture();
        assert.equal(await state.handler.applyLibraryItem(payload, target), true);
        assert.equal(state.writes.length, 1);
        assert.equal(state.writes[0].kind, expectedKind);
        if (['textanim', 'textstyle', 'font'].includes(payload.kind)) {
            assert.equal(state.writes[0].libraryApplyKind, payload.kind);
        } else assert.equal(state.writes[0].libraryApplyKind, undefined);
        assert.equal(state.history.length, 1);
        assert.deepEqual(state.captions.captions[0].text_style.position, originalCaption.captions[0].text_style.position);
        assert.deepEqual(state.item.transform, originalItem.transform);
        if (payload.kind === 'lut') {
            assert.equal(state.writes[0].path, 'adjust.lut.lut');
            assert.deepEqual(state.item.adjust, { basic: { contrast: 12 }, lut: { lut: 'warm' } });
        }
        state.history[0].undo();
        assert.deepEqual(state.captions, originalCaption);
        assert.deepEqual(state.item, originalItem);
    });
}

test('相手が無い場合は書き込みも履歴も作らない', async () => {
    const state = fixture();
    assert.equal(await state.handler.applyLibraryItem({ kind: 'textanim', id: 'fade' }), false);
    assert.equal(await state.handler.applyLibraryItem({ kind: 'lut', id: 'film-warm' }), false);
    assert.equal(await state.handler.applyLibraryItem({ kind: 'textstyle', id: 'news' }, { kind: 'caption', id: 'caption-1' }), false);
    assert.equal(state.writes.length, 0);
    assert.equal(state.history.length, 0);
    assert.deepEqual(state.notices, ['文字を選んでから当ててください。',
        '写真や映像を選んでから当ててください。', 'カードの内容を読み取れませんでした。']);
});
