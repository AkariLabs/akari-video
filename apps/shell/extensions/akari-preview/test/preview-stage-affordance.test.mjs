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
    assert.match(source, /#preview-wrapper\s*\{[^\n]*background:\s*#000;/);
    assert.doesNotMatch(source, /--akari-preview-canvas-edge|#preview-wrapper\s*\{[^\n]*box-shadow:/);
});

test('キャンバス箱はペインの可用幅と高さの小さい側へ output 比で contain される', () => {
    assert.match(source, /\.preview-pane\s*\{[^}]*container-type:\s*size/);
    assert.match(
        source,
        /#preview-wrapper\s*\{[^\n]*width:\s*min\(100cqw,\s*calc\(100cqh\s*\*\s*\$\{width\}\s*\/\s*\$\{height\}\)\);[^\n]*aspect-ratio:\s*\$\{width\}\s*\/\s*\$\{height\}/
    );
    assert.match(
        source,
        /const computeOutputFrameRect = \(\) => \{[\s\S]*return \{ x: 0, y: 0, width: wrapperRect\.width, height: wrapperRect\.height \};/
    );
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
