import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '..');
const compiledHandler = readFileSync(
    join(extensionRoot, 'lib', 'browser', 'akari-preview-open-handler.js'),
    'utf8'
);

function section(start, end) {
    const startAt = compiledHandler.indexOf(start);
    assert.notEqual(startAt, -1, `${start} が compiled handler に見つからない`);
    const endAt = compiledHandler.indexOf(end, startAt + start.length);
    assert.notEqual(endAt, -1, `${end} が compiled handler に見つからない`);
    return compiledHandler.slice(startAt, endAt);
}

test('engine 面の生成 HTML は土台 video に src を持たせない', () => {
    assert.match(
        compiledHandler,
        /const frameEngineScripts = frameEngineEnabled && assets\.frameEngineJavaScript[\s\S]*?: '';/u
    );
    assert.match(compiledHandler, /frameEngineEnabled: Boolean\(frameEngineScripts\),/u);
    assert.match(
        compiledHandler,
        /<video id="preview-video"[^\n]*\$\{frameEngineScripts \|\| primaryIsStillImage \|\| !videoSource \? '' : ` src="\$\{this\.escapeHtml\(videoSource\)\}"`\} preload="\$\{frameEngineScripts \? 'none' : 'auto'\}"/u
    );
    assert.match(compiledHandler, /const frameEngineMediaIdle = initial\.frameEngineEnabled === true;/u);
});

test('engine 面の enterSegment は土台 video にインライン visibility=hidden を書かない', () => {
    const enterSegment = section('const enterSegment = index =>', 'const stopAtNaturalEnd =');
    const engineBranch = enterSegment.slice(0, enterSegment.indexOf("if (segment.kind === 'gap')"));
    assert.doesNotMatch(engineBranch, /video\.style\.visibility = 'hidden'/u);
});

test('engine 面の layer video は src より先に metadata-only を宣言する', () => {
    const layerSetup = section('const layerEntries =', '// video FX rail');
    const preloadAt = layerSetup.indexOf("layerVideo.preload = frameEngineMediaIdle ? 'metadata' : 'auto';");
    const sourceAt = layerSetup.indexOf('layerVideo.src = layer.src;');
    assert.notEqual(preloadAt, -1);
    assert.notEqual(sourceAt, -1);
    assert.ok(preloadAt < sourceAt, 'preload=metadata は layer src の割り当てより先であること');
    assert.match(layerSetup, /if \(!layerIsImage && frameEngineMediaIdle\) layerVideo\.preload = 'metadata';\s*layerVideo\.src = layer\.src;/u);
});

test('engine 面の renderLayers は表示と幾何だけを更新して媒体を再生・シークしない', () => {
    const renderLayers = section('const renderLayers = timelineTime =>', 'const renderCutLayerStyleVisual =');
    assert.match(renderLayers, /if \(entry\.deferredTelop && !frameEngineMediaIdle\)/u);
    assert.match(renderLayers, /if \(!frameEngineMediaIdle && !layerVideo\.paused\) layerVideo\.pause\(\);/u);
    assert.match(renderLayers, /if \(frameEngineMediaIdle\) continue;[\s\S]*?layerVideo\.currentTime = target;/u);
    assert.match(renderLayers, /if \(frameEngineMediaIdle\) continue;[\s\S]*?layerVideo\.play\(\)/u);
    assert.match(renderLayers, /if \(anyKeyframeApplied && window\.akari\.updateLayerLayout\)/u);
    assert.match(renderLayers, /entry\.element\.style\.display = !allTracksHiddenByScope\.layers/u);
});

