import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const source = readFileSync(join(sourceRoot, 'browser', 'akari-preview-open-handler.ts'), 'utf8');
const htmlStart = source.indexOf('return `<!doctype html>');
const html = source.slice(htmlStart, source.indexOf('</html>', htmlStart));
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const rules = [...css.replace(/\$\{[^}]*\}/g, '').matchAll(/^([^\n{}]+)\{([^{}]*)\}/gm)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }));

function rule(selector) {
    const found = rules.find(entry => entry.selector === selector);
    assert.ok(found, `CSS rule exists: ${selector}`);
    return found.body;
}

function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Source section exists: ${start}`);
    return source.slice(from, to);
}

test('舞台とシークは左右余白ゼロ、上 8px と操作行 34px で transport は 58px', () => {
    assert.match(rule('.preview-pane'), /padding:\s*0;/);
    assert.match(rule('.transport'), /padding:\s*0;/);
    assert.match(rule('.transport-seek'), /width:\s*100%;/);
    assert.match(rule('.transport-seek'), /margin-top:\s*8px;/);
    assert.match(rule('.transport-seek #seek'), /margin:\s*0;/);
    const controls = rule('.transport-controls');
    assert.match(controls, /height:\s*34px;/);
    assert.match(controls, /padding:\s*0 10px 2px;/);
    assert.match(controls, /box-sizing:\s*border-box;/);
    assert.match(rule('#play-toggle'), /height:\s*32px;/);
    assert.doesNotMatch(source, /margin-top:\s*-6px/);
    const range = rules.find(entry => entry.selector.startsWith(':is(#seek') && entry.selector.endsWith(')'));
    assert.ok(range);
    assert.match(range.body, /height:\s*16px;/);
});

test('操作行内側に揃うポップアップは右側コントロールを absolute の基準にする', () => {
    assert.match(rule('.transport-right'), /position:\s*relative;/);
    assert.match(rule('.transport-right'), /justify-self:\s*end;/);
    assert.match(rule('.transport-left'), /position:\s*relative;/);
    assert.match(rule('.zoom-popup'), /position:\s*absolute;\s*right:\s*0;/);
    const right = html.slice(html.indexOf('<div class="transport-right">'));
    assert.match(right, /id="rate-popup" class="zoom-popup"/);
    assert.match(right, /id="zoom-popup" class="zoom-popup"/);
});

test('シークの track と played は dark/light の単色でつまみ枠も同色', () => {
    const dark = rule(':root');
    const light = rule('body.vscode-light');
    assert.match(dark, /--akari-seek-track:\s*rgba\(255,255,255,0\.22\);/);
    assert.match(dark, /--akari-seek-played:\s*rgba\(255,255,255,0\.85\);/);
    assert.match(light, /--akari-seek-track:\s*rgba\(0,0,0,0\.18\);/);
    assert.match(light, /--akari-seek-played:\s*rgba\(0,0,0,0\.7\);/);
    assert.equal([...css.matchAll(/--akari-seek-played:/g)].length, 2);
    for (const theme of [dark, light]) assert.match(theme, /--akari-seek-thumb:\s*#fff;/);
    const seekRules = rules.filter(entry => entry.selector.includes('#seek'));
    assert.ok(seekRules.length > 0);
    for (const entry of seekRules) assert.doesNotMatch(entry.body, /--akari-accent/, entry.selector);
    const range = ':is(#seek, #zoom-slider, .akari-perspective-angle-row input[type=range])';
    assert.match(rule(range + '::-webkit-slider-runnable-track'),
        /linear-gradient\(to right, var\(--akari-seek-played\) var\(--seek-progress\), var\(--akari-seek-track\) 0\)/);
    assert.match(rule(range + '::-webkit-slider-thumb'), /border:\s*2px solid var\(--akari-seek-played\);/);
    assert.match(rule(range + ':active::-webkit-slider-thumb'), /transform:\s*scale\(1\.15\);/);
});

test('seek だけ focus 枠を廃止し他の range とボタンのキーボード focus を維持する', () => {
    assert.match(rule('#seek:focus-visible'), /outline:\s*none;/);
    assert.match(rule('#seek:focus-visible'), /box-shadow:\s*none;/);
    const outlined = rules.filter(entry => entry.selector.includes(':focus-visible')
        && /outline:\s*2px solid/.test(entry.body));
    assert.equal(outlined.length, 2);
    for (const entry of outlined) assert.ok(!entry.selector.includes('#seek'));
    assert.match(rule(':is(#zoom-slider, .akari-perspective-angle-row input[type=range]):focus-visible'),
        /outline:\s*2px solid var\(--akari-accent\);/);
    assert.match(rule(':is(.icon-button, .zoom-preset, .rate-preset):focus-visible'),
        /outline:\s*2px solid var\(--akari-accent\);/);
});

test('左端の単発ボタンは音声メーターを開き、再生エラーでも使用できる', () => {
    const button = html.match(/<button id="audio-meter-open"[^>]*>/)?.[0];
    assert.ok(button);
    assert.match(button, /class="icon-button"/);
    assert.match(button, /aria-label="音声メーター" title="音声メーター"/);
    assert.doesNotMatch(button, /aria-pressed|disabled/);
    assert.match(html, /<div class="transport-left">\s*<button id="audio-meter-open"[\s\S]*?<\/button>\s*<span id="time-label">/);
    assert.match(source, /const audioMeterOpen = document\.getElementById\('audio-meter-open'\);/);
    assert.match(source, /audioMeterOpen\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'akari-preview-open-audio-meter' \}\);\s*\}\);/);
    assert.match(source, /const vscode = acquireVsCodeApi\(\);\s*const audioMeterOpen = document\.getElementById\('audio-meter-open'\);\s*audioMeterOpen\.addEventListener/);
    assert.doesNotMatch(source, /audioMeterOpen\.(?:disabled|setAttribute)/);
});

test('明示 open は閉じたメーターを右側に再接続して activate し dismissal を解除する', () => {
    assert.match(source, /if \(message\?\.type === 'akari-preview-open-audio-meter'\) \{\s*void this\.openAudioMeter\(\);\s*\}/);
    const open = section('protected async openAudioMeter()', 'private observeAudioMeter(');
    assert.match(open, /getOrCreateWidget<AkariAudioMeterWidget>\(\s*AkariAudioMeterWidget\.FACTORY_ID\s*\)/);
    assert.match(open, /this\.observeAudioMeter\(meter\);/);
    assert.match(open, /if \(!meter\.isAttached\) await this\.shell\.addWidget\(meter, \{ area: 'right', rank: 220 \}\);/);
    assert.match(open, /await this\.shell\.activateWidget\(meter\.id\);\s*this\.audioMeterDismissedThisSession = false;/);
    assert.equal([...open.matchAll(/audioMeterDismissedThisSession/g)].length, 1);
    const passive = section('protected async attachAudioMeterPassively()', 'protected async openAudioMeter()');
    assert.match(passive, /if \(this\.audioMeterDismissedThisSession\) return;/);
    assert.match(passive, /this\.observeAudioMeter\(meter\);/);
    assert.doesNotMatch(passive, /activateWidget/);
    const observe = section('private observeAudioMeter(', 'async openOutput(');
    assert.match(observe, /if \(!this\.observedAudioMeters\.has\(meter\)\)/);
    assert.match(observe, /this\.observedAudioMeters\.add\(meter\);/);
    assert.match(observe, /meter\.onDidDispose\(\(\) => \{ this\.audioMeterDismissedThisSession = true; \}\);/);
});

test('廃止した帯の DOM・状態・描画・fetch と専用 RPC は src 全体から除去する', () => {
    const removed = [
        ['transport', 'waveform'].join('-'),
        ...['canvas', 'toggle', 'fetch'].map(suffix => ['waveform', suffix].join('-')),
        ['build', 'WaveformPeaks'].join(''),
        ['Waveform', 'FetchRequest'].join(''),
        ['waveform', 'State'].join(''),
        ['waveform', 'Canvas'].join(''),
        ['waveform', 'ResizeTimer'].join(''),
        ['waveform', 'DragPointer'].join(''),
        ['draw', 'Waveform'].join(''),
        ['load', 'Waveform'].join(''),
        ['aggregate', 'Waveform'].join(''),
        ['update', 'WaveformPlayhead'].join(''),
        ['read', 'WaveformBytes'].join(''),
        ['WAVEFORM', 'INLINE_DECODE_LIMIT_BYTES'].join('_'),
        ['波形を', '生成中'].join(''),
        ['この動画の波形は', '生成できません'].join('')
    ];
    function check(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) check(path);
            else if (entry.isFile()) {
                const text = readFileSync(path, 'utf8');
                for (const token of removed) assert.equal(text.includes(token), false, `${entry.name}: ${token}`);
            }
        }
    }
    check(sourceRoot);
});
