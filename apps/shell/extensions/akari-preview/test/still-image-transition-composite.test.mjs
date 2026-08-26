import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
    join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'),
    'utf8'
);
const compiled = readFileSync(
    join(here, '..', 'lib', 'browser', 'akari-preview-open-handler.js'),
    'utf8'
);

// open handler の webview はテンプレート文字列として生成されるため、既存の webview
// wiring テストと同じく compiled lib から実行時相当の JS を抜いて構文も検査する。
function extractTemplate(methodName) {
    const methodAt = compiled.lastIndexOf(`${methodName}()`);
    assert.notEqual(methodAt, -1, `${methodName}() が compiled lib に見つからない`);
    const tick = compiled.indexOf('`', methodAt);
    assert.notEqual(tick, -1, `${methodName}() のテンプレートリテラルが見つからない`);
    let i = tick + 1;
    let out = '';
    while (i < compiled.length) {
        const ch = compiled[i];
        if (ch === '\\') {
            const next = compiled[i + 1];
            if (next === 'n') out += '\n';
            else if (next === 't') out += '\t';
            else if (next === 'r') out += '\r';
            else out += next;
            i += 2;
            continue;
        }
        if (ch === '`') break;
        if (ch === '$' && compiled[i + 1] === '{') {
            let braces = 1;
            i += 2;
            while (i < compiled.length && braces > 0) {
                const c = compiled[i];
                if (c === '\\') { i += 2; continue; }
                if (c === '{') braces += 1;
                else if (c === '}') braces -= 1;
                i += 1;
            }
            out += '0';
            continue;
        }
        out += ch;
        i += 1;
    }
    return out;
}

const bootstrap = extractTemplate('previewBootstrapScript');
const compositeStart = bootstrap.indexOf('const renderTransitionComposite = timelineTime =>');
const compositeEnd = bootstrap.indexOf('const renderLayers = timelineTime =>', compositeStart);
const composite = bootstrap.slice(compositeStart, compositeEnd);
const preloadStart = bootstrap.indexOf('preloadUpcomingTransition = timelineTime =>');
const preloadEnd = bootstrap.indexOf('const stillUrlForSegment =', preloadStart);
const preload = bootstrap.slice(preloadStart, preloadEnd);

function extractConstArrow(name, nextName) {
    const start = bootstrap.indexOf(`const ${name} =`);
    const end = bootstrap.indexOf(`const ${nextName} =`, start);
    assert.ok(start >= 0 && end > start, `${name} .. ${nextName}`);
    const declaration = bootstrap.slice(start, end).trim().replace(/;$/u, '');
    return declaration.slice(declaration.indexOf('=') + 1).trim();
}