test('engine 面の当たり判定は実寸とクロップ窓を使う トラック z 順の 1 パス', () => {
    const geometry = section('const layerGeometryHitAt =', 'const layerScreenRectForVideoRect =');
    assert.match(geometry, /const width = Number\(entry\.video\.videoWidth\) \|\| 0;/u);
    assert.match(geometry, /const height = Number\(entry\.video\.videoHeight\) \|\| 0;/u);
    assert.match(geometry, /point\.x >= crop\.x \* width[\s\S]*?point\.y < \(crop\.y \+ crop\.h\) \* height/u);

    const findHit = section('const findVisualMediaHitAt =', '// cuts / layers / overlays / captions');
    const engineBranch = findHit.slice(0, findHit.indexOf('return document.elementsFromPoint'));
    assert.match(engineBranch, /for \(const entry of layerEntries\)/u);
    assert.match(engineBranch, /\(entry\.video\.videoWidth \|\| entry\.video\.naturalWidth\) > 0[\s\S]*?\(entry\.video\.videoHeight \|\| entry\.video\.naturalHeight\) > 0/u);
    assert.match(engineBranch, /layerGeometryHitAt\(entry, event\.clientX, event\.clientY\)/u);
    assert.doesNotMatch(engineBranch, /layerAlphaAtPoint|\.filter\(|entry\.video\.getBoundingClientRect/u);
    assert.equal((engineBranch.match(/for \(const entry of layerEntries\)/gu) || []).length, 1);
    assert.match(engineBranch, /hits\.sort\(\(a, b\) => Number\(b\.style\.zIndex\) - Number\(a\.style\.zIndex\)\);/u);
    assert.match(engineBranch, /const bounds = video\.getBoundingClientRect\(\);/u);
    assert.match(engineBranch, /return hits\[0\] \|\| null;/u);
    assert.equal((compiledHandler.match(/findVisualMediaHitAt\(event\)/gu) || []).length, 3);
});

test('engine 面の pointerdown は previewStage へ一度だけ委譲し操作 UI を横取りしない', () => {
    const pointerWiring = section(
        'const handledVisualPointerDownEvents = new WeakSet()',
        'for (const handle of layerHandleElements)'
    );
    assert.match(pointerWiring, /const handleVisualMediaPointerDown = event =>/u);
    assert.match(pointerWiring, /handledVisualPointerDownEvents\.has\(event\)[\s\S]*?\.add\(event\)/u);
    assert.match(pointerWiring, /if \(penModeActive \|\| rectModeActive\) return;/u);
    assert.match(pointerWiring, /const domItem = target\?\.closest\?\.\('\[data-overlay-id\], #caption-plate'\);/u);
    assert.match(pointerWiring, /if \(!mediaHit \|\| Number\(mediaHit\.style\.zIndex\) <= Number\(domItem\.style\.zIndex\)\) return;/u);
    assert.match(pointerWiring, /coveredDomHit = mediaHit;\s*event\.stopPropagation\(\);/u);
    for (const selector of [
        '[data-akari-interaction]', '[data-overlay-id]', '#overlay-stage', '#caption-plate',
        '#layer-select-box', '#layer-crop-box', '#layer-crop-toggle',
        '#layer-perspective-toggle', '#layer-perspective-panel', '#cut-select-box', '#pen-layer'
    ]) {
        assert.ok(pointerWiring.includes(selector), `${selector} の優先ガードが無い`);
    }
    assert.match(
        pointerWiring,
        /layersStage\.addEventListener\('pointerdown', handleVisualMediaPointerDown, true\);\s*if \(frameEngineMediaIdle\) \{\s*previewStage\.addEventListener\('pointerdown', handleVisualMediaPointerDown, true\);/u
    );
    assert.equal((pointerWiring.match(/previewStage\.addEventListener\('pointerdown'/gu) || []).length, 1);
});

test('engine 面の選択枠はボディもハンドルも操作できる', () => {
    assert.match(
        compiledHandler,
        /#preview-stage\[data-frame-engine-active="true"\] #layer-select-box\.is-active \{ pointer-events: auto; \}/u
    );
    assert.match(
        compiledHandler,
        /#preview-stage\[data-frame-engine-active="true"\] #layer-select-box\.is-active \.akari-layer-handle,\s*#preview-stage\[data-frame-engine-active="true"\] #layer-select-box\.is-active \.akari-layer-rotate-stem \{ pointer-events: auto; \}/u
    );
    assert.match(
        compiledHandler,
        /#layer-select-box\.is-active \{ display: block; pointer-events: auto; cursor: move; \}/u
    );
    assert.match(compiledHandler, /layerSelectBox\.addEventListener\('pointerdown'/u);
});

test('engine 面の枠と clip はアルファ走査を使わずクロップ窓へ退避する', () => {
    const syncHitRegion = section('const syncLayerHitRegion =', 'for (const entry of layerEntries)');
    const engineBranch = syncHitRegion.slice(0, syncHitRegion.indexOf('if (forceMeasure)'));
    assert.match(engineBranch, /if \(frameEngineMediaIdle\)[\s\S]*?entry\.opaqueBox = null;/u);
    assert.doesNotMatch(engineBranch, /measureLayerOpaqueBox|drawImage|getImageData/u);
    assert.match(engineBranch, /delete entry\.video\.dataset\.akariOpaqueH;/u);
    assert.match(compiledHandler, /media\.style\.clipPath = resolveLayerHitRegionClipFn\(/u);
    assert.match(compiledHandler, /if \(frameEngineMediaIdle\)[\s\S]*?entry\.opaqueBox = null;[\s\S]*?const naturalBox = entry\.opaqueBox \|\|/u);
});

test('engine 面の土台・遷移・still・FX の媒体入力経路は無効', () => {
    for (const pattern of [
        /const applySegmentSource = \(segment, onReady\) => \{\s*if \(frameEngineMediaIdle\) return false;/u,
        /const primeStandbySegment = \(index, segment\) => \{\s*if \(frameEngineMediaIdle\) return;/u,
        /const applyTransitionSegmentSource = \(segment, onReady\) => \{\s*if \(frameEngineMediaIdle\) return false;/u,
        /preloadUpcomingTransition = timelineTime => \{\s*if \(frameEngineMediaIdle\) return;/u,
        /preloadUpcomingCut = timelineTime => \{\s*if \(frameEngineMediaIdle\) return;/u,
        /const showStillImage = url => \{\s*if \(frameEngineMediaIdle\)/u,
        /const renderVideoFx = timelineTime => \{\s*if \(frameEngineMediaIdle\) return;/u,
        /const renderTransitionComposite = timelineTime => \{\s*if \(frameEngineMediaIdle\)/u
    ]) {
        assert.match(compiledHandler, pattern);
    }
    assert.match(compiledHandler, /const hasBaseVideoFx = Boolean[\s\S]*?&& !frameEngineMediaIdle;/u);
    assert.match(compiledHandler, /entry\.fxRail = !frameEngineMediaIdle && entry\.spec\.chromaKey/u);
});

test('capture delegation selects media covering HTML/captions once and leaves foreground DOM and tools alone', () => {
    const wiring = section('const handledVisualPointerDownEvents = new WeakSet()', 'for (const handle of layerHandleElements)');
    const listeners = [];
    const calls = [];
    const surface = name => ({ addEventListener: (type, listener, capture) => listeners.push({ name, type, listener, capture }) });
    const video = { dataset: { akariCutIndex: '0' }, style: { zIndex: '15' } };
    const context = {
        frameEngineMediaIdle: true, video, stillImage: {}, previewStage: surface('preview'),
        layersStage: surface('layers'), stage: {}, penModeActive: false, rectModeActive: false, cropModeActive: false,
        findVisualMediaHitAt: () => video,
        selectCut: () => calls.push('cut'), cutDragTarget: () => video,
        pointerTranslationFrom: () => () => ({ x: 0, y: 0 }),
        beginMediaTransformDrag: target => { assert.equal(target, video); calls.push('drag'); }
    };
    new Function(...Object.keys(context), wiring)(...Object.values(context));
    assert.deepEqual(listeners.map(({ name, type, capture }) => [name, type, capture]),
        [['layers', 'pointerdown', true], ['preview', 'pointerdown', true]]);
    assert.equal(listeners[0].listener, listeners[1].listener);
    for (const selector of ['[data-overlay-id]', '#caption-plate', '#layer-select-box', '#cut-select-box', '#pen-layer']) {
        for (const zIndex of ['14', '15', '16']) {
            calls.length = 0;
            const target = { style: { zIndex }, closest: selectors => selectors.split(',').map(s => s.trim()).includes(selector) ? target : null };
            const event = { target, button: 0, stopPropagation() { calls.push('stop'); } };
            for (const { listener } of listeners) listener(event);
            assert.deepEqual(calls, ['[data-overlay-id]', '#caption-plate'].includes(selector) && zIndex === '14'
                ? ['stop', 'cut', 'drag'] : [], `${selector} at z=${zIndex}`);
        }
    }
});
