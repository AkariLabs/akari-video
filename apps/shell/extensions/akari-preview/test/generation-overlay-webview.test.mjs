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
    assert.match(previewBootstrapMethod, /resolveGenerationStateFn\(clip\.meta, Date\.now\(\), clip\.binding\)/u);
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
