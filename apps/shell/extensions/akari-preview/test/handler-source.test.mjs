import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { HANDLER_SOURCE_FILES, HANDLER_COMPILED_FILES, readHandlerSource, readHandlerCompiled, methodBody, sliceBetween } from './helpers/handler-source.mjs';

const require = createRequire(import.meta.url);
const guards = ['isPlaybackTickRequest', 'isPlaybackRateRequest', 'isReviewTransportRequest', 'isReviewStrokeStartRequest', 'isReviewStrokeEndRequest', 'isReviewRectStartRequest', 'isReviewRectEndRequest', 'isReviewToolModeRequest', 'isOverlaySelectedRequest', 'isLayerSelectedRequest', 'isCutSelectedRequest', 'isCaptionSelectedRequest', 'isOverlayWriteBatchRequest', 'isOverlayWriteRequest', 'validateLayerTransformPatch', 'validateLayerCropPatch', 'validateLayerPerspectivePatch', 'isCutWriteRequest', 'isCaptionWriteRequest', 'isLayerWriteRequest', 'isHevcFallbackRequest', 'isOpenOutputRequest'];

test('handler source is byte-for-byte the original source', () => {
  const original = HANDLER_SOURCE_FILES.map(relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')).join('\n');
  assert.equal(readHandlerSource(), original);
});

test('methodBody extracts a real method and rejects a missing method', () => {
  const source = readHandlerSource();
  const body = methodBody('hostAdapterScript');
  assert.match(body, /^export function hostAdapterScript\(\): string/u);
  assert.ok(source.includes(body));
  assert.throws(() => methodBody('missingHandlerMethod'), /missingHandlerMethod/u);
});

test('all extracted scripts and compiled files are present and nonempty', () => {
  const names = ['previewDiagnosticsGuardScript', 'previewDiagnosticsTailScript', 'frameEngineWatchdogScript', 'frameEngineBootstrapScript', 'hostAdapterScript', 'previewBootstrapScript'];
  for (const name of names) {
    const body = methodBody(name);
    assert.match(body, new RegExp(`^export function ${name}\\(\\): string`, 'u'));
    assert.match(body, /\n\}$/u);
    assert.ok(body.length > `export function ${name}(): string {\n}`.length);
  }
  for (const relative of [...HANDLER_SOURCE_FILES, ...HANDLER_COMPILED_FILES]) {
    assert.ok(readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8').length > 0, relative);
  }
  assert.match(readHandlerCompiled(), /function hostAdapterScript\(\)/u);
});

test('sliceBetween matches the original range and rejects missing or reversed anchors', () => {
  const source = readHandlerSource();
  const start = 'const onAdjustBypass =';
  const end = 'window.addEventListener(TIMELINE_ADJUST_BYPASS_EVENT';
  assert.equal(sliceBetween(start, end), source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))));
  assert.throws(() => sliceBetween('missingStartAnchor', end), /missingStartAnchor/u);
  assert.throws(() => sliceBetween(start, 'missingEndAnchor'), /missingEndAnchor/u);
  assert.throws(() => sliceBetween(end, start), /const onAdjustBypass =/u);
});

test('source options work on synthetic text', () => {
  const source = '    private example() {\n      return 1;\n    }\nA first B second';
  assert.equal(methodBody('example', { source }), '    private example() {\n      return 1;\n    }');
  assert.equal(sliceBetween('A', 'B', { source }), 'A first ');
  assert.equal(sliceBetween('A', 'B', { source: 'A skip A first B', from: 2 }), 'A first ');
  assert.throws(() => methodBody('example', { source: `${source}\n${source}` }), /example/u);
});

test('moved guards remain complete source functions and compiled exports', () => {
  const compiled = require('../lib/browser/preview-host-message-guards.js');
  for (const name of guards) {
    const body = methodBody(name);
    assert.match(body, new RegExp(`^export function ${name}\\(`, 'u'));
    assert.match(body, /\n\}$/u);
    assert.ok(body.length > `export function ${name}() {\n}`.length);
    assert.equal(typeof compiled[name], 'function', name);
  }
  assert.equal(Object.keys(compiled).length, guards.length);
});

test('moved modules exist and compiled constants match source exports', () => {
  for (const relative of [...HANDLER_SOURCE_FILES, ...HANDLER_COMPILED_FILES]) {
    assert.ok(readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8').length > 0, relative);
  }
  const source = readFileSync(new URL('../src/browser/preview-host-constants.ts', import.meta.url), 'utf8');
  const declared = [...source.matchAll(/^export const ([A-Za-z_$][\w$]*)/gmu)].map(match => match[1]);
  const compiled = require('../lib/browser/preview-host-constants.js');
  assert.equal(declared.length, 81);
  assert.deepEqual(Object.keys(compiled).sort(), declared.sort());
});
