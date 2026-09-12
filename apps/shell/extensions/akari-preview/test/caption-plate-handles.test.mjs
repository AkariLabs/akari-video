import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  captionHandleRotateDelta,
  captionHandleRotateValue,
  captionHandleScaleFactor,
  captionHandleScaleValue,
  captionHandleTargets,
  persistCaptionPlateTransform,
  updateCaptionTransformSource,
} from '../lib/common/caption-plate-handles.js';
import { harness } from './caption-animator-webview-harness.mjs';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const handlerSource = readFileSync(join(extensionRoot, 'src/browser/akari-preview-open-handler.ts'), 'utf8');
const pureSource = readFileSync(join(extensionRoot, 'src/common/caption-plate-handles.ts'), 'utf8');
const visualContract = JSON.parse(readFileSync(
  resolve(extensionRoot, '../../../../packages/edit-store/src/caption-visual-contract.json'),
  'utf8'
));

test('scale factor/value handle zero division, rounding, and clamps', () => {
  const center = { x: 0, y: 0 };
  assert.equal(captionHandleScaleFactor(center, { x: 3, y: 4 }, { x: 6, y: 8 }), 2);
  assert.equal(captionHandleScaleFactor(center, center, { x: 6, y: 8 }), 1);
  assert.equal(captionHandleScaleFactor(center, { x: Infinity, y: 0 }, { x: 6, y: 8 }), 1);
  assert.equal(captionHandleScaleValue(1, center, { x: 10, y: 0 }, { x: 13.456, y: 0 }), 1.346);
  assert.equal(captionHandleScaleValue(1, center, { x: 10, y: 0 }, { x: 1, y: 0 }), 0.4);
  assert.equal(captionHandleScaleValue(2, center, { x: 1, y: 0 }, { x: 2, y: 0 }), 3);
  assert.equal(captionHandleScaleValue(Number.NaN, center, { x: 1, y: 0 }, { x: 2, y: 0 }), 2);
});

test('rotate delta/value normalize and round deterministically', () => {
  const center = { x: 0, y: 0 };
  assert.equal(captionHandleRotateDelta(center, { x: 1, y: 0 }, { x: 0, y: 1 }), 90);
  assert.equal(captionHandleRotateValue(170, center, { x: 1, y: 0 }, { x: 0, y: 1 }), -100);
  assert.equal(captionHandleRotateValue(-170, center, { x: 1, y: 0 }, { x: 0, y: -1 }), 100);
  const angle = 12.3456 * Math.PI / 180;
  assert.equal(captionHandleRotateValue(Number.NaN, center, { x: 1, y: 0 }, {
    x: Math.cos(angle), y: Math.sin(angle)
  }), 12.35);
});

test('caption targets preserve allIds order and remove duplicates', () => {
  const all = ['c3', 'c1', 'c2', 'c1'];
  assert.deepEqual(captionHandleTargets([], 'c2', all, false), ['c2']);
  assert.deepEqual(captionHandleTargets(['c2', 'c1'], 'c1', all, false), ['c1', 'c2']);
  assert.deepEqual(captionHandleTargets(['c2'], 'c1', all, false), ['c1']);
  assert.deepEqual(captionHandleTargets([], 'c1', all, true), ['c3', 'c1', 'c2']);
  assert.deepEqual(captionHandleTargets([], '', all, false), []);
});

test('transform writer updates multiple object-root cues and preserves other style fields', () => {
  const source = JSON.stringify({ captions: [
    { id: 'c1', text_style: { color: '#fff', rotate: 4 } },
    { id: 'c2', text_style: { size_px: 32 } },
  ] });
  const saved = JSON.parse(updateCaptionTransformSource(source, ['c2', 'c1'], { scale: 1.35, rotate: -12 }));
  assert.deepEqual(saved.captions[0].text_style, { color: '#fff', rotate: -12, scale: 1.35 });
  assert.deepEqual(saved.captions[1].text_style, { size_px: 32, scale: 1.35, rotate: -12 });
});

