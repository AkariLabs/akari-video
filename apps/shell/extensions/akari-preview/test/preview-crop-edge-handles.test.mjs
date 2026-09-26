import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');
const css = readFileSync(join(here, '..', 'src', 'browser', 'preview-selection-handles-style.ts'), 'utf8');

const section = (from, to) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + from.length);
    assert.ok(start >= 0, `見つからない: ${from}`);
    assert.ok(end > start, `見つからない: ${to}`);
    return source.slice(start, end);
};

test('cut / layer の両方の選択枠に四辺中央の辺バーが 4 本ある', () => {
    const layerBox = section('<div id="layer-select-box">', '<div id="layer-crop-box">');
    const cutBox = section('<div id="cut-select-box">', '<div id="caption-zone-highlight">');
    for (const [box, kind] of [[layerBox, 'layer'], [cutBox, 'cut']]) {
        for (const dir of ['n', 'e', 's', 'w']) {
            assert.ok(
                kind === 'layer'
                    ? box.includes(`class="akari-crop-edge akari-crop-edge-${dir} akari-layer-handle akari-layer-handle-${dir}" data-akari-crop-edge="${dir}"`)
                    : box.includes(`class="akari-crop-edge akari-crop-edge-${dir}" data-akari-crop-edge="${dir}"`),
                `辺バー ${dir} が無い`
            );
        }
        assert.equal((box.match(/data-akari-crop-edge=/gu) || []).length, 4);
    }
    // 角点の pointerdown ループ（[data-akari-handle]）へ紛れ込ませないため属性は別立て。
    assert.doesNotMatch(source, /data-akari-handle="[news]"/u);
});

