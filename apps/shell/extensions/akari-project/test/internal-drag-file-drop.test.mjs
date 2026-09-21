import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { isOsFileDropInput, MATERIAL_DRAG_MIME, LIBRARY_DRAG_MIME } from '../lib/common/delegated-drop.js';

// 既存 widget テストと同様に実メソッドを実行し、DOM / I/O だけを置き換える。
const source = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
const names = ['handleDragOver', 'handleDrop', 'setDragActive'];
const code = ts.transpileModule(`class Handler { ${names.map(name => widget.members.find(member => member.name?.getText(source) === name).getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Handler = new Function('isOsFileDropInput', `${code}\nreturn Handler;`)(isOsFileDropInput);

const cases = [
    ['Files のみ', ['Files'], true],
    ['Finder の URI 付き Files', ['Files', 'text/uri-list'], true],
    ['対象外', [], false],
    ['テキストだけ', ['text/plain', 'text/uri-list'], false],
    ...[MATERIAL_DRAG_MIME, LIBRARY_DRAG_MIME].flatMap(mime => [
        [`${mime} のみ`, [mime], false],
        [`Files と ${mime}`, ['Files', mime, 'text/uri-list'], false]
    ])
];

for (const [label, types, expected] of cases) {
    test(`OS ファイル判定: ${label}`, () => {
        assert.equal(isOsFileDropInput(types), expected);
    });
    test(`パネルの dragover / drop: ${label}`, () => {
        const imported = [], warnings = [];
        let classifications = 0;
        const accepted = [{ name: 'sound.mp3', sourcePath: '/tmp/sound.mp3' }];
        const handler = Object.assign(new Handler(), {
            dragActive: true, update() {},
            classifyDropped: () => { classifications++; return { accepted, rejectedCount: 1 }; },
            importDropped: assets => imported.push(assets),
            messages: { warn: message => warnings.push(message) }
        });
        const event = { dataTransfer: { types, dropEffect: 'none' },
            prevented: false, stopped: false,
            preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
        handler.handleDragOver(event);
        assert.equal(handler.dragActive, expected, '内部ドラッグなら古い取り込み表示も消す');
        assert.equal(event.dataTransfer.dropEffect, expected ? 'copy' : 'none');
        assert.equal(event.prevented, expected);
        assert.equal(event.stopped, expected);
        handler.handleDrop(event);
        assert.equal(handler.dragActive, false);
        assert.equal(classifications, expected ? 1 : 0, '内部 MIME はファイル・URI の分類前に除外');
        assert.deepEqual(imported, expected ? [accepted] : []);
        assert.equal(warnings.length, expected ? 1 : 0);
    });
}

test('dataTransfer が無い場合も取り込み表示を消し、取り込まない', () => {
    const handler = Object.assign(new Handler(), {
        dragActive: true, update() {}, classifyDropped: () => assert.fail('分類しない')
    });
    const event = { dataTransfer: null, preventDefault() {}, stopPropagation() {} };
    handler.handleDragOver(event);
    assert.equal(handler.dragActive, false);
    handler.dragActive = true;
    handler.handleDrop(event);
    assert.equal(handler.dragActive, false);
});

test('素材・ライブラリ・プリセットのカード画像はネイティブの画像ドラッグを起動しない', () => {
    let images = 0;
    for (const name of ['renderMaterialCard', 'renderCatalogCard', 'renderCatalogListRow', 'renderPresetShowcaseCard', 'renderPresetShowcaseListRow']) {
        const method = widget.members.find(member => member.name?.getText(source) === name);
        assert.ok(method, name);
        const visit = node => {
            if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === 'img') {
                images++;
                const draggable = node.attributes.properties.find(attr => attr.name?.getText(source) === 'draggable');
                assert.equal(draggable?.initializer?.expression?.kind, ts.SyntaxKind.FalseKeyword, name);
            }
            ts.forEachChild(node, visit);
        };
        visit(method);
    }
    assert.equal(images, 3);
});
