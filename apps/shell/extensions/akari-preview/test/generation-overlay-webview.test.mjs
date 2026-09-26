import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('akari-preview-open-handler.ts', source, ts.ScriptTarget.Latest, true);
const methods = new Map();
function visit(node) {
    if (ts.isMethodDeclaration(node)) methods.set(node.name.getText(ast), node.getText(ast));
    ts.forEachChild(node, visit);
}
visit(ast);

const prepareHtmlMethod = methods.get('prepareHtml');
const previewBootstrapMethod = methods.get('previewBootstrapScript');
assert.ok(prepareHtmlMethod);
assert.ok(previewBootstrapMethod);

test('prepareHtml は生成オーバーレイ層を 1 枚だけ持ち、クリック可能要素を含まない', () => {
    assert.equal(prepareHtmlMethod.split('id="akari-gen-overlay"').length - 1, 1);
    assert.match(prepareHtmlMethod, /#akari-gen-overlay\s*\{[^}]*pointer-events:\s*none/u);
    const start = prepareHtmlMethod.indexOf('<div id="akari-gen-overlay"');
    const end = prepareHtmlMethod.indexOf('\n          </div>', start);
    assert.ok(start >= 0 && end > start);
    const overlay = prepareHtmlMethod.slice(start, end);
    for (const forbidden of [/<button\b/giu, /<a\s/giu, /<input\b/giu, /tabindex/giu, /onclick/giu]) {
        assert.equal((overlay.match(forbidden) || []).length, 0);
    }
});

test('reduced motion、exportLook、生成更新メッセージを webview HTML と script に配線する', () => {
    assert.match(prepareHtmlMethod, /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*#akari-gen-shimmer\s*\{\s*animation:/u);
    assert.match(prepareHtmlMethod, /exportLook\s*=\s*false/u);
    assert.match(prepareHtmlMethod, /scrubAudioEnabled,\s*previewAudioWorkletUrl:/u);
    assert.doesNotMatch(prepareHtmlMethod, /previewDisplayPreferences/u);
    assert.match(previewBootstrapMethod, /akari-preview-set-export-look/u);
    assert.match(previewBootstrapMethod, /akari-preview-generation-update/u);
    assert.match(previewBootstrapMethod, /updateGenerationOverlay\(outputTime\)/u);
    assert.match(previewBootstrapMethod, /describeOverlayFn\(state, clip\.meta, String\(clip\.name \|\| clip\.id \|\| ''\), \{[^}]*clipDurationSec: clip\.end - clip\.start\s*\}, describeNextDraftV1\)/u);
    assert.match(previewBootstrapMethod, /resolveGenerationStateFn\(clip\.meta, Date\.now\(\), clip\.binding, resolveGenerationStateV1\)/u);
});

test('オーロラはクリップの変形とクロップに収まり、動きを減らす設定で止まる', () => {
    assert.match(previewBootstrapMethod, /generationOverlay\.style\.left =/u);
    assert.match(previewBootstrapMethod, /generationOverlay\.style\.top =/u);
    assert.match(previewBootstrapMethod, /crop\.w/u);
    assert.match(previewBootstrapMethod, /transform\.scaleX/u);
    assert.match(prepareHtmlMethod, /#akari-gen-overlay\[data-akari-gen-aurora="planned"\]/u);
    assert.match(prepareHtmlMethod, /#akari-gen-overlay\[data-akari-gen-aurora="planned"\]::before\s*\{\s*opacity: 1; background: linear-gradient\(150deg, rgba\(111,120,240,\.22\)/u);
    assert.match(prepareHtmlMethod, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*#akari-gen-icon\s*\{\s*animation: none/u);
    assert.match(previewBootstrapMethod, /if \(generationExportLook\)\s*\{\s*hideGenerationOverlay\(\)/u);
});

test('sendGenerationUpdate は clip ごとに first frame 逆引きを使う', () => {
    const sendGenerationUpdate = methods.get('sendGenerationUpdate');
    assert.ok(sendGenerationUpdate);
    assert.match(sendGenerationUpdate, /selectGenerationSidecarForSource\(sourcePath, sidecars\.entries\.map/u);
    assert.doesNotMatch(sendGenerationUpdate, /metaBySourcePath\.get\(sourcePath\)|bindingBySourcePath\.get\(sourcePath\)/u);
});

test('frame-engine と legacy の両 tick 経路が生成オーバーレイを更新する', () => {
    const tickStart = previewBootstrapMethod.indexOf('const tick = (immediatePlaybackTick');
    const tickEnd = previewBootstrapMethod.indexOf('const runTickGuarded =', tickStart);
    assert.ok(tickStart >= 0 && tickEnd > tickStart);
    const tickSource = previewBootstrapMethod.slice(tickStart, tickEnd);
    assert.equal(tickSource.split('updateGenerationOverlay(outputTime);').length - 1, 2);
});

test('bootstrap は状態 helper を状態ラッパーより前に注入する', () => {
    const helper = previewBootstrapMethod.indexOf('const resolveGenerationStateV1 = (');
    const wrapper = previewBootstrapMethod.indexOf('const resolveGenerationStateFn = (');
    assert.ok(helper >= 0);
    assert.ok(wrapper > helper);
});


test('小窓とぼかし背景は既存 overlay 内でクリックを奪わず、シマーと帯の下に背景を置く', () => {
    const start = prepareHtmlMethod.indexOf('<div id="akari-gen-overlay"');
    const end = prepareHtmlMethod.indexOf('\n          </div>', start);
    const overlay = prepareHtmlMethod.slice(start, end);
    for (const id of ['akari-gen-pip', 'akari-gen-blur']) {
        assert.ok(overlay.includes(`id="${id}"`));
        assert.match(prepareHtmlMethod, new RegExp(`#${id}\\s*\\{[^}]*pointer-events:\\s*none`, 'u'));
    }
    assert.match(overlay, /最後の絵/u);
    assert.ok(overlay.indexOf('id="akari-gen-blur"') < overlay.indexOf('id="akari-gen-shimmer"'));
    assert.match(prepareHtmlMethod, /#akari-gen-pip\s*\{[^}]*width: 22%/u);
    assert.match(prepareHtmlMethod, /#akari-gen-blur-image\s*\{[^}]*filter: blur\(/u);
    assert.match(previewBootstrapMethod, /generationPip.hidden = true/u);
    assert.match(previewBootstrapMethod, /generationBlur.hidden = true/u);
    assert.match(previewBootstrapMethod, /setGenerationImage\(generationPip, generationPipImage, description.pip, clip.pipUri\)/u);
    assert.match(previewBootstrapMethod, /setGenerationImage\(generationBlur, generationBlurImage, description.blurBackground, clip.blurBackgroundUri\)/u);
});

test('next helper を describeOverlay より前に注入し、画像 URI を既存素材ストリームから同梱する', () => {
    const helper = previewBootstrapMethod.indexOf('const describeNextDraftV1 = (');
    const description = previewBootstrapMethod.indexOf('const describeOverlayFn = (');
    assert.ok(helper >= 0 && description > helper);
    const send = methods.get('sendGenerationUpdate');
    assert.match(send, /this.resolveEditAssetUri\(path, editUri\)/u);
    assert.match(send, /this.createAssetStream\(\{ assetUri \}\)/u);
    assert.match(send, /akariPreviewAssetStreamIds/u);
    assert.match(send, /return \{ \.\.\.clip, pipUri, blurBackgroundUri \}/u);
    assert.match(send, /clips: resolvedClips/u);
});

// 実メソッドを ESM に隔離し、配信経路だけスタブで観測する（Theia の起動は不要）。
async function generationSenderFixture() {
    const modelUrl = new URL('../lib/common/generation-overlay-model.js', import.meta.url).href;
    const storeUrl = new URL('../../../../../packages/edit-store/lib/generation-meta.js', import.meta.url).href;
    const code = ts.transpileModule(`
        import { describeOverlay, resolveGenerationState } from ${JSON.stringify(modelUrl)};
        import { selectGenerationSidecarForSource } from ${JSON.stringify(storeUrl)};
        export default class Sender { ${methods.get('queueGenerationUpdate')} ${methods.get('sendGenerationUpdate')} }
    `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const Sender = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
    const sender = new Sender();
    const calls = [], messages = [], disposed = [];
    const widget = {
        isDisposed: false,
        akariPreviewAssetUrlByUri: new Map(),
        akariPreviewAssetStreamIds: [],
        akariPreviewEditUri: new URL('file:///project/edit.json'),
        akariPreviewSummary: { cuts: [{ id: 'plan', sourcePath: 'assets/still.png' }, { id: 'job', sourcePath: 'assets/job.png' }], output: { fps: 30 } },
        sendMessage: value => messages.push(value)
    };
    sender.currentWorkspaceRoots = async () => ['file:///project'];
    sender.resolveEditAssetUri = (path, editUri) => new URL(path, editUri);
    sender.createAssetStream = async request => {
        calls.push(request.assetUri);
        return { id: `stream-${calls.length}`, url: `http://127.0.0.1/assets/${calls.length}` };
    };
    sender.disposeAssetStreams = async ids => disposed.push(...ids);
    sender.preferences = { get: () => false };
    sender.previewCaptionTimelineSegments = () => [0, 1].map(cutIndex => ({ kind: 'src', cutIndex, outStart: cutIndex * 4, outEnd: cutIndex * 4 + 4 }));
    sender.previewService = { readGenerationSidecars: async () => ({ itemNames: {}, entries: [
        { sourcePath: 'assets/still.png', meta: { kind: 'still', status: 'done', next: {
            kind: 'video', status: 'planned', model: { id: 'model' },
            inputs: { first_frame: { path: 'assets/still.png' }, last_frame: { path: 'assets/last image.png' } }
        } } },
        { sourcePath: 'assets/job.png', meta: { kind: 'video', status: 'generating', inputs: { first_frame: { path: 'assets/reference.png' } } } }
    ] }) };
    return { sender, widget, calls, messages, disposed };
}

test('sendGenerationUpdate は小窓・背景の URI を配信し、再更新でストリームを再利用する', async () => {
    const { sender, widget, calls, messages } = await generationSenderFixture();
    await sender.sendGenerationUpdate(widget);
    await sender.sendGenerationUpdate(widget);
    assert.deepEqual(calls, ['file:///project/assets/last%20image.png', 'file:///project/assets/reference.png']);
    assert.equal(messages.length, 4);
    assert.equal(messages[0].type, 'akari-preview-generation-update');
    assert.deepEqual(messages[1].clips.map(({ pipUri, blurBackgroundUri }) => ({ pipUri, blurBackgroundUri })), [
        { pipUri: 'http://127.0.0.1/assets/1', blurBackgroundUri: null },
        { pipUri: null, blurBackgroundUri: 'http://127.0.0.1/assets/2' }
    ]);
    assert.deepEqual(widget.akariPreviewAssetStreamIds, ['stream-1', 'stream-2']);
});

test('音の空の枠が生成中なら映像より先にプレビューへ配信する', async () => {
    const { sender, widget, messages, calls } = await generationSenderFixture();
    sender.fileService = { readFile: async () => ({ value: Buffer.from(JSON.stringify({
        output: { fps: 30 }, sources: [{ id: 'audio-src', path: 'assets/generated/frame-audio.wav' }],
        tracks: [{ lane: 'audio', items: [{ id: 'audio-frame', at: 30, duration: 60,
            source: { kind: 'media', src: 'audio-src' } }] }]
    })) }) };
    const originalRead = sender.previewService.readGenerationSidecars;
    sender.previewService.readGenerationSidecars = async () => {
        const result = await originalRead();
        result.entries.push({ sourcePath: 'assets/generated/frame-audio.wav',
            meta: { kind: 'audio', status: 'generating', job: { started_at: new Date().toISOString() } } });
        return result;
    };
    await sender.sendGenerationUpdate(widget);
    assert.equal(messages[0].clips[0].id, 'audio-frame');
    assert.equal(messages[0].clips[0].kind, 'audio');
    assert.equal(messages[0].clips[0].meta.status, 'generating');
    assert.equal(calls.includes('file:///project/assets/generated/frame-audio.wav'), false);
});

test('画像の解決中にプレビューが閉じたらストリームを破棄し追加更新を送らない', async () => {
    const { sender, widget, messages, disposed } = await generationSenderFixture();
    sender.createAssetStream = async () => {
        widget.isDisposed = true;
        return { id: 'late-stream', url: 'http://127.0.0.1/assets/late' };
    };
    await sender.sendGenerationUpdate(widget);
    assert.deepEqual(disposed, ['late-stream']);
    assert.equal(messages.length, 1, '破棄前に状態を送り、破棄後は追加送信しない');
    assert.ok(messages[0].clips.every(clip => clip.pipUri === null && clip.blurBackgroundUri === null));
});

test('URI 解決中に summary と素材 Map が置き換わっても状態更新を捨てない', async () => {
    const { sender, widget, messages, calls, disposed } = await generationSenderFixture();
    const create = sender.createAssetStream;
    sender.createAssetStream = async request => {
        widget.akariPreviewSummary = { ...widget.akariPreviewSummary };
        widget.akariPreviewAssetUrlByUri = new Map();
        return create(request);
    };
    await sender.sendGenerationUpdate(widget);
    assert.ok(messages.length > 0, '競合しても generation-update を送る');
    assert.equal(messages.at(-1).type, 'akari-preview-generation-update');
    assert.deepEqual(messages.at(-1).clips.map(clip => clip.meta.status), ['done', 'generating']);
    assert.ok(messages.at(-1).clips.every(clip => clip.pipUri === null && clip.blurBackgroundUri === null));
    assert.deepEqual(disposed, calls.map((_, index) => `stream-${index + 1}`));
    assert.deepEqual(widget.akariPreviewAssetStreamIds, []);
});


test('素材 Map が未準備でも Map を作らず、取得ストリームを既存の破棄リストへ渡す', async () => {
    const { sender, widget, messages, disposed } = await generationSenderFixture();
    widget.akariPreviewAssetUrlByUri = undefined;
    await sender.sendGenerationUpdate(widget);
    assert.equal(widget.akariPreviewAssetUrlByUri, undefined);
    assert.deepEqual(widget.akariPreviewAssetStreamIds, ['stream-1', 'stream-2']);
    assert.equal(messages.at(-1).clips[0].pipUri, 'http://127.0.0.1/assets/1');
    assert.equal(messages.at(-1).clips[1].blurBackgroundUri, 'http://127.0.0.1/assets/2');
    assert.deepEqual(disposed, []);
});

test('画像 RPC が未完了でも状態は先に届き、失敗しても小札と帯の meta は届く', async t => {
    const warnings = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args));
    const { sender, widget, messages } = await generationSenderFixture();
    let rejectImage;
    let started;
    const imageStarted = new Promise(resolve => { started = resolve; });
    sender.createAssetStream = () => {
        started();
        return new Promise((_, reject) => { rejectImage = reject; });
    };
    const update = sender.sendGenerationUpdate(widget);
    await imageStarted;
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].clips.map(clip => clip.meta.status), ['done', 'generating']);
    sender.createAssetStream = async () => { throw new Error('missing reference'); };
    rejectImage(new Error('missing last frame'));
    await update;
    assert.ok(messages.at(-1).clips.every(clip => clip.pipUri === null && clip.blurBackgroundUri === null));
    assert.equal(warnings.length, 2);
});

test('summary だけの差し替えは画像を捨てず、最新の cuts で更新する', async () => {
    const { sender, widget, messages, disposed } = await generationSenderFixture();
    const create = sender.createAssetStream;
    sender.createAssetStream = async request => {
        widget.akariPreviewSummary = {
            ...widget.akariPreviewSummary,
            cuts: widget.akariPreviewSummary.cuts.map(cut => ({ ...cut, id: cut.id + '-updated' }))
        };
        return create(request);
    };
    await sender.sendGenerationUpdate(widget);
    assert.deepEqual(messages.at(-1).clips.map(clip => clip.id), widget.akariPreviewSummary.cuts.map(cut => cut.id));
    assert.ok(messages.at(-1).clips[0].pipUri);
    assert.ok(messages.at(-1).clips[1].blurBackgroundUri);
    assert.deepEqual(disposed, []);
});

test('取得済み画像がある途中でストリーム所有リストが替われば全取得分を破棄する', async () => {
    const { sender, widget, messages, disposed } = await generationSenderFixture();
    const create = sender.createAssetStream;
    sender.createAssetStream = async request => {
        const stream = await create(request);
        if (stream.id === 'stream-2') widget.akariPreviewAssetStreamIds = ['new-preview-stream'];
        return stream;
    };
    await sender.sendGenerationUpdate(widget);
    assert.deepEqual(disposed, ['stream-1', 'stream-2']);
    assert.deepEqual(widget.akariPreviewAssetStreamIds, ['new-preview-stream']);
    assert.ok(messages.at(-1).clips.every(clip => clip.pipUri === null && clip.blurBackgroundUri === null));
});

test('生成更新キューはプレビュー読み込み完了を待ち、サイドカーの再要求も順に送る', async () => {
    const { sender, widget, messages } = await generationSenderFixture();
    let finishRefresh;
    widget.akariPreviewRefresh = new Promise(resolve => { finishRefresh = resolve; });
    sender.queueGenerationUpdate(widget);
    await Promise.resolve();
    assert.deepEqual(messages, []);
    widget.akariPreviewAssetUrlByUri = new Map();
    widget.akariPreviewSummary = { ...widget.akariPreviewSummary };
    finishRefresh();
    await widget.akariPreviewGenerationUpdate;
    assert.equal(messages.length, 2);
    sender.queueGenerationUpdate(widget);
    await widget.akariPreviewGenerationUpdate;
    assert.equal(messages.length, 4);
});


test('webview の全ラッパー呼び出しは minify された既定値に頼らず helper を明示する', () => {
    const counts = { resolveGenerationStateFn: 0, describeOverlayFn: 0 };
    // bootstrap は template literal 内なので、呼び出しを含む固定部分を別途 JS として検査する。
    const start = previewBootstrapMethod.indexOf('const updateGenerationOverlay =');
    const end = previewBootstrapMethod.indexOf('const onMainVideoLoadedMetadata =', start);
    assert.ok(start >= 0 && end > start);
    const update = ts.createSourceFile('generation-update.js', previewBootstrapMethod.slice(start, end), ts.ScriptTarget.Latest, true);
    const visitCalls = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            const name = node.expression.text;
            if (Object.hasOwn(counts, name)) {
                counts[name]++;
                const state = name === 'resolveGenerationStateFn';
                assert.equal(node.arguments.length, state ? 4 : 5);
                assert.equal(node.arguments.at(-1).getText(update), state ? 'resolveGenerationStateV1' : 'describeNextDraftV1');
            }
        }
        ts.forEachChild(node, visitCalls);
    };
    visitCalls(update);
    for (const [name, count] of Object.entries(counts)) {
        assert.ok(count > 0);
        assert.equal(previewBootstrapMethod.split(name + '(').length - 1, count, `${name}: 検査外の呼び出しが無い`);
    }
});


test('生成 overlay の文字と札は逆倍率で補正し、絵に重なる部分の比率は維持する', () => {
    for (const id of ['tag', 'pip-label', 'band', 'mask-label']) {
        const rule = prepareHtmlMethod.match(new RegExp(`#akari-gen-${id}\\s*\\{([^}]+)`, 'u'))?.[1];
        assert.ok(rule, id);
        assert.match(rule, /font: calc\(12px \* var\(--akari-gen-inv-scale\)\)/u, id);
    }
    assert.match(prepareHtmlMethod, /#akari-gen-tag \{[^}]*min-height: calc\(22px \* var\(--akari-gen-inv-scale\)\)/u);
    assert.match(prepareHtmlMethod, /#akari-gen-band \{[^}]*height: calc\(26px \* var\(--akari-gen-inv-scale\)\)/u);
    assert.match(prepareHtmlMethod, /#akari-gen-band-bar \{[^}]*height: calc\(3px \* var\(--akari-gen-inv-scale\)\)/u);
    assert.match(prepareHtmlMethod, /#akari-gen-pip \{[^}]*width: 22%/u);
    assert.match(prepareHtmlMethod, /#akari-gen-blur-image \{[^}]*filter: blur\(18px\)/u);
    assert.match(prepareHtmlMethod, /#akari-gen-mask \{[^}]*border: 2px dashed/u);
    assert.match(methods.get('hostAdapterScript'), /layersStage\.style\.transform = stageTransform;\s*window\.akari\.updateGenerationOverlayLayout\?\.\(\);/u);
    const zoom = previewBootstrapMethod.slice(previewBootstrapMethod.indexOf('const renderZoom ='), previewBootstrapMethod.indexOf('const setZoom ='));
    assert.match(zoom, /globalThis\.window\?\.akari\?\.updateGenerationOverlayLayout\?\.\(\);/u);
    assert.match(previewBootstrapMethod, /window\.akari\.updateGenerationOverlayLayout = updateGenerationOverlayLayout/u);
    assert.match(previewBootstrapMethod, /generationMask\.style\.height[^;]+;\s*\}\s*updateGenerationOverlayLayout\(\);/u);
});

test('生成 overlay のレイアウトは実効倍率を使い、収まらない動画予定だけを省略して再拡大で復元する', () => {
    const start = previewBootstrapMethod.indexOf('const updateGenerationOverlayLayout = () => {');
    const end = previewBootstrapMethod.indexOf('if (generationOverlay) window.akari.updateGenerationOverlayLayout =', start);
    assert.ok(start >= 0 && end > start);
    const run = new Function('layersStage', 'generationOverlay', 'generationBand', 'generationTag', 'generationTagText',
        previewBootstrapMethod.slice(start, end) + '\nupdateGenerationOverlayLayout();');
    let screenWidth = 810;
    const stage = { offsetWidth: 1920, getBoundingClientRect: () => ({ width: screenWidth }) };
    const properties = new Map();
    const overlay = { hidden: false, style: { setProperty: (name, value) => properties.set(name, value) } };
    const band = { hidden: true };
    const tag = { textContent: '', clientWidth: 300, get scrollWidth() { return this.textContent.length * 12; } };
    const full = '▶ 動画予定 · 最初→最後';
    for (screenWidth of [810, 400, 1920, 3840]) {
        run(stage, overlay, band, tag, full);
        assert.equal(Number(properties.get('--akari-gen-inv-scale')), 1920 / screenWidth);
        assert.equal(properties.get('--akari-gen-band-space'), '0px');
        assert.equal(tag.textContent, full);
    }
    tag.clientWidth = 100;
    run(stage, overlay, band, tag, full);
    assert.equal(tag.textContent, '▶ 動画予定');
    tag.clientWidth = 300;
    band.hidden = false;
    run(stage, overlay, band, tag, full);
    assert.equal(tag.textContent, full);
    assert.equal(properties.get('--akari-gen-band-space'), '26px');
    screenWidth = 0;
    properties.clear();
    run(stage, overlay, band, tag, full);
    assert.equal(properties.size, 0, '非表示寸法から Infinity を CSS に流さない');
});
