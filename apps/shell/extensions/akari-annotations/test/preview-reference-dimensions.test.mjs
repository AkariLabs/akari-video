import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { probePreviewMediaDimensions } from '../lib/browser/preview-media-dimensions.js';
import { pendingAssetFetches } from 'akari-preview/lib/common/pending-asset-fetch.js';

const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const source = ts.createSourceFile('widget.ts', readFileSync(
    new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const names = ['addMaterialAtOutputPoint', 'refreshReferenceMediaUris', 'resolveEditMediaUri',
    // 再試行の本体は実物を回す（1 回ぶんの読み取りだけ差し替える）。
    'readMediaSizeInRenderer'];
const methods = names.map(name => widget.members.find(member => member.name?.getText(source) === name).getText(source));
const code = ts.transpileModule(`class Handler { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
// 再試行の待ちは即座に消化する（待ち時間そのものはここでは見ない）。
globalThis.window = { setTimeout: callback => { callback(); return 0; }, clearTimeout() {} };
const Handler = new Function('URI', 'probePreviewMediaDimensions', 'pendingAssetFetches',
    'RENDERER_SIZE_READ_ATTEMPTS', 'RENDERER_SIZE_READ_RETRY_MS',
    `${code}\nreturn Handler;`)(URI,
    options => probePreviewMediaDimensions({ ...options, maxWaitMs: 0 }), pendingAssetFetches, 4, 0);

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
    /*
     * レンダラ側の寸法読み（readMediaSizeInRenderer）は Image / video 要素を使うので node には
     * 無い。ここで見たいのはそれが読めなかったときのバックエンド probe への委譲なので、
     * 読めなかった体で差し替える（読めたときの経路は下の専用テストで見る）。
     */
    let rendererReads = 0;
    handler.readMediaSizeInRendererOnce = async () => { rendererReads++; return undefined; };
    return { handler, calls, notices, libraryUri, rendererReads: () => rendererReads,
        setRendererSize: size => { handler.readMediaSizeInRendererOnce = async () => { rendererReads++; return size; }; },
        setRendererSizeAfter: (failures, size) => {
            handler.readMediaSizeInRendererOnce = async () => { rendererReads++; return rendererReads > failures ? size : undefined; };
        } };
}

for (const [kind, path, width] of [
    ['image', 'assets/still/bg-aurora-mesh/bg.png', 4000],
    ['video', 'assets/broll/scene/scene.mp4', 1920]
]) {
    test(`参照 ${kind} はライブラリ実体の幅から 1/4 scale を計算する`, async () => {
        const { handler, calls, notices, libraryUri, rendererReads } = fixture(path, width);
        await handler.addMaterialAtOutputPoint(path, kind, 3, { x: 50, y: -20 });
        assert.deepEqual(calls[0], { path: libraryUri });
        assert.equal(calls[1][0], path);
        assert.deepEqual(calls[1][4], { transform: { x: 50, y: -20, scale: 1280 / (4 * width) }, placeOnTop: true });
        assert.deepEqual(notices, []);
        assert.equal(rendererReads(), 4, 'まずレンダラで数回読み、読めなければ probe へ委譲する');
    });

    test(`参照 ${kind} はレンダラで寸法が読めれば probe を省く`, async () => {
        const { handler, calls, notices, setRendererSize, rendererReads } = fixture(path, width);
        setRendererSize({ width: 800, height: 450 });
        await handler.addMaterialAtOutputPoint(path, kind, 3, { x: 0, y: 0 });
        assert.equal(rendererReads(), 1);
        // probeSourceDimensions は calls[0] に入るので、先頭が addMaterialAt なら probe に出ていない
        assert.equal(calls[0][0], path);
        assert.deepEqual(calls[0][4], { transform: { x: 0, y: 0, scale: 1280 / (4 * 800) }, placeOnTop: true });
        assert.deepEqual(notices, []);
    });

    test(`参照 ${kind} は取り寄せ中なら読みにも probe にも行かず既定の大きさで置く`, async () => {
        const { handler, calls, notices, rendererReads } = fixture(path, width);
        pendingAssetFetches.begin({ relativePath: path, kind: kind === 'image' ? 'image' : 'video' });
        try {
            await handler.addMaterialAtOutputPoint(path, kind, 3, { x: 0, y: 0 });
        } finally {
            pendingAssetFetches.end(path);
        }
        assert.equal(rendererReads(), 0, '実体がまだ無いものを読みに行かない');
        assert.equal(calls[0][0], path);
        assert.deepEqual(calls[0][4], { transform: { x: 0, y: 0, scale: 1 }, placeOnTop: true });
        assert.match(notices[0], /既定の大きさ/);
    });

    test(`参照 ${kind} は初回だけ読めなくても引き直して正しい幅で置く`, async () => {
        // 置いた直後は参照台帳の反映が追いつかず 1 回目だけ読めないことがある。
        // ここで諦めると ffprobe 依存の probe に落ち、無い環境では原寸で置かれてしまう。
        const { handler, calls, notices, setRendererSizeAfter, rendererReads } = fixture(path, width);
        setRendererSizeAfter(2, { width: 800, height: 450 });
        await handler.addMaterialAtOutputPoint(path, kind, 3, { x: 0, y: 0 });
        assert.equal(rendererReads(), 3);
        assert.equal(calls[0][0], path, 'probe に出ていない');
        assert.deepEqual(calls[0][4], { transform: { x: 0, y: 0, scale: 1280 / (4 * 800) }, placeOnTop: true });
        assert.deepEqual(notices, []);
    });

    test(`参照 ${kind} は 4 回読めなければ probe へ落ちる`, async () => {
        const { handler, calls, rendererReads } = fixture(path, width);
        await handler.addMaterialAtOutputPoint(path, kind, 3, { x: 0, y: 0 });
        assert.equal(rendererReads(), 4);
        assert.deepEqual(calls[0], { path: fixture(path, width).libraryUri });
        assert.deepEqual(calls[1][4], { transform: { x: 0, y: 0, scale: 1280 / (4 * width) }, placeOnTop: true });
    });

    test(`参照 ${kind} は呼び出し側が幅を知っていれば読みも probe もしない`, async () => {
        const { handler, calls, notices, rendererReads } = fixture(path, width);
        await handler.addMaterialAtOutputPoint(path, kind, 3, { x: 0, y: 0 }, false, false, 640);
        assert.equal(rendererReads(), 0);
        assert.equal(calls[0][0], path);
        assert.deepEqual(calls[0][4], { transform: { x: 0, y: 0, scale: 1280 / (4 * 640) }, placeOnTop: true });
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
