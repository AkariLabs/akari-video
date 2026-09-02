import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');

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
    for (const box of [layerBox, cutBox]) {
        for (const dir of ['n', 'e', 's', 'w']) {
            assert.ok(
                box.includes(`class="akari-crop-edge akari-crop-edge-${dir}" data-akari-crop-edge="${dir}"`),
                `辺バー ${dir} が無い`
            );
        }
        assert.equal((box.match(/data-akari-crop-edge=/gu) || []).length, 4);
    }
    // 角点の pointerdown ループ（[data-akari-handle]）へ紛れ込ませないため属性は別立て。
    assert.doesNotMatch(source, /data-akari-handle="[news]"/u);
});

test('cut の選択枠にも layer と同じ回転ハンドル + ステムが出る（パースのトグルは出さない）', () => {
    const cutBox = section('<div id="cut-select-box">', '<div id="caption-zone-highlight">');
    assert.ok(cutBox.includes('class="akari-cut-rotate-stem"'));
    assert.ok(cutBox.includes('class="akari-cut-handle akari-cut-handle-rotate" data-akari-handle="rotate"'));
    assert.match(source, /#cut-select-box \.akari-cut-handle-rotate \{[^}]*border-radius: 50%; cursor: grab;/u);
    assert.match(source, /#cut-select-box \.akari-cut-rotate-stem \{[^}]*background: #4da3ff;/u);
    // ㉖ パースは frame-engine の base 経路が cut の perspective を未適用なので cut には出さない。
    assert.doesNotMatch(cutBox, /perspective/u);
    assert.doesNotMatch(source, /#cut-select-box[^\n]*perspective/u);
});

test('辺バーは白地 + 青枠の 28×5 / 5×28 で、frame-engine 面でも操作面として残る', () => {
    assert.match(
        source,
        /#layer-select-box \.akari-crop-edge, #cut-select-box \.akari-crop-edge \{[^}]*border: 1\.5px solid #4da3ff;[^}]*border-radius: 3px;[^}]*background: #fff;[^}]*pointer-events: auto;/u
    );
    assert.match(source, /\.akari-crop-edge-n \{[^}]*width: 28px; height: 5px;[^}]*cursor: ns-resize;/u);
    assert.match(source, /\.akari-crop-edge-s \{[^}]*width: 28px; height: 5px;[^}]*cursor: ns-resize;/u);
    assert.match(source, /\.akari-crop-edge-e \{[^}]*width: 5px; height: 28px;[^}]*cursor: ew-resize;/u);
    assert.match(source, /\.akari-crop-edge-w \{[^}]*width: 5px; height: 28px;[^}]*cursor: ew-resize;/u);
    assert.match(
        source,
        /#preview-stage\[data-frame-engine-active="true"\] #layer-select-box\.is-active \.akari-crop-edge,/u
    );
    // ⛶ クロップモード中は select box 側の操作系（辺バー含む）を隠す。
    assert.match(source, /#layer-select-box\.akari-crop-mode-hide-handles \.akari-crop-edge,/u);
    // 枠の当該軸が 44px 未満なら角点と衝突するので隠す。
    assert.match(source, /const CROP_EDGE_MIN_BOX_PX = 44;/u);
    assert.match(source, /\.akari-crop-edges-hide-x \.akari-crop-edge-n, \.akari-crop-edges-hide-x \.akari-crop-edge-s \{ display: none; \}/u);
    assert.match(source, /\.akari-crop-edges-hide-y \.akari-crop-edge-e, \.akari-crop-edges-hide-y \.akari-crop-edge-w \{ display: none; \}/u);
    assert.match(source, /\.akari-crop-edges-off \.akari-crop-edge \{ display: none; \}/u);
});

test('辺バー / 角点 / 回転の pointerdown は cut と layer で同じ関数へ入る', () => {
    // 辺バーは 1 本のループで両 box を配線し、同じ beginMediaCropDrag を呼ぶ。
    const edgeWiring = section('const cropEdgeHandleElements = [', '// 通常ドラッグは cue 固有位置');
    assert.match(edgeWiring, /layerSelectBox\.querySelectorAll\('\[data-akari-crop-edge\]'\)/u);
    assert.match(edgeWiring, /cutSelectBox\.querySelectorAll\('\[data-akari-crop-edge\]'\)/u);
    assert.match(edgeWiring, /target = cutDragTarget\(\);/u);
    assert.match(edgeWiring, /target = layerDragTarget\(entry\);/u);
    assert.match(edgeWiring, /beginMediaCropDrag\(target, edge\.element\.getAttribute\('data-akari-crop-edge'\), event\)/u);
    assert.equal((source.match(/const beginMediaCropDrag = /gu) || []).length, 1);

    // ⛶ の 8 方向ハンドルも同じ 1 本へ入る（挙動は従来どおり）。
    assert.match(
        source,
        /for \(const handle of layerCropHandleElements\)[\s\S]*?beginMediaCropDrag\(\s*layerDragTarget\(entry\),/u
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
    assert.match(source, /const cutSelectBoxGeometry = \(\) => \{[\s\S]*cutLayerStyleBoxPxFn\(natural, cutCropNow\(\), transform\.scale\)/u);
});

test('layer-style へ入っていない cut に初めて crop を書くときだけ fit を焼き込む', () => {
    const cutTarget = section('const cutDragTarget = () => {', 'const updateCutSelectBox');
    assert.match(
        cutTarget,
        /cropEntryTransform: \(transform, natural\) => \(\s*video\.dataset\.akariCutLayerStyleActive !== 'true'\s*\?\s*cutLayerStyleEntryTransformFn\(/u
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
        /const cutCropEditable = \(\) => Boolean\(video\.dataset\.akariCutId\)\s*&& Number\(summary\.editVersion\) === 2\s*&& \(outputGeometryIsSource \|\| video\.dataset\.akariCutFraming !== 'true'\);/u
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
    // setCropMode（⛶ の排他モード）は無変更で残す。
    assert.match(source, /const setCropMode = active => \{\s*cropModeActive = !!\(active && selectedLayerId\);/u);
});

test('ズームのパン捕捉と frame-engine の pointerdown ガードは両 box を素通しする', () => {
    const directTarget = section('const isDirectManipulationTarget = target =>', "previewPane.addEventListener('pointerdown'");
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
