import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../../akari-preview/src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('preview.ts', source, ts.ScriptTarget.Latest, true);
const functions = ['captionMotionTextTargets', 'shouldResumeCaptionMotion'];
const definitions = functions.map(name => {
    const node = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    assert.ok(node, name);
    return node.getText(ast);
});
const compiled = ts.transpileModule(definitions.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS }
}).outputText;
const { captionMotionTextTargets, shouldResumeCaptionMotion } = new Function(
    `const exports = {}; ${compiled}; return exports;`
)();

test('動きの一回再生は外側 host ではなく文字を持つ内側の行を選ぶ', () => {
    const top = { textContent: '' };
    const bottom = { textContent: '今日は朝のルーティン' };
    const host = { querySelectorAll(selector) {
        assert.equal(selector, '.akari-caption__line');
        return [top, bottom];
    } };
    assert.deepEqual(captionMotionTextTargets(host), [bottom]);
    assert.deepEqual(captionMotionTextTargets({ querySelectorAll: () => [] }), []);
});

test('字幕更新後の再生は同じ cue が画面にあり、要求が期限内のときだけ再開する', () => {
    const request = { captionId: 'c-0001', expiresAt: 6000 };
    assert.equal(shouldResumeCaptionMotion(request, ['c-0001'], 5000), true);
    assert.equal(shouldResumeCaptionMotion(request, ['c-0002'], 5000), false);
    assert.equal(shouldResumeCaptionMotion(request, ['c-0001'], 6000), false);
    assert.equal(shouldResumeCaptionMotion(null, ['c-0001'], 5000), false);
});

test('字幕の再描画直後に保留再生を再開し、host の子要素を直接消さない', () => {
    const start = source.indexOf('const startCaptionMotionReplay = replay =>');
    const end = source.indexOf("window.addEventListener('akari-frame-engine-seek'", start);
    const playback = source.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(playback, /motionTextTargets\(row\.plate\)/u);
    assert.match(source, /const motionTextTargets = host => \[\.\.\.host\.querySelectorAll\('\.akari-caption__line'\)\]/u);
    assert.match(playback, /entry\.target\.replaceChildren\(\.\.\.entry\.nodes\)/u);
    assert.doesNotMatch(playback, /row\.plate\.(?:textContent|replaceChildren|innerHTML)\s*=/u);
    const update = source.slice(source.indexOf("message.type === 'akari-preview-captions-update'"),
        source.indexOf("message.type === 'akari-preview-audio-update'"));
    assert.match(update, /renderCaption\(\);\s*resumeCaptionMotionAfterRender\(\);/u);
    assert.match(source, /captionMotionReplay\.captionId === \(caption\?\.sourceCueId \|\| caption\?\.id\)[\s\S]*?window\.queueMicrotask\(resumeCaptionMotionAfterRender\)/u);
    assert.match(source, /if \(animation\.effect\?\.target\?\.closest\?\.\('\[data-akari-motion-replay\]'\)\) continue;/u);
});