test('cut と layer は下の回転・移動ボタンを持ち、上のステムを持たない', () => {
    const cutBox = section('<div id="cut-select-box">', '<div id="caption-zone-highlight">');
    const layerBox = section('<div id="layer-select-box">', '<div id="layer-crop-box">');
    assert.doesNotMatch(cutBox, /rotate-stem/u);
    assert.doesNotMatch(layerBox, /rotate-stem/u);
    assert.ok(cutBox.includes('class="akari-cut-handle akari-cut-handle-rotate" data-akari-handle="rotate"'));
    assert.ok(cutBox.includes('data-akari-handle="move"'));
    assert.ok(layerBox.includes('data-akari-handle="move"'));
    assert.match(css, /#cut-select-box \.akari-cut-handle-move \{ left: calc\(50% \+ 14px\); cursor: move; \}/u);
    // ㉖ パースは frame-engine の base 経路が cut の perspective を未適用なので cut には出さない。
    assert.doesNotMatch(cutBox, /perspective/u);
    assert.doesNotMatch(source, /#cut-select-box[^\n]*perspective/u);
});

test('辺バーは 14×5 の白いつまみと 6px 広い当たりを持つ', () => {
    assert.match(css, /\.akari-crop-edge::after, #cut-select-box \.akari-crop-edge::after \{[^}]*width: 14px; height: 5px;/u);
    assert.match(css, /\.akari-crop-edge-n, #layer-select-box \.akari-crop-edge-s, #cut-select-box \.akari-crop-edge-n, #cut-select-box \.akari-crop-edge-s \{ width: 20px; height: 11px;/u);
    assert.match(css, /\.akari-crop-edge-e, #layer-select-box \.akari-crop-edge-w, #cut-select-box \.akari-crop-edge-e, #cut-select-box \.akari-crop-edge-w \{ width: 11px; height: 20px;/u);
    assert.match(
        source,
        /#preview-chrome-layer\[data-frame-engine-active="true"\] #layer-select-box\.is-active \.akari-crop-edge,/u
    );
    // ⛶ クロップモード中は select box 側の操作系（辺バー含む）を隠す。
    assert.match(source, /#layer-select-box\.akari-crop-mode-hide-handles \.akari-crop-edge,/u);
    // 当たり幅は維持し、24px 以上の小さい選択にも辺バーを出す。
    assert.match(source, /const CROP_EDGE_MIN_BOX_PX = 24;/u);
    assert.match(source, /\.akari-crop-edges-hide-x \.akari-crop-edge-n, \.akari-crop-edges-hide-x \.akari-crop-edge-s \{ display: none; \}/u);
    assert.match(source, /\.akari-crop-edges-hide-y \.akari-crop-edge-e, \.akari-crop-edges-hide-y \.akari-crop-edge-w \{ display: none; \}/u);
    assert.match(source, /\.akari-crop-edges-off \.akari-crop-edge \{ display: none; \}/u);
});

test('画像の辺は片軸伸縮、cut の辺は切り抜き、角と回転は共通ドラッグへ入る', () => {
    const edgeWiring = section('const cropEdgeHandleElements = [', '// 通常ドラッグは cue 固有位置');
    assert.match(edgeWiring, /layerSelectBox\.querySelectorAll\('\[data-akari-crop-edge\]'\)/u);
    assert.match(edgeWiring, /cutSelectBox\.querySelectorAll\('\[data-akari-crop-edge\]'\)/u);
    assert.match(edgeWiring, /target = cutDragTarget\(\);/u);
    assert.match(edgeWiring, /geometry\.anchoredScales\(\{ anchor, dragged,/u);
    assert.match(edgeWiring, /beginMediaTransformDrag\(layerDragTarget\(entry\), event,/u);
    assert.match(edgeWiring, /beginMediaCropDrag\(target, edge\.element\.getAttribute\('data-akari-crop-edge'\), event\)/u);
    assert.equal((source.match(/const beginMediaCropDrag = /gu) || []).length, 1);

    // ⛶ の 8 方向ハンドルも同じ 1 本へ入り、写真 cut と layer の両方を扱う。
    assert.match(
        source,
        /for \(const handle of layerCropHandleElements\)[\s\S]*?const target = entry \? layerDragTarget\(entry\) : cutSelected \? cutDragTarget\(\) : null;[\s\S]*?beginMediaCropDrag\(\s*target,/u
    );

    // 角点 / 回転 / 移動の確定書き戻しも cut と layer で 1 本。
    assert.equal((source.match(/const beginMediaTransformDrag = /gu) || []).length, 1);
    assert.doesNotMatch(source, /beginCutTransformDrag|beginLayerTransformDrag/u);
    assert.match(source, /beginMediaTransformDrag\(layerDragTarget\(entry\), event, \(moveEvent, original\) => \{/u);
    assert.match(source, /beginMediaTransformDrag\(cutDragTarget\(\), event, \(moveEvent, original\) => \{/u);
    const cutHandles = section('for (const handle of cutHandleElements)', 'new ResizeObserver(() => updateCutSelectBox())');
    assert.match(cutHandles, /if \(corner === 'rotate'\) \{[\s\S]*beginMediaTransformDrag\(cutDragTarget\(\), event,/u);
    // 裁定 7: cut の角ドラッグの基準 box は選択枠と同じ関数から取る。
    assert.match(cutHandles, /const startBox = cutSelectBoxGeometry\(\);/u);
    assert.match(source, /const cutSelectBoxGeometry = \(\) => \{[\s\S]*cutLayerStyleBoxPxFn\(natural, cutCropNow\(\), scaleX, scaleY\)/u);
});

test('素材実寸の箱に初めて入る cut の crop にだけ fit を焼き込む', () => {
    const cutTarget = section('const cutDragTarget = () => {', 'const updateCutSelectBox');
    assert.match(
        cutTarget,
        /cropEntryTransform: \(transform, natural\) => \(\s*cutSelectionVideo\(\)\.dataset\.akariCutCropDeclared !== 'true'\s*\?\s*cutLayerStyleEntryTransformFn\(/u
    );
    assert.match(cutTarget, /transform, natural\.width, natural\.height, outputWidth, outputHeight, outputGeometry/u);
    assert.match(cutTarget, /: \{ \.\.\.transform \}/u);
    // layers[] は最初からソース実寸基準なので恒等。
    assert.match(source, /const layerDragTarget = entry => \(\{[\s\S]*cropEntryTransform: transform => \(\{ \.\.\.transform \}\)/u);
    // 焼き込みはドラッグ開始時に 1 度だけ、crop と同一 patch で確定する。
    const cropDrag = section('const beginMediaCropDrag = (target, dir, event)', 'for (const handle of layerCropHandleElements)');
    assert.match(cropDrag, /const startTransform = target\.cropEntryTransform\(target\.transformNow\(\), natural\);/u);
    assert.match(cropDrag, /await target\.write\(\{ crop: finalCrop, transform: finalTransform \}\)/u);
    assert.match(cropDrag, /cropRectAfterEdgeDragFn\(\s*original,\s*dir,/u);
    assert.match(cropDrag, /cropAnchorCorrectedTransformFn\(\s*original, nextCrop, startTransform, natural\.width, natural\.height/u);
    // Esc / 失敗時はドラッグ開始時点へ戻す（fit 焼き込みごと）。
    assert.match(cropDrag, /const restorePoint = target\.cropRestorePoint\(\);/u);
    assert.match(cropDrag, /keyEvent\.key !== 'Escape'/u);
    assert.match(cropDrag, /target\.restoreCrop\(restorePoint\)/u);
});

test('framing 持ち / v2 の item id が無い cut では辺バーが出ない', () => {
    assert.match(
        source,
        /const isV2 = Number\(summary\.editVersion\) === 2;\s*const editable = Boolean\(media\.dataset\.akariCutId\) && isV2\s*&& \(outputGeometryIsSource \|\| media\.dataset\.akariCutFraming !== 'true'\);/u
    );
    assert.match(source, /applyCropEdgeVisibility\(cutSelectBox, screenW, screenH, cutCropEditable\(\)\)/u);
    assert.match(source, /applyCropEdgeVisibility\(layerSelectBox, box\.width, box\.height, true\)/u);
    // framing の有無は applyCutVisual が dataset へ落とす。
    assert.match(
        source,
        /video\.dataset\.akariCutFraming = segment\.framing && typeof segment\.framing === 'object'\s*&& !Array\.isArray\(segment\.framing\) \? 'true' : '';/u
    );
    // 幾何統一済み（output.geometry: 'source'）の文書では framing 除外をしない。
    assert.match(source, /const outputGeometryIsSource = outputGeometry === 'source';/u);
    assert.match(source, /geometry\?: string/u);
    assert.match(source, /\.\.\.\(rawVersion === 2 \? \{ editVersion: 2 \} : \{\}\)/u);
});

test('ドラッグ中だけゴースト枠を出すゲートは cropModeActive || edgeCropDragActive', () => {
    assert.match(source, /let edgeCropDragActive = false;/u);
    const cropBox = section('const updateLayerCropBox = () => {', 'const setCropMode = active =>');
    assert.match(cropBox, /\(!cropModeActive && !edgeCropDragActive\)/u);
    // 対象が cut のときも同じ箱を cut の記述子で出す（⛶ トグルは layer だけ）。
    assert.match(source, /const cropGhostTarget = \(\) => \{\s*if \(edgeCropDragActive && edgeCropDragTarget\) return edgeCropDragTarget;/u);
    assert.match(cropBox, /if \(target\.kind === 'layer'\) positionLayerCropToggle\(outer\);/u);
    // RAF throttle も同じゲート（layer / cut 両方）。
    assert.equal((source.match(/if \(cropModeActive \|\| edgeCropDragActive\) updateLayerCropBox\(\);/gu) || []).length, 2);
    // 写真の下書き確定後も、従来の排他モードのゲートを保つ。
    assert.match(source, /const setCropMode = active => \{[\s\S]*?cropModeActive = !!\(active && \(selectedLayerId \|\| cutSelected\)\);/u);
    assert.match(source, /if \(cropModeActive && !selectedLayerId && !cutCropEditable\(\)\) cropModeActive = false;/u);
});

test('ズームのパン捕捉と frame-engine の pointerdown ガードは両 box を素通しする', () => {
    const directTarget = section('const isDirectManipulationTarget = (target, pointerEvent) =>', "previewPane.addEventListener('pointerdown'");
    assert.match(directTarget, /#layer-select-box[\s\S]*#cut-select-box/u);
    const engineGuard = section('const handledVisualPointerDownEvents = new WeakSet()', 'const targetIsVisualMedia');
    assert.ok(engineGuard.includes('#layer-select-box'));
    assert.ok(engineGuard.includes('#cut-select-box'));
});

test('cutWrite は crop を additive に運び、検証は layerWrite と同じ純関数を通る', () => {
    assert.match(
        source,
        /interface CutWriteRequest \{[\s\S]*patch: \{\s*transform\?: OverlayTransform;\s*crop\?: LayerCropPatch;\s*\};/u
    );
    assert.match(
        source,
        /const validationError = this\.validateLayerTransformPatch\(request\.patch\.transform\)\s*\?\? this\.validateLayerCropPatch\(request\.patch\.crop\);/u
    );
});