test('transform writer supports array roots and removes default/empty style keys', () => {
  const source = JSON.stringify([
    { id: 'c1', text_style: { scale: 2, rotate: 8 } },
    { id: 'c2', text_style: { color: '#eee', scale: 2, rotate: 8 } },
  ]);
  const saved = JSON.parse(updateCaptionTransformSource(source, ['c1', 'c2'], { scale: 1, rotate: 0 }));
  assert.equal(saved[0].text_style, undefined);
  assert.deepEqual(saved[1].text_style, { color: '#eee' });
  assert.throws(
    () => updateCaptionTransformSource(source, ['missing'], { scale: 2 }),
    /字幕が見つかりません: missing/u
  );
});

test('persist builds one candidate containing transform and cue position, then lints/writes once', async () => {
  const calls = { lint: 0, write: 0 };
  let written = '';
  const result = await persistCaptionPlateTransform({
    source: JSON.stringify([{ id: 'c1', text_style: { zone: 'top', color: '#fff' } }, { id: 'c2' }]),
    captionIds: ['c1', 'c2'],
    patch: { scale: 1.35 },
    cuePosition: { captionId: 'c1', value: { anchor: 'bc', position: { x: 0.2, y: 0.9 } } },
    lint: async candidate => { calls.lint += 1; written = candidate; return { pass: true, errors: [] }; },
    write: async candidate => { calls.write += 1; assert.equal(candidate, written); },
  });
  assert.equal(result.pass, true);
  assert.deepEqual(calls, { lint: 1, write: 1 });
  const saved = JSON.parse(written);
  assert.deepEqual(saved[0].text_style, {
    color: '#fff', scale: 1.35, text_anchor: 'bc', position: { x: 0.2, y: 0.9 }
  });
  assert.equal(saved[1].text_style.scale, 1.35);
});

test('persist does not write a lint-rejected candidate', async () => {
  let writes = 0;
  const result = await persistCaptionPlateTransform({
    source: JSON.stringify([{ id: 'c1' }]),
    captionIds: ['c1'],
    patch: { rotate: -12 },
    lint: async () => ({ pass: false, errors: ['no'] }),
    write: async () => { writes += 1; },
  });
  assert.deepEqual(result, { pass: false, errors: ['no'] });
  assert.equal(writes, 0);
});

test('webview wiring contains five selected-only handles and local CSS variable updates', () => {
  assert.match(handlerSource, /querySelectorAll\('\.akari-caption-handle-box, \.akari-caption-handle'\)[\s\S]*\.forEach\(handle => handle\.remove\(\)\)/u);
  assert.match(handlerSource, /if \(!captionPlate\.hasAttribute\('data-selected'\)\) return/u);
  assert.match(handlerSource, /const handleBox = document\.createElement\('div'\)/u);
  assert.match(handlerSource, /handleBox\.className = 'akari-caption-handle-box'/u);
  assert.match(handlerSource, /handleBox\.appendChild\(handle\)/u);
  assert.match(handlerSource, /captionPlate\.appendChild\(handleBox\)/u);
  for (const kind of ['nw', 'ne', 'sw', 'se', 'rot']) {
    assert.match(handlerSource, new RegExp(`data-h="${kind}"`));
  }
  assert.match(handlerSource, /setProperty\('--caption-scale', String\(patch\.scale\)\)/u);
  assert.match(handlerSource, /setProperty\('--caption-rotate', patch\.rotate \+ 'deg'\)/u);
  assert.match(handlerSource, /plateTransform: \{ captionIds: targets, \.\.\.patch \}/u);
});

test('selected captions create one handle box with five handles and deselection removes all of them', () => {
  const view = harness({
    cues: [{ id: 'c1', start: 0, end: 2, text: '字幕' }],
    selectedIds: ['c1'],
  });
  view.tick(1);
  assert.equal(view.plate.querySelectorAll('.akari-caption-handle-box, .akari-caption-handle').length, 6);
  assert.equal(view.plate.querySelectorAll('.akari-caption-handle').length, 5);
  view.run('selectedCaptionIds = new Set(); applyCaptionSelectionAttrs();');
  assert.equal(view.plate.querySelectorAll('.akari-caption-handle-box, .akari-caption-handle').length, 0);
  assert.equal(view.plate.querySelectorAll('.akari-caption-handle').length, 0);
});

