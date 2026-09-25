import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { canPlaceLibraryAsset, canPlaceOverlay, libraryDragKind, localLibraryAssetPlacementSource, resolveLibraryAssetMedia, RESOLVE_LIBRARY_MATERIAL_COMMAND_ID } from '../lib/common/library-asset-placement.js';
import { isPremiumLocked } from '../lib/common/library-filter.js';
import { isPlaceableLibraryCategory } from '../lib/common/library-card-menu.js';
const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const source = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
const names = ['resolveCatalogMaterial', 'canDragCatalogAsset', 'handleCatalogAssetDragStart', 'addCatalogAssetAtPlayhead', 'useAssetCatalogItem', 'refreshAfterAssetCatalogImport'];
const code = ts.transpileModule(`class Handler { ${names.map(name => widget.members.find(member => member.name?.getText(source) === name).getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const events = [];
const Handler = new Function('URI', 'canPlaceLibraryAsset', 'canPlaceOverlay', 'libraryDragKind', 'localLibraryAssetPlacementSource', 'resolveLibraryAssetMedia', 'RESOLVE_LIBRARY_MATERIAL_COMMAND_ID', 'TIMELINE_ADD_MATERIAL_AT_PLAYHEAD_COMMAND_ID', 'LIBRARY_DRAG_MIME', 'LIBRARY_DRAG_START_EVENT', 'window', 'CustomEvent', 'isPremiumLocked', 'isPlaceableLibraryCategory', `${code}\nreturn Handler;`)(URI, canPlaceLibraryAsset, canPlaceOverlay, libraryDragKind, localLibraryAssetPlacementSource, resolveLibraryAssetMedia, RESOLVE_LIBRARY_MATERIAL_COMMAND_ID, 'akari.timeline.addMaterialAtPlayhead', 'application/x-akari-library-item', 'akari.library.dragStart', { dispatchEvent: event => events.push(event) }, class { constructor(type, init) { this.type = type; this.detail = init.detail; } }, isPremiumLocked, isPlaceableLibraryCategory);
const item = { origin: 'resolver', key: 'audio/sample', id: 'sample', category: 'audio', title: '素材', state: 'available', mediaUrl: 'https://example.test/b.mp3' };
function fixture() {
    const handler = new Handler(), calls = [], messages = [];
    handler.workflow = { workspaceRoot: URI.fromFilePath('/project') };
    handler.assetCatalogItems = [item];
    handler.resolvingAssetKeys = new Set();
    handler.update = () => {};
    handler.loadMaterials = async () => {};
    handler.messages = { warn: message => messages.push(message), error: message => messages.push(message) };
    handler.projectService = { resolveAsset: async (...args) => { calls.push(args); return { success: true, projectAssetPath: '/project/assets/audio/sample' }; } };
    handler.files = { resolve: async () => ({ children: ['a.mp3', 'b.mp3'].map(name => ({ name, isDirectory: false })) }) };
    handler.toAssetBinChildren = stat => stat.children;
    const prompts = [];
    // 未購入のプレミアムだけ促しのシートを出す（ウィジェットの showPremiumPrompt と同じ判定）。
    handler.showPremiumPrompt = key => {
        const target = handler.assetCatalogItems.find(entry => entry.key === key);
        if (!target || !isPremiumLocked(target)) return false;
        prompts.push(key);
        return true;
    };
    return { handler, calls, messages, prompts };
}

test('取得後は試聴ファイルをプロジェクト相対パスで返し、cached を更新する', async () => {
    const { handler, calls } = fixture();
    assert.deepEqual(await handler.resolveCatalogMaterial(item.key), { relativePath: 'assets/audio/sample/b.mp3', kind: 'audio' });
    assert.deepEqual(calls, [['sample', 'file:///project']]);
    assert.equal(handler.assetCatalogItems[0].state, 'cached');
    assert.equal(handler.resolvingAssetKeys.size, 0);
});

for (const state of ['locked', 'missing', 'busy', 'failed', 'ambiguous']) {
    test(`解決不可 (${state}) は配置用結果を返さず理由を表示する`, async () => {
        const { handler, calls, messages, prompts } = fixture();
        if (state === 'locked') handler.assetCatalogItems = [{ ...item, state: 'locked' }];
        if (state === 'missing') handler.assetCatalogItems = [];
        if (state === 'busy') handler.resolvingAssetKeys.add(item.key);
        if (state === 'failed') handler.projectService.resolveAsset = async () => ({ success: false, error: 'offline' });
        if (state === 'ambiguous') handler.assetCatalogItems = [{ ...item, mediaUrl: 'https://example.test/missing.mp3' }];
        assert.equal(await handler.resolveCatalogMaterial(item.key), undefined);
        // 未購入のプレミアムは一言の警告ではなく促しのシート（置かない）。
        assert.equal(messages.length, state === 'locked' ? 0 : 1);
        assert.deepEqual(prompts, state === 'locked' ? [item.key] : []);
        if (['locked', 'missing', 'busy'].includes(state)) assert.equal(calls.length, 0);
    });
}

test('＋ は解決コマンドの結果を既存のプレイヘッド追加コマンドへ渡す', async () => {
    const { handler } = fixture(), calls = [];
    const material = { relativePath: 'assets/audio/sample/b.mp3', kind: 'audio' };
    handler.commandService = { executeCommand: async (...args) => { calls.push(args); return material; } };
    await handler.addCatalogAssetAtPlayhead(item);
    assert.deepEqual(calls, [[RESOLVE_LIBRARY_MATERIAL_COMMAND_ID, item.key], ['akari.timeline.addMaterialAtPlayhead', material]]);
});

test('local はドラッグ不可で、コマンド直叩きも resolver を呼ばず拒否する', async () => {
    const { handler, calls, messages } = fixture();
    const localItem = { ...item, origin: 'local', state: undefined };
    handler.assetCatalogItems = [localItem];
    assert.equal(handler.canDragCatalogAsset(localItem), false);
    let prevented = false;
    handler.handleCatalogAssetDragStart({
        preventDefault: () => { prevented = true; },
        dataTransfer: { setData: () => assert.fail('local の payload は送信しない') }
    }, localItem);
    assert.equal(prevented, true);
    assert.equal(await handler.resolveCatalogMaterial(localItem.key), undefined);
    assert.deepEqual(calls, []);
    assert.deepEqual(messages, ['この素材は直接置けません']);
});

test('カードのドラッグは同じ payload を MIME とミラーへ送り、未購入は locked と価格を載せる。パック棚は拒否する', () => {
    const { handler } = fixture();
    let raw, prevented = false;
    const event = { dataTransfer: { setData: (mime, value) => { assert.equal(mime, 'application/x-akari-library-item'); raw = value; } }, preventDefault: () => { prevented = true; } };
    handler.handleCatalogAssetDragStart(event, item);
    assert.deepEqual(JSON.parse(raw), { kind: 'asset', key: item.key, id: item.id, category: item.category, title: item.title });
    assert.deepEqual(events.at(-1).detail, JSON.parse(raw));
    assert.equal(event.dataTransfer.effectAllowed, 'copy');
    // 未購入のプレミアムもドラッグは始まる（受け口が locked を見て促しのシートへ分岐する）。
    handler.handleCatalogAssetDragStart(event, { ...item, state: 'locked', price: 2980 });
    assert.equal(prevented, false);
    assert.deepEqual(JSON.parse(raw), { kind: 'asset', key: item.key, id: item.id, category: item.category, title: item.title, locked: true, price: 2980 });
    assert.deepEqual(events.at(-1).detail, JSON.parse(raw));
    // オーバーレイは未購入でもドラッグでき、落とす時点で購入案内へ進む。
    handler.handleCatalogAssetDragStart(event, { ...item, category: 'overlay', state: 'locked', price: 500 });
    assert.equal(prevented, false);
    assert.equal(JSON.parse(raw).kind, 'overlay');
    assert.equal(JSON.parse(raw).locked, true);
    handler.libraryCategory = 'pack';
    assert.equal(handler.canDragCatalogAsset(item), false);
});

for (const sourceKind of ['own', 'site', 'lab']) {
    for (const operation of ['resolveCatalogMaterial', 'useAssetCatalogItem']) {
        test(`${operation}: ${sourceKind} の置き場素材を対応する配置経路へ渡す`, async () => {
            const { handler, calls, messages } = fixture();
            const localItem = { ...item, sourceKind, libraryDir: '/library/audio/sample', state: 'cached' };
            const placements = [];
            handler.assetCatalogItems = [localItem];
            handler.projectService.placeLibraryAsset = async (...args) => {
                placements.push(args);
                return { success: true, projectAssetPath: '/project/assets/audio/sample' };
            };
            const result = operation === 'resolveCatalogMaterial'
                ? await handler.resolveCatalogMaterial(localItem.key)
                : await handler.useAssetCatalogItem(localItem);
            assert.deepEqual(placements, sourceKind === 'lab' ? [] : [[
                { category: 'audio', id: 'sample', libraryDir: '/library/audio/sample' }, 'file:///project'
            ]]);
            assert.equal(calls.length, sourceKind === 'lab' ? 1 : 0);
            assert.deepEqual(messages, []);
            if (operation === 'resolveCatalogMaterial') assert.deepEqual(result, { relativePath: 'assets/audio/sample/b.mp3', kind: 'audio' });
            assert.equal(handler.assetCatalogItems[0].state, 'cached');
        });
    }
}

for (const sourceKind of ['lab', 'own', 'site']) {
    test(`参照の ${sourceKind} を置き場で読み、edit 用には従来の相対パスを返す`, async () => {
        const { handler, messages } = fixture();
        const localItem = { ...item, sourceKind, libraryDir: '/library/audio/sample', state: 'cached' };
        handler.assetCatalogItems = [localItem];
        handler.projectService.resolveAsset = handler.projectService.placeLibraryAsset = async () => ({
            success: true, reference: true, libraryDir: localItem.libraryDir, projectAssetPath: '/project/assets/audio/sample'
        });
        handler.files.resolve = async uri => {
            assert.equal(uri.toString(), 'file:///library/audio/sample');
            return { children: ['a.mp3', 'b.mp3'].map(name => ({ name, isDirectory: false })) };
        };
        assert.deepEqual(await handler.resolveCatalogMaterial(item.key), { relativePath: 'assets/audio/sample/b.mp3', kind: 'audio' });
        assert.deepEqual(messages, []);
    });
}