test('静止画 incoming 合成レイヤーが DOM と生成 JS に配線される', () => {
    assert.match(compiled, /id="transition-still" data-akari-transition-role="incoming-still"/);
    assert.match(compiled, /#preview-video, #standby-video, #transition-video, #transition-still/);
    assert.match(compiled, /#standby-video, #transition-video, #transition-still \{ display: none; pointer-events: none; \}/);
    assert.match(bootstrap, /getElementById\('transition-still'\)/);
    assert.doesNotThrow(() => new vm.Script(bootstrap, { filename: 'preview-bootstrap.js' }));
});

test('runtime mount 後も fallback label を transition plate と caption plate の間へ再アタッチする', () => {
    const mountStart = bootstrap.indexOf('Promise.all([window.__akariCaptionFontReady');
    const mountEnd = bootstrap.indexOf('const reportOverlaySelectionChange', mountStart);
    const mount = bootstrap.slice(mountStart, mountEnd);
    const append = mount.match(/stage\.append\(([^)]+)\)/u);
    assert.ok(append, 'runtime mount 後の stage.append が存在する');
    assert.deepEqual(
        append[1].split(',').map(value => value.trim()),
        ['transitionPlate', 'transitionFallbackLabel', 'captionPlate']
    );
});

test('合成中の applyCutsZIndex は composite が確定した outgoing z を巻き戻さない', () => {
    const context = {
        activeTransitionWindowKey: '1:2:1',
        zForTrack: () => 0,
        video: { style: { zIndex: '9' } },
        stillImage: { style: { zIndex: '9' } },
        transitionPlate: { style: { zIndex: '' } },
        transitionFallbackLabel: { style: { zIndex: '' } }
    };
    const applyCutsZIndex = vm.runInNewContext(
        `(${extractConstArrow('applyCutsZIndex', 'cutHasLayerStyleVisual')})`,
        context
    );
    applyCutsZIndex({ kind: 'src', trackId: 'v-main' });
    assert.equal(context.video.style.zIndex, '9');
    assert.equal(context.stillImage.style.zIndex, '9');
    assert.equal(context.transitionPlate.style.zIndex, '0');
    assert.equal(context.transitionFallbackLabel.style.zIndex, '2');

    context.activeTransitionWindowKey = null;
    applyCutsZIndex({ kind: 'src', trackId: 'v-main' });
    assert.equal(context.video.style.zIndex, '0');
    assert.equal(context.stillImage.style.zIndex, '0');
});

test('transition transform 書き込みは同じ base/progress で再入しても積み上がらない', () => {
    const writeTransitionTransform = vm.runInNewContext(
        `(${extractConstArrow('writeTransitionTransform', 'transitionEngineBlockSize')})`
    );
    const element = { style: { transform: 'scale(99)' } };
    const first = writeTransitionTransform(element, 'translateX(12px)', 'scale(1.3)');
    const second = writeTransitionTransform(element, 'translateX(12px)', 'scale(1.3)');
    assert.equal(first, 'translateX(12px) scale(1.3)');
    assert.equal(second, first);
    assert.equal((second.match(/scale\(1\.3\)/gu) ?? []).length, 1);
    assert.match(composite, /outgoingElement\.dataset\.akariTransitionBaseTransform \|\| ''/u);
    assert.doesNotMatch(composite, /outgoingBaseTransform = outgoingElement\.style\.transform/u);
});

test('動画→静止画・静止画→動画・静止画→静止画を独立した要素種別で解決する', () => {
    assert.match(composite, /const outgoingIsStill = isStillSegment\(window\.outgoing\)/);
    assert.match(composite, /const incomingStillUrl = stillUrlForSegment\(window\.incoming\)/);
    assert.match(composite, /const outgoingElement = outgoingIsStill \? stillImage : video/);
    assert.match(composite, /const incomingElement = incomingIsStill \? transitionStill : transitionVideo/);
    assert.match(composite, /if \(outgoingIsStill\) \{[\s\S]*stillImage\.style\.opacity/);
    assert.match(composite, /if \(!incomingIsStill\) \{[\s\S]*applyTransitionSegmentSource\(window\.incoming/);
    assert.match(composite, /incomingElement\.style\.opacity = String\(incomingOpacity \* visual\.incomingOpacity\)/);
    assert.match(composite, /incomingElement\.style\.clipPath = visual\.incomingClipPath/);
    assert.match(composite, /incomingElement\.dataset\.akariTransitionProgress = progressText/);
});

test('静止画 outgoing の opacity は鏡写し元 video と同値になり進行度を保持する', () => {
    const stillOutgoingStart = composite.indexOf('if (outgoingIsStill)');
    const stillOutgoingEnd = composite.indexOf('if (incomingIsStill', stillOutgoingStart);
    const stillOutgoingBranch = composite.slice(stillOutgoingStart, stillOutgoingEnd);
    assert.match(
        stillOutgoingBranch,
        /video\.style\.opacity = String\(outgoingOpacity \* visual\.outgoingOpacity\);\s*stillImage\.style\.opacity = video\.style\.opacity/
    );
    assert.match(bootstrap, /stillImage\.style\.opacity = video\.style\.opacity/);

    const resetStart = bootstrap.indexOf('const resetTransitionComposite = () =>');
    const resetEnd = bootstrap.indexOf('const renderTransitionComposite = timelineTime =>', resetStart);
    const reset = bootstrap.slice(resetStart, resetEnd);
    assert.match(
        reset,
        /if \(isStillSegment\(segment\)\) \{[\s\S]*video\.style\.opacity = restoredOpacity;\s*stillImage\.style\.opacity = restoredOpacity/
    );
});

test('静的 DOM は outgoing 群の後に incoming 群を置き同一 z の paint 順を保証する', () => {
    const layersStart = compiled.indexOf('<div id="preview-layers">');
    const layersEnd = compiled.indexOf('<div id="overlay-stage">', layersStart);
    const layersMarkup = compiled.slice(layersStart, layersEnd);
    const ids = ['preview-video', 'preview-still', 'transition-video', 'transition-still'];
    const positions = ids.map(id => layersMarkup.indexOf(`id="${id}"`));
    assert.ok(positions.every(position => position >= 0), '4 合成要素が preview-layers 直下に存在する');
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('audio active は outgoing video の volume を実際に書く場合だけ true になる', () => {
    assert.match(
        composite,
        /video\.dataset\.akariTransitionAudioActive = String\(!outgoingIsStill\)/
    );
    assert.doesNotMatch(composite, /String\(!outgoingIsStill \|\| !incomingIsStill\)/);
});

test('outgoing hidden は既存合成の打ち切り条件へ追加しない', () => {
    assert.doesNotMatch(composite, /outgoingHidden/);
    assert.match(
        composite,
        /if \(!window \|\| !window\.incoming \|\| incomingHidden\) \{\s*resetTransitionComposite\(\)/
    );
});

test('transition dataset は実参加する outgoing / incoming 要素だけへ書く', () => {
    assert.match(composite, /outgoingElement\.dataset\.akariTransitionType = window\.type/);
    assert.match(composite, /outgoingElement\.dataset\.akariTransitionProgress = progressText/);
    assert.match(composite, /incomingElement\.dataset\.akariTransitionType = window\.type/);
    assert.match(composite, /incomingElement\.dataset\.akariTransitionProgress = progressText/);
    assert.doesNotMatch(composite, /(?:video|transitionVideo)\.dataset\.akariTransitionType = window\.type/);
    assert.doesNotMatch(composite, /(?:video|transitionVideo)\.dataset\.akariTransitionProgress = progressText/);
});

test('静止画 incoming の先読みは img を decode して video 経路へ入らない', () => {
    const stillBranchStart = preload.indexOf('if (upcomingStillUrl)');
    const stillBranchEnd = preload.indexOf('transitionVideo.dataset.akariPreloadedWindow', stillBranchStart);
    const stillBranch = preload.slice(stillBranchStart, stillBranchEnd);
    assert.match(stillBranch, /transitionStill\.setAttribute\('src', upcomingStillUrl\)/);
    assert.match(stillBranch, /transitionStill\.style\.display = 'none'/);
    assert.match(stillBranch, /transitionStill\.decode\(\)/);
    assert.match(stillBranch, /return/);
    assert.doesNotMatch(stillBranch, /applyTransitionSegmentSource|transitionVideo\.(?:src|load|currentTime)/);
    // 動画 incoming の従来レールはそのまま残す。
    assert.match(preload, /applyTransitionSegmentSource\(upcoming\.incoming, primeIncomingFrame\)/);
});

test('片付けは静止画レイヤーの表示・opacity・clip-path・dataset を消す', () => {
    const resetStart = bootstrap.indexOf('const resetTransitionComposite = () =>');
    const resetEnd = bootstrap.indexOf('const renderTransitionComposite = timelineTime =>', resetStart);
    const reset = bootstrap.slice(resetStart, resetEnd);
    assert.match(reset, /transitionStill\.style\.display = 'none'/);
    assert.match(reset, /transitionStill\.style\.opacity = '0'/);
    assert.match(reset, /transitionStill\.style\.clipPath = 'none'/);
    assert.match(reset, /transitionStill\.dataset\.akariTransitionType = ''/);
    assert.match(reset, /transitionStill\.dataset\.akariTransitionProgress = ''/);
    assert.match(composite, /if \(!window \|\| !window\.incoming \|\| incomingHidden\) \{\s*resetTransitionComposite\(\)/);
});

test('音量クロスは動画側の明示分岐にだけ存在する', () => {
    const incomingVideoStart = composite.indexOf('if (!incomingIsStill)');
    const outgoingVideoStart = composite.indexOf('if (!outgoingIsStill)', incomingVideoStart);
    const incomingVideoBranch = composite.slice(incomingVideoStart, outgoingVideoStart);
    const outgoingVideoBranch = composite.slice(outgoingVideoStart);
    assert.match(incomingVideoBranch, /transitionVideo\.volume = transitionAudioBaseVolume \* progress/);
    assert.match(outgoingVideoBranch, /video\.volume = transitionAudioBaseVolume \* \(1 - progress\)/);
    assert.doesNotMatch(composite, /(?:stillImage|transitionStill)\.volume/);
});
