import { installPreviewTestI18n } from './helpers/preview-i18n.mjs';
const restorePreviewTestI18n = installPreviewTestI18n();
import { setLanguage, localizedKnobGroup, localizedKnobLabel } from '@akari-video/i18n';
import { after } from 'node:test';
setLanguage('ja');
after(() => setLanguage(undefined));
after(restorePreviewTestI18n);
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
const Handler = vm.runInContext(`${compiled}\nHandler`, vm.createContext({ getLanguage: () => 'ja' }));

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


test('fragment preview knob labels follow the UI language', () => {
    const begin = source.indexOf('export function localizeFragmentPreviewKnobs(');
    const end = source.indexOf('@injectable()', begin);
    assert.ok(begin >= 0 && end > begin);
    const code = ts.transpileModule(`${source.slice(begin, end).replace('export function', 'function')}\nthis.localizeFragmentPreviewKnobs = localizeFragmentPreviewKnobs;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const localize = vm.runInContext(`${code}\nlocalizeFragmentPreviewKnobs`, vm.createContext({ localizedKnobLabel }));
    const knobs = [{ cssVar: '--tone', type: 'color', label: '色調', default: '#fff' },
        { cssVar: '--speed', type: 'slider', label: '速さ', default: 1 }];
    const meta = { i18n: { en: { knobs: { '--tone': 'Tone', '--speed': 'Speed' } } } };
    assert.deepEqual(Array.from(localize(meta, knobs, 'en'), knob => knob.label), ['Tone', 'Speed']);
    assert.deepEqual(Array.from(localize(meta, knobs, 'ja'), knob => knob.label), ['色調', '速さ']);
});

test('fragment preview group headings use translations and keep the source group id', () => {
    const begin = source.indexOf('export function localizeFragmentPreviewKnobs(');
    const end = source.indexOf('@injectable()', begin);
    const code = ts.transpileModule(`${source.slice(begin, end).replace('export function', 'function')}\nthis.localizeFragmentPreviewKnobs = localizeFragmentPreviewKnobs;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const localize = vm.runInContext(`${code}\nlocalizeFragmentPreviewKnobs`, vm.createContext({ localizedKnobLabel, localizedKnobGroup }));
    const meta = { i18n: { en: { groups: { style: 'Style' } } } };
    const [english] = localize(meta, [{ cssVar: '--color', type: 'color', group: 'style', label: '色', default: '#fff' }], 'en');
    const [japanese] = localize(meta, [{ cssVar: '--color', type: 'color', group: 'style', label: '色', default: '#fff' }], 'ja');
    assert.equal(english.group, 'style');
    assert.equal(english.groupLabel, 'Style');
    assert.equal(japanese.groupLabel, 'スタイル');
    assert.match(source, /heading\.textContent=knob\.groupLabel\|\|knob\.group/u);
    assert.match(source, /#knob-fields h4\{grid-column:1\/-1;/u);
});
