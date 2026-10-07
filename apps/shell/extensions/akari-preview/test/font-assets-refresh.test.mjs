import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { bundledCaptionFontFaceCss } from '../lib/common/bundled-caption-fonts.js';

const source = ts.createSourceFile('akari-preview-open-handler.ts',
    readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const owner = source.statements.find(node => ts.isClassDeclaration(node)
    && node.name?.text === 'AkariPreviewOpenHandler');
assert.ok(owner);
const methods = ['refreshFontAssets', 'getOverlayRuntimeAssets'].map(name => {
    const method = owner.members.find(member => member.name?.getText(source) === name);
    assert.ok(method, name);
    return method.getText(source);
});
const compiled = ts.transpileModule(`class Harness { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS }
}).outputText;
const context = vm.createContext({ URI: class {
    constructor(value) { this.value = value; }
    normalizePath() { return this; }
    toString() { return this.value; }
} });
const Harness = vm.runInContext(`${compiled}\nHarness`, context);

test('書体取得後は通常・frame engine 両キャッシュを捨て、開いたプレビューを再構築する', async () => {
    const face = { id: 'zen-kaku-gothic-new', family: 'Zen Kaku Gothic New',
        file: 'ZenKakuGothicNew-Regular.ttf', weight: '400', url: '/font.ttf' };
    let downloaded = false;
    const calls = [];
    const harness = new Harness();
    harness.previewService = { getOverlayRuntimeAssetUrls: async options => {
        calls.push(options?.includeFrameEngine ? 'frame' : 'normal');
        return { bundledCaptionFontFaces: downloaded ? [face] : [] };
    } };
    const widget = { akariPreviewConfigured: true, akariPreviewLastKnownTime: 2.5, isDisposed: false };
    harness.openOutputPreviews = new Map([['file:///project/edit.json', widget]]);
    const refreshes = [];
    harness.queueRefresh = (...args) => refreshes.push(args);

    assert.equal((await harness.getOverlayRuntimeAssets()).bundledCaptionFontFaces.length, 0);
    assert.equal((await harness.getOverlayRuntimeAssets(true)).bundledCaptionFontFaces.length, 0);
    downloaded = true;
    harness.refreshFontAssets({ editUri: 'file:///project/edit.json' });
    const next = await harness.getOverlayRuntimeAssets();
    const frame = await harness.getOverlayRuntimeAssets(true);
    assert.deepEqual(calls, ['normal', 'frame', 'normal', 'frame']);
    assert.equal(frame.bundledCaptionFontFaces[0].family, face.family);
    assert.match(bundledCaptionFontFaceCss(next.bundledCaptionFontFaces), /@font-face[\s\S]*Zen Kaku Gothic New/);
    assert.equal(refreshes.length, 1);
    assert.equal(refreshes[0][0], widget);
    assert.equal(refreshes[0][2], 'output');
    assert.equal(refreshes[0][4], true);
});
