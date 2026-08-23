import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');

test('プレビュー舞台は light/dark 両テーマで黒いキャンバスと外側を区別し輪郭線を描かない', () => {
    assert.match(source, /--akari-preview-pasteboard:\s*#2b2d30/);
    assert.match(source, /body\.vscode-light\s*\{[\s\S]*--akari-preview-pasteboard:\s*#d5d7da/);
    assert.match(source, /\.preview-pane\s*\{[^}]*background:\s*var\(--akari-preview-pasteboard\)/);
    assert.match(source, /\.preview-pane\s*\{[^}]*position:\s*relative;[^}]*overflow:\s*hidden/);
    assert.match(source, /#preview-stage\s*\{[^\n]*background:\s*#000;/);
    assert.doesNotMatch(source, /#preview-wrapper\s*\{[^\n]*(?:background:\s*#000|overflow:\s*hidden)/);
    assert.doesNotMatch(source, /--akari-preview-canvas-edge|#preview-stage\s*\{[^\n]*box-shadow:/);
});

test('キャンバス箱はペインの可用幅と高さの小さい側へ output 比で contain される', () => {
    assert.match(source, /#preview-wrapper\s*\{[^}]*container-type:\s*size/);
    assert.match(
        source,
        /#preview-stage\s*\{[^\n]*width:\s*min\(100cqw,\s*calc\(100cqh\s*\*\s*\$\{width\}\s*\/\s*\$\{height\}\)\);[^\n]*aspect-ratio:\s*\$\{width\}\s*\/\s*\$\{height\}/
    );
    assert.match(
        source,
        /const computeOutputFrameRect = \(\) => \{[\s\S]*const stageRect = previewStage\.getBoundingClientRect\(\);[\s\S]*width: stageRect\.width \/ \(zoomScaleX \|\| 1\)/
    );
});

test('ズーム層・黒いステージ・固定ミニマップは別階層で、パン上限はペイン実縁から求める', () => {
    assert.match(source, /<div id="zoom-layer">\s*<div id="preview-stage">/);
    assert.match(source, /<\/div>\s*<\/div>\s*<button id="output-preview-link"/);
    assert.match(source, /<\/div>\s*<div id="zoom-minimap" hidden aria-hidden="true">[\s\S]*<\/section>/);
    assert.match(source, /previewStage\.offsetWidth \* zoom - previewPane\.clientWidth/);
    assert.match(source, /previewStage\.offsetHeight \* zoom - previewPane\.clientHeight/);
    assert.match(source, /zoomLayer\.style\.transform = 'translate\('[\s\S]*'px\) scale\(' \+ zoom \+ '\)'/);
});

test('ズーム中も直接操作面はパン捕捉を素通しし、論理座標 fallback は zoom を含む', () => {
    const directTarget = source.slice(
        source.indexOf('const isDirectManipulationTarget = target =>'),
        source.indexOf("previewPane.addEventListener('pointermove'")
    );
    assert.match(directTarget, /\[data-overlay-id\]/);
    assert.match(directTarget, /\[data-akari-layer-id\]/);
    assert.match(directTarget, /#layer-select-box[\s\S]*#cut-select-box[\s\S]*#caption-select-box/);
    assert.match(directTarget, /if \(!event\.altKey && isDirectManipulationTarget\(event\.target\)\) return/);
    assert.doesNotMatch(source, /event\.button !== 0 \|\| zoom > 1\.05 \|\| cropModeActive/);
    assert.match(source, /const displayScale = \(window\.akari\.stageScale\(\) \|\| 1\) \* zoom/);
});

test('V1 四隅 resize は共通スナップとガイドを使い Shift で無効化する', () => {
    const cutResize = source.slice(
        source.indexOf('for (const handle of cutHandleElements)'),
        source.indexOf('new ResizeObserver(() => updateCutSelectBox())')
    );
    assert.match(cutResize, /window\.akari\.interaction\.computeAnchorResizeSnap\(\{/);
    assert.match(cutResize, /anchorStageX:\s*anchor\.x[\s\S]*anchorStageY:\s*anchor\.y/);
    assert.match(cutResize, /draggedStageX:\s*dragged\.x[\s\S]*draggedStageY:\s*dragged\.y/);
    assert.match(cutResize, /startScale:\s*original\.scale[\s\S]*scale:\s*nextScale/);
    assert.match(cutResize, /corner\.includes\('w'\)[\s\S]*corner\.includes\('n'\)/);
    assert.match(cutResize, /moveEvent\.shiftKey\s*\|\|\s*!window\.akari\.interaction/);
    assert.match(cutResize, /window\.akari\.interaction\?\.hideSnapGuides\?\.\(\)/);
    const removedSolverName = ['solveCentered', 'ResizeSnap'].join('');
    assert.equal(source.includes(removedSolverName), false);
});
