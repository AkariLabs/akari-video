import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { probePreviewMediaDimensions } from '../lib/browser/preview-media-dimensions.js';

const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const source = ts.createSourceFile('widget.ts', readFileSync(
    new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const names = ['addMaterialAtOutputPoint', 'refreshReferenceMediaUris', 'resolveEditMediaUri'];
const methods = names.map(name => widget.members.find(member => member.name?.getText(source) === name).getText(source));
const code = ts.transpileModule(`class Handler { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const Handler = new Function('URI', 'probePreviewMediaDimensions', `${code}\nreturn Handler;`)(URI,
    options => probePreviewMediaDimensions({ ...options, maxWaitMs: 0 }));

function fixture(relativePath, sourceWidth) {
    const handler = new Handler();
    const project = new URI('file:///project');
    handler.location = { root: project, editUri: new URI('file:///project/edit.json') };
    handler.editDocument = { output: { width: 1280, height: 720 }, tracks: [] };
    handler.referenceMediaGeneration = 0;
    handler.referenceMediaRoot = '';
    handler.referenceMediaUris = {};
    const libraryUri = `file:///library/${relativePath.slice('assets/'.length)}`;
    const calls = [], notices = [];
    handler.annotationsService = {
        async projectReferenceMediaUris(request) {
            assert.equal(request.projectRootUri, project.toString());
            assert.ok(request.declaredPaths.includes(relativePath));
            return { [relativePath]: libraryUri };
        },
        async probeSourceDimensions(request) {
            calls.push(request);
            return sourceWidth ? { width: sourceWidth, height: 1080 } : {};
        }
    };
    handler.addMaterialAt = async (...args) => { calls.push(args); };
    handler.messages = { warn: text => notices.push(text) };
    return { handler, calls, notices, libraryUri };
}

for (const [kind, path, width] of [
    ['image', 'assets/still/bg-aurora-mesh/bg.png', 4000],
    ['video', 'assets/broll/scene/scene.mp4', 1920]
]) {
    test(`参照 ${kind} はライブラリ実体の幅から 1/4 scale を計算する`, async () => {
        const { handler, calls, notices, libraryUri } = fixture(path, width);
        await handler.addMaterialAtOutputPoint(path, kind, 3, { x: 50, y: -20 });
        assert.deepEqual(calls[0], { path: libraryUri });
        assert.equal(calls[1][0], path);
        assert.deepEqual(calls[1][4], { transform: { x: 50, y: -20, scale: 1280 / (4 * width) }, placeOnTop: true });
        assert.deepEqual(notices, []);
    });
}

test('寸法が取れなければ落下位置に既定の大きさで置き通知する', async () => {
    const path = 'assets/still/unknown/unknown.png';
    const { handler, calls, notices } = fixture(path, undefined);
    await handler.addMaterialAtOutputPoint(path, 'image', 3, { x: 50, y: -20 });
    assert.deepEqual(calls[1][4], { transform: { x: 50, y: -20, scale: 1 }, placeOnTop: true });
    assert.match(notices[0], /既定の大きさ/);
});

test('初回の実体取得が未完了でも参照表から引き直して正しい幅で置く', async () => {
    let clock = 0, resolutions = 0, probes = 0;
    const dimensions = await probePreviewMediaDimensions({
        resolveUri: async () => { resolutions++; return 'file:///library/broll/scene/scene.mp4'; },
        probe: async () => { probes++; return probes < 3 ? {} : { width: 1280, height: 720 }; },
        now: () => clock, wait: async milliseconds => { clock += milliseconds; },
        intervalMs: 400, maxWaitMs: 1200
    });
    assert.deepEqual(dimensions, { width: 1280, height: 720 });
    assert.equal(resolutions, 3);
    assert.equal(probes, 3);
    assert.equal(1280 / (4 * dimensions.width), 0.25);
});

test('再試行の上限後だけ寸法なしを返す', async () => {
    let clock = 0, probes = 0;
    const dimensions = await probePreviewMediaDimensions({
        resolveUri: async () => 'file:///library/broll/scene/scene.mp4',
        probe: async () => { probes++; throw new Error('取得中'); },
        now: () => clock, wait: async milliseconds => { clock += milliseconds; },
        intervalMs: 400, maxWaitMs: 800
    });
    assert.equal(dimensions, undefined);
    assert.equal(probes, 3);
    assert.equal(clock, 800);
});