test('handle box follows the text bounds for styled captions and fills a plain plate', () => {
  assert.match(handlerSource, /const syncCaptionHandleBox = \(\) => \{/u);
  assert.match(handlerSource, /querySelector\('\.akari-caption-handle-box'\)/u);
  assert.match(handlerSource, /if \(!captionPlate\.classList\.contains\('akari-caption-host--styled'\)\) \{[\s\S]*box\.style\.inset = '0'[\s\S]*return;/u);
  assert.match(handlerSource, /const hostRect = captionPlate\.getBoundingClientRect\(\)/u);
  assert.match(handlerSource, /captionPlate\.offsetWidth > 0 \? hostRect\.width \/ captionPlate\.offsetWidth : 1/u);
  assert.match(handlerSource, /captionPlate\.offsetHeight > 0 \? hostRect\.height \/ captionPlate\.offsetHeight : 1/u);
  assert.match(handlerSource, /box\.style\.left = \(\(ink\.left - hostRect\.left\) \/ scaleX\) \+ 'px'/u);
  assert.match(handlerSource, /box\.style\.top = \(\(ink\.top - hostRect\.top\) \/ scaleY\) \+ 'px'/u);
  assert.match(handlerSource, /box\.style\.width = Math\.max\(0, \(ink\.right - ink\.left\) \/ scaleX\) \+ 'px'/u);
  assert.match(handlerSource, /box\.style\.height = Math\.max\(0, \(ink\.bottom - ink\.top\) \/ scaleY\) \+ 'px'/u);
  assert.match(handlerSource, /updateCaptionSelectBoxForRect = rect => \{\s*syncCaptionHandleBox\(\)/u);
  assert.match(handlerSource, /updateCaptionSelectBox = \(\) => \{\s*syncCaptionHandleBox\(\)/u);
});

test('body drag keeps Alt group position and batches one cue for ordinary movement', () => {
  assert.match(handlerSource, /if \(groupMode\) \{[\s\S]*captionWrite\(cueId, \{ groupPosition \}\)/u);
  assert.match(handlerSource, /else \{[\s\S]*plateTransform: \{[\s\S]*captionIds: \[cueId\][\s\S]*scale,[\s\S]*rotate,[\s\S]*cuePosition: \{ captionId: cueId, value: cuePosition \}/u);
});

test('webview inline math is mechanically locked to the pure functions', () => {
  for (const token of [
    'Math.hypot(now.x - center.x, now.y - center.y) / startDistance',
    'Math.round(value * 1000) / 1000',
    'Math.atan2(now.y - center.y, now.x - center.x)',
    '((value + 180) % 360 + 360) % 360 - 180',
    'Math.round(normalized * 100) / 100',
  ]) {
    assert.ok(pureSource.includes(token), `pure function is missing ${token}`);
    assert.ok(handlerSource.includes(token), `webview copy is missing ${token}`);
  }
});

test('all three caption plate CSS rules consume scale/rotate around the center', () => {
  const transform = 'transform:rotate(var(--caption-rotate,0deg)) scale(var(--caption-scale,1));transform-origin:center;';
  assert.equal(handlerSource.split(transform).length - 1, 2);
  assert.ok(visualContract.resolved_single_line_caption_css.includes(transform));
  assert.ok(visualContract.resolved_caption_style_variable_names.includes('--caption-scale'));
  assert.ok(visualContract.resolved_caption_style_variable_names.includes('--caption-rotate'));
});

test('resolved display_lines render one paragraph per line', () => {
  assert.match(handlerSource, /Array\.isArray\(caption\.displayLines\)[\s\S]*caption\.displayLines\.length >= 2/u);
  assert.match(handlerSource, /caption\.displayLines\.map\(line => renderText\(line\)\)\.join\([\s\S]*akari-caption__line/u);
});
