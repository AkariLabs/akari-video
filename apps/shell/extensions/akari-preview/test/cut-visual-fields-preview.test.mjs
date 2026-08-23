import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { resolveLayerHitRegionClip } from '../lib/common/layer-hit-region.js';
import { computeLayerPerspectiveVisual } from '../lib/common/layer-perspective-visual.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');
const compiled = readFileSync(join(here, '..', 'lib', 'browser', 'akari-preview-open-handler.js'), 'utf8');

function extractTemplate(methodName) {
    const methodAt = compiled.lastIndexOf(`${methodName}()`);
    assert.notEqual(methodAt, -1, `${methodName}() が compiled lib に見つからない`);
    const tick = compiled.indexOf('`', methodAt);
    assert.notEqual(tick, -1, `${methodName}() のテンプレートリテラルが見つからない`);
    let index = tick + 1;
    let output = '';
    while (index < compiled.length) {
        const character = compiled[index];
        if (character === '\\') {
            const next = compiled[index + 1];
            if (next === 'n') output += '\n';
            else if (next === 't') output += '\t';
            else if (next === 'r') output += '\r';
            else output += next;
            index += 2;
            continue;
        }
        if (character === '`') break;
        if (character === '$' && compiled[index + 1] === '{') {
            let braces = 1;
            index += 2;
            while (index < compiled.length && braces > 0) {
                const nested = compiled[index];
                if (nested === '\\') { index += 2; continue; }
                if (nested === '{') braces += 1;
                else if (nested === '}') braces -= 1;
                index += 1;
            }
            output += '0';
            continue;
        }
        output += character;
        index += 1;
    }
    return output;
}

function extractArrowFunction(template, name) {
    const marker = `const ${name} = `;
    const declaration = template.indexOf(marker);
    assert.notEqual(declaration, -1, `${name} が webview テンプレートに見つからない`);
    const expressionStart = declaration + marker.length;
    const bodyStart = template.indexOf('{', template.indexOf('=>', expressionStart));
    assert.notEqual(bodyStart, -1, `${name} の関数本体が見つからない`);
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = bodyStart; index < template.length; index += 1) {
        const character = template[index];
        const next = template[index + 1];
        if (lineComment) {
            if (character === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (character === '*' && next === '/') { blockComment = false; index += 1; }
            continue;
        }
        if (quote) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === quote) quote = null;
            continue;
        }
        if (character === '/' && next === '/') { lineComment = true; index += 1; continue; }
        if (character === '/' && next === '*') { blockComment = true; index += 1; continue; }
        if (character === '\'' || character === '"' || character === '`') { quote = character; continue; }
        if (character === '{') depth += 1;
        if (character === '}') {
            depth -= 1;
            if (depth === 0) return template.slice(expressionStart, index + 1);
        }
    }
    throw new Error(`${name} の関数終端が見つからない`);
}

const hostAdapterTemplate = extractTemplate('hostAdapterScript');
const applyLayerStyleMediaLayoutSource = extractArrowFunction(
    hostAdapterTemplate,
    'applyLayerStyleMediaLayout'
);
const applyLayerStyleMediaLayout = new Function(
    'mediaNaturalSize',
    'computeLayerPerspectiveVisualFn',
    'resolveLayerHitRegionClipFn',
    'perspectiveVisualWarned',
    `return (${applyLayerStyleMediaLayoutSource});`
)(
    media => ({ width: media.videoWidth, height: media.videoHeight }),
    computeLayerPerspectiveVisual,
    resolveLayerHitRegionClip,
    false
);

test('cut segments and transition windows retain layer-style visual fields', () => {
    assert.match(source, /crop: cut \? cut\.crop : undefined/);
    assert.match(source, /perspective: cut \? cut\.perspective : undefined/);
    assert.match(source, /keyframes: cut \? cut\.keyframes : undefined/);
    assert.match(source, /outgoing: decorateSegment\(window\.outgoing\)/);
    assert.match(source, /incoming: decorateSegment\(window\.incoming\)/);
});

