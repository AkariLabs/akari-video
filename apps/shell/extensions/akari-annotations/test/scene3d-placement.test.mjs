import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { setLanguage, t } from '@akari-video/i18n';
import { after as resetLanguageAfter } from 'node:test';
import { parseLibraryDragPayload } from '../lib/browser/library-drop-model.js';
import { buildOverlayItem, parseOverlayPlaceRequest } from '../lib/common/overlay-place.js';
import { updateTreeV2Item } from '../lib/common/edit-v2-mutations.js';
import { isScene3dPath, scene3dPlacementVars, scene3dScreenTextureVar, scene3dScreenVars,
    SCENE3D_MAX_SCREEN_BYTES } from '../lib/common/scene3d-item.js';

setLanguage('ja');
resetLanguageAfter(() => setLanguage(undefined));

test('3D のドラッグ payload と配置要求を検証する', () => {
    const payload = { kind: 'scene3d', category: 'scene3d', id: 'sample', key: 'scene3d/sample', title: '3D' };
    assert.deepEqual(parseLibraryDragPayload(JSON.stringify(payload)), payload);
    assert.deepEqual(parseOverlayPlaceRequest({ key: payload.key, t: 1 }), { key: payload.key, t: 1 });
    assert.equal(parseLibraryDragPayload({ ...payload, locked: true }), undefined);
    assert.equal(parseLibraryDragPayload({ ...payload, key: 'overlay/sample' }), undefined);
});

test('動画のドロップは画面 var を 1 回だけ書き、画面の無い 3D は案内する', async () => {
    const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
    const owner = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
    const member = owner.members.find(node => ts.isMethodDeclaration(node)
        && node.name.getText(ast) === 'applyScene3dScreen');
    const code = ts.transpileModule(`class Handler { ${member.getText(ast)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const method = runInContext(`${code}\nHandler.prototype.applyScene3dScreen`, createContext({
        t, scene3dScreenVars, scene3dScreenTextureVar, isScene3dPath,
        SCENE3D_MAX_SCREEN_BYTES, updateTreeV2Item, JSON
    }));
    const path = 'assets/scene3d/sample/fragment.html';
    const editUri = { toString: () => 'edit.json' };
    let doc = { version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [],
        tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'item-1', at: 0, duration: 150,
            source: { kind: 'html', path, vars: { '--akari-3d-clip': 'none' } } }] }] };
    const notices = [];
    let writes = 0;
    let fragment = '<script type="application/json" data-akari-3d-scene>'
        + JSON.stringify({ materialOverrides: { ScreenMaterial: { textureVar: '--akari-screen-src' } } })
        + '</script>';
    const state = { location: { editUri, root: { resolve: value => value } },
        fileService: { resolve: async () => ({ size: 1024 }),
            readFile: async value => ({ value: { toString: () => value === editUri ? JSON.stringify(doc) : fragment } }) },
        refreshReferenceMediaUris: async () => {}, resolveEditMediaUri: value => value,
        commitEditMutation: async (_label, mutate) => { writes++; doc = mutate(doc); },
        messages: { info: value => notices.push(value), warn: value => notices.push(value) },
        errorMessage: error => error.message };
    assert.equal(await method.call(state, 'assets/video/sample.mp4', 'item-1'), true);
    assert.equal(writes, 1);
    assert.equal(doc.tracks[0].items[0].source.vars['--akari-screen-src'], 'assets/video/sample.mp4');
    fragment = '<script type="application/json" data-akari-3d-scene>{}</script>';
    assert.equal(await method.call(state, 'assets/video/sample.mp4', 'item-1'), false);
    assert.equal(writes, 1);
    assert.deepEqual(notices, ['この 3D には画面がありません']);
    state.fileService.resolve = async () => ({ size: SCENE3D_MAX_SCREEN_BYTES + 1 });
    assert.equal(await method.call(state, 'assets/video/sample.mp4', 'item-1'), false);
    assert.equal(writes, 1);
    assert.equal(notices.at(-1), '大きすぎます（720p のプロキシを使ってください）');
});

test('キャンバスの子の 3D 画面を 1 回の編集で更新する', async () => {
    const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
    const owner = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
    const member = owner.members.find(node => ts.isMethodDeclaration(node)
        && node.name.getText(ast) === 'applyScene3dScreen');
    const code = ts.transpileModule(`class Handler { ${member.getText(ast)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const method = runInContext(`${code}\nHandler.prototype.applyScene3dScreen`, createContext({
        t, scene3dScreenVars, scene3dScreenTextureVar, isScene3dPath,
        SCENE3D_MAX_SCREEN_BYTES, updateTreeV2Item, JSON
    }));
    const path = 'assets/scene3d/sample/fragment.html';
    const editUri = { toString: () => 'edit.json' };
    let doc = { version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [],
        tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'canvas', at: 0, duration: 150,
            source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } },
            items: [{ id: 'item-1', at: 0, duration: 150,
                source: { kind: 'html', path, vars: { '--akari-3d-clip': 'none' } } }] }] }] };
    const before = JSON.stringify(doc);
    let writes = 0;
    const fragment = '<script type="application/json" data-akari-3d-scene>'
        + JSON.stringify({ materialOverrides: { ScreenMaterial: { textureVar: '--akari-screen-src' } } })
        + '</script>';
    const state = { location: { editUri, root: { resolve: value => value } },
        fileService: { resolve: async () => ({ size: 1024 }),
            readFile: async value => ({ value: { toString: () => value === editUri ? JSON.stringify(doc) : fragment } }) },
        refreshReferenceMediaUris: async () => {}, resolveEditMediaUri: value => value,
        commitEditMutation: async (_label, mutate) => { writes++; doc = mutate(doc); },
        messages: { info: assert.fail, warn: assert.fail }, errorMessage: error => error.message };
    assert.equal(await method.call(state, 'assets/video/sample.mp4', 'item-1'), true);
    assert.equal(writes, 1);
    assert.equal(doc.tracks[0].items[0].items[0].source.vars['--akari-screen-src'], 'assets/video/sample.mp4');
    assert.equal(doc.tracks[0].items[0].items[0].source.vars['--akari-3d-clip'], 'none');
    assert.equal(doc.tracks[0].items[0].items[0].source.kind, 'html');
    assert.equal(doc.tracks[0].items[0].items[0].source.path, path);
    assert.equal(JSON.parse(before).tracks[0].items[0].items[0].source.vars['--akari-screen-src'], undefined);
});

test('3D は出力の座標で等倍配置し、静止の vars を書く', () => {
    const vars = scene3dPlacementVars({ '--accent': '#fff' });
    const item = buildOverlayItem({ id: 'overlay-1', at: 30, duration: 150,
        path: 'assets/scene3d/sample/fragment.html', output: { width: 1280, height: 720 },
        center: { x: 900, y: 200 }, vars, scene3d: true });
    assert.deepEqual(item.transform, { x: 260, y: -160, scale: 1 });
    assert.equal(item.source.vars['--akari-3d-clip'], 'none');
    assert.equal(item.duration, 150);
    assert.deepEqual(buildOverlayItem({ id: 'overlay-2', at: 0, duration: 150,
        path: 'assets/scene3d/sample/fragment.html', output: { width: 1280, height: 720 },
        vars, scene3d: true }).transform, { x: 0, y: 0, scale: 1 });
});
