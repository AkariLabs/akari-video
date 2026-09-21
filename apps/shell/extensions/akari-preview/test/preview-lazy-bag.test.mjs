import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { expandBagOverlays, projectBagChildren, scanHtmlParts } from '../../../../../packages/overlay-runtime/src/parts.mjs';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const host = source.slice(source.indexOf('let collapsedBagSummary:'), source.indexOf('// 診断', source.indexOf('let collapsedBagSummary:')));
const bridge = source.slice(source.indexOf('let bagExpansionRequest ='), source.indexOf('window.akari.reportOverlaySelection ='))
  + source.slice(source.indexOf('// BEGIN preview bag response'), source.indexOf('// END preview bag response'));
test('host accepts only known lazy bags or collapse and returns a widget-local derived summary', () => {
  assert.match(host, /message\?\.type === 'akari-preview-expand-bag' && kind === 'output'/u);
  assert.match(host, /message\.bagId === null \|\| typeof message\.bagId === 'string'/u);
  assert.match(host, /Number\.isSafeInteger\(message\.requestId\)/u);
  assert.match(host, /current !== projectedBagSummary\) collapsedBagSummary = current/u);
  assert.match(host, /node\.kind === 'bag'[\s\S]*node\.lazy === true/u);
  assert.match(host, /bagId !== null && !bagNode\) return/u);
  assert.match(host, /if \(overlay\.id !== bagId\) return \[overlay\]/u);
  assert.match(host, /projectedBagSummary = \{ \.\.\.base, overlays \}/u);
  assert.match(host, /widget\.sendMessage\(\{ type: 'akari-preview-expand-bag', bagId,[\s\S]*summary: projectedBagSummary/u);
  assert.doesNotMatch(host, /writeFile|writeText|queueRefresh|loadPreviewModel/u);
});
test('webview sends a generation with each scope request and serializes current reply mounts', () => {
  assert.match(bridge, /window\.akari\.requestBagExpansion = bagId =>/u);
  assert.match(bridge, /type: 'akari-preview-expand-bag', bagId, requestId: \+\+bagExpansionRequest/u);
  assert.match(bridge, /!window\.akari\.isCurrentBagExpansion\(message\.requestId\)\) return/u);
  assert.ok(source.indexOf('// BEGIN preview bag response') > source.indexOf('protected previewBootstrapScript()'),
    'response must share lexical scope with summary, plates and applyIncrementalModel');
  assert.match(bridge, /bagMountTail = bagMountTail\.then\(async \(\) =>/u);
  assert.match(bridge, /window\.akari\.state\.summary = summary;\s*await window\.akari\.runtime\.mount\(summary\);[\s\S]*stage\.append\(transitionPlate, transitionFallbackLabel, captionPlate\);\s*applyIncrementalModel\(summary\)/u);
});
test('shared projector masks an untouched summary record without recomposing its world geometry', () => {
  const html = '<div data-akari-part="A">Alpha</div><div data-akari-part="B">Beta</div>';
  const declaration = { id: 'bag', html, start: 1.25, duration: 2.5,
    transform: { x: 71, y: -23, scale: 1.6, rotate: 30 }, opacity: 0.4,
    track: 4, trackId: 'track', params: { label: 'value' } };
  const bag = { id: declaration.id, at: declaration.start, duration: declaration.duration,
    source: { kind: 'html', html }, declaration };
  assert.equal(expandBagOverlays({ tracks: [{ items: [bag] }] }).length, 1);
  const children = projectBagChildren(bag, scanHtmlParts(html));
  const expanded = expandBagOverlays({ tracks: [{ items: [{ ...bag, children }] }] });
  assert.deepEqual(expanded.map(part => part.id), ['bag#A', 'bag#B']);
  for (const part of expanded) {
    assert.match(part.html, /data-akari-part-mask=/u);
    assert.deepEqual(part.transform, declaration.transform);
    assert.equal(part.start, declaration.start);
    assert.equal(part.duration, declaration.duration);
    assert.equal(part.opacity, declaration.opacity);
  }
  assert.equal(bag.children, undefined);
  assert.equal(declaration.html, html);
});
test('explicit children and excludes remain eagerly projected by the shared renderer', () => {
  const html = '<b data-akari-part="A">A</b><b data-akari-part="B">B</b><b data-akari-part="C">C</b>';
  const bag = { id: 's01', at: 0, duration: 4, source: { kind: 'html', html, exclude: ['C'] },
    children: [{ id: 's01.B', at: 0.2, duration: 3.8, source: { kind: 'html', html, part: 'B', text: 'Override' },
      declaration: { transform: { y: -40 } } }] };
  assert.deepEqual(expandBagOverlays({ tracks: [{ items: [bag] }] }).map(o => o.id), ['s01#A', 's01.B']);
  const excludedOnly = { ...bag, children: [] };
  assert.deepEqual(expandBagOverlays({ tracks: [{ items: [excludedOnly] }] }).map(o => o.id), ['s01#A', 's01#B']);
});