test('cut rendering reuses the layer pure functions and shared layer-style layout', () => {
    assert.match(source, /import \{ computeLayerPerspectiveVisual \} from '\.\.\/common\/layer-perspective-visual'/);
    assert.match(source, /import \{ cropAnchorCorrectedTransform \} from '\.\.\/common\/layer-crop-anchor'/);
    assert.match(source, /import \{ computeLayerKeyframesVisual \} from '\.\.\/common\/layer-keyframes-visual'/);
    assert.match(source, /applyLayerStyleMediaLayout\(layerVideo, outputWidth, outputHeight\)/);
    assert.match(source, /return applyLayerStyleMediaLayout\(media, outputWidth, outputHeight\)/);
    assert.match(source, /computeLayerPerspectiveVisualFn\(\{ corners \}, boxWidthPx, boxHeightPx\)/);
    assert.match(source, /computeLayerKeyframesVisualFn\(segment\.keyframes, localTime\)/);
});

test('cut keyframes are evaluated from output-local time on both playback ticks and seeks', () => {
    assert.match(source, /const localTime = Math\.max\(0, timelineTime - segment\.outStart\)/);
    assert.match(source, /renderCutLayerStyleVisual\(outputTime\);\s*applyCutFramingVisual\(\)/);
    assert.match(source, /applyCutKeyframesToMedia\(media, segment, Math\.max\(0, outputTime - segment\.outStart\)\)/);
    assert.match(source, /applyCutKeyframesToMedia\(transitionVideo, window\.incoming, incomingLocalTime\)/);
});

test('plain cut framing and transition window rails remain as explicit fallbacks', () => {
    assert.match(source, /if \(segment && cutHasLayerStyleVisual\(segment\)\)/);
    assert.match(source, /const incomingFraming = computeCutFramingVisualFn\(/);
    assert.match(source, /const visual = computeTransitionVisualFn\(window\.type, progress\)/);
    assert.match(source, /transitionVideo\.style\.clipPath = visual\.incomingClipPath/);
});

test('shared layer-style layout pins the Electron DOM crop/perspective values and preserves the no-crop layer baseline', () => {
    const media = {
        tagName: 'VIDEO',
        videoWidth: 640,
        videoHeight: 360,
        dataset: {
            akariCropX: '0.25',
            akariCropY: '0.15',
            akariCropW: '0.5',
            akariCropH: '0.6',
            akariTransformScale: '0.675',
            akariTransformX: '-90',
            akariTransformY: '-45',
            akariTransformRotate: '0',
            akariPerspectiveCorners: JSON.stringify([[0.08, 0], [0.92, 0], [0, 1], [1, 1]])
        },
        style: {}
    };
    assert.equal(applyLayerStyleMediaLayout(media, 640, 360), true);
    const closeTo = (actual, expected) => assert.ok(
        Math.abs(actual - expected) <= 1e-6,
        `expected ${expected}, got ${actual}`
    );
    closeTo(parseFloat(media.style.width), 432);
    closeTo(parseFloat(media.style.height), 243);
    closeTo(parseFloat(media.style.left), 230);
    closeTo(parseFloat(media.style.top), 135);
    const transformOrigin = [...media.style.transformOrigin.matchAll(/-?[\d.]+/g)]
        .map(match => Number(match[0]));
    assert.equal(transformOrigin.length, 2);
    closeTo(transformOrigin[0], 50);
    closeTo(transformOrigin[1], 45);
    assert.equal(media.style.objectFit, 'fill');
    assert.equal(media.style.clipPath, 'inset(15% 25% 25% 25%)');
    assert.ok(media.style.transform.startsWith('translate(-'), media.style.transform);
    assert.ok(media.style.transform.includes('matrix3d('), media.style.transform);

    const uncropped = {
        tagName: 'VIDEO',
        videoWidth: 640,
        videoHeight: 360,
        dataset: {},
        style: {}
    };
    assert.equal(applyLayerStyleMediaLayout(uncropped, 640, 360), true);
    const uncroppedOrigin = [...uncropped.style.transformOrigin.matchAll(/-?[\d.]+/g)]
        .map(match => Number(match[0]));
    assert.equal(uncroppedOrigin.length, 2);
    closeTo(uncroppedOrigin[0], 50);
    closeTo(uncroppedOrigin[1], 50);
    assert.equal(uncropped.style.clipPath, '');
});
