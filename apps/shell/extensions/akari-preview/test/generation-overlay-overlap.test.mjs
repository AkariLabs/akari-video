import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { generationOverlaysAtTime } = require('../lib/common/generation-overlay-model.js');

test('同時刻の未生成枠をすべて元の順序で選び、空の説明を除く', () => {
    const clips = [
        { id: 'first', start: 0, end: 3 },
        { id: 'empty', start: 0, end: 3 },
        { id: 'second', start: 1, end: 4 },
        { id: 'later', start: 4, end: 5 }
    ];
    const result = generationOverlaysAtTime(clips, 2, clip => clip.id === 'empty'
        ? { tag: null, band: null, shimmer: false, aurora: null, maskRect: null, pip: null, blurBackground: null }
        : { tag: '✦ AI の枠', band: null, shimmer: false, aurora: 'planned', maskRect: null });
    assert.deepEqual(result.map(entry => entry.clip.id), ['first', 'second']);
});

test('2 件目以降の重ねは固有 id を持たず、消えた枠の要素を除く', () => {
    const script = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
    const start = script.indexOf('function updateExtras() {');
    const end = script.indexOf('const setGenerationImage =', start);
    assert.ok(start >= 0 && end > start);
    const run = new Function('active', 'generationExtras', 'document', 'generationOverlay',
        'layersStage', 'finite', 'stageWidth', 'stageHeight', `${script.slice(start, end)}\nupdateExtras();`);
    const appended = [];
    const generationExtras = new Map();
    const document = { createElement: () => {
        const icon = {}, tag = {};
        return { dataset: {}, style: { setProperty() {} }, setAttribute() {},
            querySelector: selector => selector.includes('icon') ? icon : tag,
            remove() { this.removed = true; } };
    } };
    const generationOverlay = { parentNode: { appendChild: node => appended.push(node) } };
    const layersStage = { offsetWidth: 640, getBoundingClientRect: () => ({ width: 640 }), querySelectorAll: () => [] };
    const active = ['first', 'second', 'third'].map(id => ({ clip: { id, kind: 'visual' },
        description: { aurora: 'planned', tag: '✦ AI の枠' } }));
    const args = [active, generationExtras, document, generationOverlay, layersStage,
        (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback, 640, 360];
    run(...args);
    assert.deepEqual([...generationExtras.keys()], ['second', 'third']);
    assert.equal(appended.length, 2);
    assert.ok(appended.every(node => node.id === undefined && node.dataset.akariGenAurora === 'planned'));
    active.pop();
    run(...args);
    assert.equal(generationExtras.size, 1);
    assert.equal(appended[1].removed, true);
    const style = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    assert.match(style, /html\.akari-gen-capturing \.akari-gen-extra/u);
    assert.match(script, /if \(generationExportLook\)\s*\{\s*hideGenerationOverlay\(\)/u);
});
