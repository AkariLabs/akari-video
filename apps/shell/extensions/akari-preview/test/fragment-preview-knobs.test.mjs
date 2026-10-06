import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/browser/akari-fragment-preview-open-handler.ts', import.meta.url), 'utf8');
const start = source.indexOf('    protected previewHtml(');
const end = source.lastIndexOf('\n}');
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(`class Handler { ${source.slice(start, end)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const Handler = vm.runInContext(`${compiled}\nHandler`, vm.createContext({}));

test('fragment preview exposes meta knobs and escapes their labels in the webview script', () => {
    const html = Handler.prototype.previewHtml.call({
        escapeHtml: value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    }, '<div>overlay</div>', {
        threeJavaScriptUrl: 'three.js', threeTextJavaScriptUrl: 'three-text.js',
        threeRuntimeJavaScriptUrl: 'three-runtime.js', runtimeJavaScriptUrl: 'runtime.js',
        motionVocabCss: '', captionFontUrl: 'font.ttf'
    }, 'frame/fragment.html', [{
        cssVar: '--color', type: 'color', label: '</script><img src=x>', default: '#ff0000'
    }]);
    assert.match(html, /id="knobs" hidden/u);
    assert.match(html, /stage\.style\.setProperty\(knob\.cssVar,input\.value\+suffix\)/u);
    assert.match(html, /\\u003c\/script>/u);
    assert.doesNotMatch(html, /const knobs=\[\{[^\n]*<\/script>/u);
});
