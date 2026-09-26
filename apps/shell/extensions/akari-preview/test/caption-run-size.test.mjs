import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { captionEditorFitWidth, captionEditorLines, captionEditorWrapWidth,
    captionLineCountFromMetrics } from '../lib/common/caption-edit-geometry.js';

const require = createRequire(import.meta.url);
const { applyCaptionRunsToHtml } = require('@akari-video/edit-store');
const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('scaled runs reserve their own em width and retain parent-em shift in pixels', () => {
    const html = '<div><p class="akari-caption__line">今日はいい天気</p></div>';
    const runs = [{ from: 3, to: 5, style: { scale: 1.5, baseline_shift_em: -0.15, rotate_deg: 8 } }];
    const result = applyCaptionRunsToHtml(html, '今日はいい天気', runs);
    const injected = vm.runInNewContext(`(${applyCaptionRunsToHtml.toString()})`, { Intl });
    assert.equal(injected(html, '今日はいい天気', runs), result);
    assert.equal((result.match(/font-size:1.5em/g) ?? []).length, 2);
    assert.equal((result.match(/letter-spacing:var\(--caption-letter-spacing,normal\)/g) ?? []).length, 2);
    assert.equal((result.match(/translateY\(-0.09999999999999999em\) rotate\(8deg\)/g) ?? []).length, 2);
    assert.doesNotMatch(result, /scale\(1\.5\)/);
    const explicit = applyCaptionRunsToHtml(html, '今日はいい天気', [{
        from: 3, to: 4, style: { scale: 1.5, letter_spacing_em: 0.08, stroke: { width_px: 2 } }
    }]);
    assert.match(explicit, /letter-spacing:0.08em/);
    assert.match(explicit, /-webkit-text-stroke:2px currentColor/);
});

test('only scaled runs get an ink-sized plate; ordinary captions retain their original CSS', () => {
    assert.match(source, /\.caption-row-plate\[data-output-caption\] \.akari-caption__plate \{ width: var\(--caption-width, 92%\); right: auto; \}/);
    assert.match(source, /\.caption-row-plate\[data-caption-sized-run\]\[data-output-caption\] \.akari-caption__plate \{ width: var\(--caption-width, max-content\)/);
    assert.equal((source.match(/width:var\(--caption-width,auto\);display:flex/g) ?? []).length, 2);
    assert.equal((source.match(/max-width:var\(--caption-line-max-width,92%\)/g) ?? []).length, 4);
    const start = source.indexOf('const captionHasScaledRun =');
    const end = source.indexOf('const renderStyledCaptionFragment =', start);
    const context = {};
    vm.runInNewContext(`${source.slice(start, end)} globalThis.sized = captionHasScaledRun; globalThis.css = captionSizedRunPlateCss;`, context);
    assert.equal(context.sized({ text: '普通' }), false);
    assert.equal(context.sized({ runs: [{ style: { scale: 1 } }] }), false);
    assert.equal(context.css({ text: '普通' }), '');
    assert.equal(context.sized({ runs: [{ style: { scale: 1.5 } }] }), true);
    assert.match(context.css({ runs: [{ style: { scale: 1.5 } }] }), /width:var\(--caption-width,max-content\);margin-inline:var\(--caption-plate-margin,auto\)/);
    assert.match(source, /const resolvedRunPlateCss = captionHasScaledRun\(caption\)/);
    const wrap = readFileSync(new URL('../src/browser/preview-selection-handles-style.ts', import.meta.url), 'utf8');
    assert.match(wrap, /\[style\*="--caption-wrap-width"\] \.akari-caption__plate \{ width: var\(--caption-wrap-width\); \}/);
    assert.match(wrap, /white-space: pre-wrap; overflow-wrap: anywhere/);
});

test('selection bounds include a shifted or rotated run outside the line', () => {
    const start = source.indexOf('const captionVisualRect =');
    const end = source.indexOf('const captionLayoutRect =', start);
    const context = {
        captionOutputPoint: (x, y) => ({ x, y }),
        selectedCaptionPlate: () => null,
    };
    vm.runInNewContext(`${source.slice(start, end)} globalThis.measure = captionVisualRect;`, context);
    const line = { getBoundingClientRect: () => ({ left: 10, right: 100, top: 20, bottom: 50 }) };
    const run = { getBoundingClientRect: () => ({ left: 90, right: 125, top: 5, bottom: 45 }) };
    const plate = { querySelector: () => null, querySelectorAll: selector =>
        selector === '.akari-caption__line' ? [line] : [run] };
    assert.deepEqual({ ...context.measure(plate) }, { left: 10, right: 125, top: 5, bottom: 50 });
});

test('editing restores one line after scaled runs are inserted and leaves plain width alone', () => {
    const start = source.indexOf('const beginCaptionEdit =');
    const end = source.indexOf("captionLayer.addEventListener('dblclick'", start);
    for (const scaled of [false, true]) {
        const caption = { id: 'caption', text: 'Hello World',
            ...(scaled ? { runs: [{ from: 2, to: 5, style: { scale: 1.1 } }] } : {}) };
        let editor;
        let runInserted = false;
        const layoutPlate = { replaceChildren(value) { editor = value; },
            get firstElementChild() { return editor; } };
        const displayLine = { offsetWidth: 255, offsetHeight: 20 };
        const plate = { querySelectorAll: () => [displayLine], querySelector: () => layoutPlate,
            classList: { add() {} } };
        const document = {
            createTextNode: text => ({ textContent: text }),
            createElement: tag => {
                if (tag === 'br') return { tagName: 'BR' };
                const attributes = new Map();
                return { style: {},
                    get offsetHeight() { return runInserted && parseFloat(this.style.width) < 256 ? 40 : 20; },
                    getAttribute: name => attributes.get(name) ?? null,
                    setAttribute: (name, value) => attributes.set(name, value),
                    replaceChildren(...nodes) { this.textContent = nodes.map(node => node.textContent).join(''); },
                    focus() {} };
            }
        };
        const context = {
            captionRows: new Map([[caption.id, { plate }]]), activeCaptionEdit: null,
            isPlaying: false, selectCaption() {}, togglePlayback() {},
            captionEditorLinesFn: captionEditorLines, captionEditorWrapWidthFn: captionEditorWrapWidth,
            captionEditorFitWidthFn: captionEditorFitWidth,
            captionLineCountFromMetricsFn: captionLineCountFromMetrics,
            getComputedStyle: () => ({ lineHeight: '20px', paddingTop: '0px', paddingBottom: '0px' }),
            document, placeCaptionCaretAtEnd() {},
            window: { akari: { reportCaptionEditFocus() {},
                refreshActiveCaptionRuns() { runInserted = scaled; }, syncRunSelection() {} } }
        };
        vm.runInNewContext(`${source.slice(start, end)} globalThis.begin = beginCaptionEdit;`, context);
        context.begin(caption);
        assert.equal(editor.style.width, scaled ? '256px' : '255px');
        assert.equal(editor.offsetHeight, 20);
    }
});
