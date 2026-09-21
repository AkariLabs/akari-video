import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { libraryAssetGhostPayload, parseLibraryDragPayload } from '../lib/browser/library-drop-model.js';

const source = ts.createSourceFile('widget.ts', readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const names = ['handleMaterialDrop', 'readLibraryAssetDropPayload', 'placeLibraryAssetAtTarget', 'isMaterialDragTransfer', 'isLibraryTransitionDragTransfer', 'materialGhostDurationSeconds'];
const methods = names.map(name => widget.members.find(member => member.name?.getText(source) === name).getText(source));
const parser = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'parseMaterialDragPayload').getText(source);
const code = ts.transpileModule(`${parser}\nclass Handler { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Handler = new Function('libraryAssetGhostPayload', 'parseLibraryDragPayload', 'LIBRARY_DRAG_MIME', 'MATERIAL_DRAG_MIME', 'IMAGE_LAYER_DEFAULT_DURATION_SECONDS', 'MATERIAL_INSERT_FALLBACK_DURATION_SECONDS', `${code}\nreturn Handler;`)(libraryAssetGhostPayload, parseLibraryDragPayload, 'application/x-akari-library-item', 'application/x-akari-material', 5, 3);
const asset = { kind: 'asset', key: 'audio/sample', id: 'sample', category: 'audio', title: '素材' };
const target = { zone: 'audio', track: 1, insertIndex: 2, insertTrack: 2 };
function fixture() {
    const handler = new Handler();
    const placed = [], messages = [], commands = [];
    handler.location = { editUri: 'project/edit.json' };
    handler.commands = { executeCommand: async (...args) => { commands.push(args); return { kind: 'audio', relativePath: 'assets/audio/sample/b.mp3' }; } };
    handler.placeMaterialAtTarget = async (...args) => placed.push(args);
    handler.isTrackLocked = () => false;
    handler.showLockedTrack = () => messages.push('locked');
    handler.messages = { warn: message => messages.push(message), error: message => messages.push(message) };
    handler.errorMessage = error => error.message;
    handler.materialDurationCache = new Map();
    return { handler, placed, messages, commands };
}

test('ライブラリ素材は既存の着地処理へ位置・行間挿入先をそのまま渡す', async () => {
    const { handler, placed, commands } = fixture();
    await handler.placeLibraryAssetAtTarget(asset, target, 120, 'strip');
    assert.deepEqual(commands, [['akari.catalog.resolveMaterial', 'audio/sample']]);
    assert.equal(placed.length, 1);
    assert.equal(placed[0][0].relativePath, 'assets/audio/sample/b.mp3');
    assert.equal(placed[0][1], target);
    assert.deepEqual(placed[0].slice(2), [120, 'strip']);
});

for (const [label, result] of [['失敗', undefined], ['不正な応答', {}], ['種別不一致', { kind: 'video', relativePath: 'clip.mp4' }]]) {
    test(`素材解決の${label}では何も置かない`, async () => {
        const { handler, placed } = fixture();
        handler.commands.executeCommand = async () => result;
        await handler.placeLibraryAssetAtTarget(asset, target, 120, 'strip');
        assert.equal(placed.length, 0);
    });
}

test('コマンド例外をトーストに出す', async () => {
    const { handler, placed, messages } = fixture();
    handler.commands.executeCommand = async () => { throw new Error('offline'); };
    await handler.placeLibraryAssetAtTarget(asset, target, 120, 'strip');
    assert.equal(placed.length, 0);
    assert.match(messages[0], /offline/);
});

for (const change of ['lock', 'project']) {
    test(`取得待ちの間の ${change} 変更を配置前に再確認する`, async () => {
        const { handler, placed, messages } = fixture();
        handler.commands.executeCommand = async () => {
            if (change === 'lock') handler.isTrackLocked = () => true;
            else handler.location.editUri = 'other/edit.json';
            return { kind: 'audio', relativePath: 'audio.mp3' };
        };
        await handler.placeLibraryAssetAtTarget(asset, target, 120, 'strip');
        assert.equal(placed.length, 0);
        assert.equal(messages.length, 1);
    });
}

test('dragover はミラー、drop は MIME 本文を優先し、壊れた本文は救済しない', () => {
    const { handler } = fixture();
    handler.libraryAssetDragPayload = asset;
    let raw = '';
    const transfer = { types: ['application/x-akari-library-item'], getData: () => raw };
    assert.equal(handler.isMaterialDragTransfer(transfer), true);
    assert.equal(handler.isLibraryTransitionDragTransfer(transfer), false);
    assert.deepEqual(handler.readLibraryAssetDropPayload(transfer), asset);
    raw = '{';
    assert.equal(handler.readLibraryAssetDropPayload(transfer), undefined);
    raw = JSON.stringify({ kind: 'transition', id: 'dissolve', name: 'ディゾルブ' });
    assert.equal(handler.isMaterialDragTransfer(transfer), false);
    assert.equal(handler.isLibraryTransitionDragTransfer(transfer), true);
});

test('ライブラリの画像は 5 秒、音声・動画は既存フォールバック尺になる', () => {
    const { handler } = fixture();
    for (const category of ['still', 'audio', 'broll']) {
        assert.equal(handler.materialGhostDurationSeconds(libraryAssetGhostPayload({ ...asset, category })), category === 'still' ? 5 : 3);
    }
});

test('受理不可のトラックは解決コマンドを呼ばず理由を出す', () => {
    const { handler, messages, commands } = fixture();
    handler.materialPanelDropPoint = () => ({ x: 120, y: 60, zone: 'strip' });
    handler.stopMaterialDragAutoScroll = handler.hideMaterialGhost = handler.clearLibraryTransitionDragState = () => {};
    handler.resolveMaterialDropTarget = () => ({ rejected: true, reason: '音は音の段へ' });
    handler.footer = {};
    handler.handleMaterialDrop({ dataTransfer: { types: ['application/x-akari-library-item'], getData: () => JSON.stringify(asset) }, preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(commands, []);
    assert.deepEqual(messages, ['音は音の段へ']);
});
