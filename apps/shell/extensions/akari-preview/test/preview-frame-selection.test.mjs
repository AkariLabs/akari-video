import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const captureCss = source.slice(source.indexOf('/* Capture-only presentation.'), source.indexOf('.icon-button { display: inline-grid;'));
const rules = [...captureCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, declarations]) => ({ selectors, declarations }));
const ruleFor = selector => {
    const rule = rules.find(value => value.selectors.includes('html.akari-gen-capturing ' + selector));
    assert(rule, `missing capture override for ${selector}`);
    return rule.declarations;
};

test('capture removes plain/styled caption selection, Alt-all, and editing outlines while retaining text', () => {
    for (const selector of [
        '#caption-plate:is([data-selected], [data-alt-all])',
        '#caption-plate:is([data-selected], [data-alt-all]) .akari-caption__plate',
        '[data-akari-interaction-selected]', '[data-akari-interaction-editing="true"]', '[data-akari-caption-editing="true"]'
    ]) {
        const declarations = ruleFor(selector);
        assert.match(declarations, /outline:\s*none\s*!important/);
        assert.match(declarations, /caret-color:\s*transparent\s*!important/);
        assert.doesNotMatch(declarations, /visibility|display|opacity|text-shadow|box-shadow/);
    }
    assert.match(ruleFor('#caption-plate *::selection'), /background:\s*transparent\s*!important/);
});

test('capture hides selection/resize/crop handles and boxes, interaction guides, pen and generation decorations', () => {
    for (const selector of [
        '#caption-plate .akari-caption-handle-box', '#caption-plate .akari-caption-handle',
        '#layer-select-box', '#layer-crop-box', '#cut-select-box', '#caption-select-box',
        '[data-akari-handle]', '[data-akari-crop-handle]', '[data-akari-crop-edge]',
        '[data-akari-interaction]', '[id^="akari-gen-"]',
        '#preview-stage > :not(#preview-layers):not(#frame-engine-preview)'
    ]) assert.match(ruleFor(selector), /visibility:\s*hidden\s*!important/);
    // Caption handles include their rotation stem pseudo-element; the entire handle is hidden.
    assert.match(source, /\.akari-caption-handle\[data-h="rot"\]::before/);
    assert.match(source, /<canvas id="pen-layer"/);
});

test('host restores the webview before starting phase-two PNG conversion', () => {
    const start = source.indexOf('protected async capturePreviewFrame(');
    const handler = source.slice(start, source.indexOf('protected previewDiagnosticsGuardScript', start));
    const snapshot = handler.indexOf('const snapshot = await Promise.race(');
    const restore = handler.indexOf("send('akari-preview-capture-restore');", snapshot);
    const encode = handler.indexOf('const captured = await window.electronAkariPreview.finishPreviewFrame(captureId)');
    assert(snapshot >= 0 && restore > snapshot && encode > restore);
    assert(handler.slice(snapshot, encode).includes("message?.type !== 'akari-preview-capture-restored'"));
});
