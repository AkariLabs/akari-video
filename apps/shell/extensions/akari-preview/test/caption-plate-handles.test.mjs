import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  captionHandleRotateDelta,
  captionHandleRotateValue,
  captionHandleScaleFactor,
  captionHandleScaleValue,
  captionHandleTargets,
  captionWrapWidthDrag,
  captionCornerTransform,
  persistCaptionPlateTransform,
  updateCaptionTransformSource,
} from '../lib/common/caption-plate-handles.js';
import { harness } from './caption-animator-webview-harness.mjs';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { captionAnchorPositionVars } = require(resolve(extensionRoot, '../../../../packages/edit-store/lib/index.js'));
const handlerSource = readFileSync(join(extensionRoot, 'src/browser/akari-preview-open-handler.ts'), 'utf8');
const pureSource = readFileSync(join(extensionRoot, 'src/common/caption-plate-handles.ts'), 'utf8');
const renderCaptionSource = readFileSync(resolve(extensionRoot, '../../../../packages/render-cut/src/captions.mjs'), 'utf8');
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

test('left and right text handles keep the opposite edge and change only wrapping width', () => {
  const start = { left: 200, right: 400 };
  const right = captionWrapWidthDrag('e', start, 50, 1000);
  assert.deepEqual(right, { widthPct: 25, centerX: 325 });
  assert.equal(right.centerX - right.widthPct * 10 / 2, start.left);
  const left = captionWrapWidthDrag('w', start, -50, 1000);
  assert.deepEqual(left, { widthPct: 25, centerX: 275 });
  assert.equal(left.centerX + left.widthPct * 10 / 2, start.right);
  const saved = JSON.parse(updateCaptionTransformSource(JSON.stringify([{ id: 'c1', text_style: { size_px: 50 } }]),
    ['c1'], { wrapWidthPct: right.widthPct }));
  assert.deepEqual(saved[0].text_style, { size_px: 50, wrap_width_pct: 25 });
});

test('text corner scaling fixes its opposite corner at 30 degrees', () => {
  const layout = { left: 100, right: 300, top: 100, bottom: 200 };
  const rad = Math.PI / 6;
  const anchor = { x: 200 - 100 * Math.cos(rad) + 50 * Math.sin(rad),
    y: 150 - 100 * Math.sin(rad) - 50 * Math.cos(rad) };
  const dragged = { x: 200 + 100 * Math.cos(rad) - 50 * Math.sin(rad),
    y: 150 + 100 * Math.sin(rad) + 50 * Math.cos(rad) };
  const now = { x: anchor.x + 1.5 * (dragged.x - anchor.x),
    y: anchor.y + 1.5 * (dragged.y - anchor.y) };
  const result = captionCornerTransform('se', layout, 1, 30, now);
  assert.equal(result.scale, 1.5);
  const nextCx = result.left + 100, nextCy = result.top + 50;
  assert.ok(Math.abs(nextCx - result.scale * (100 * Math.cos(rad) - 50 * Math.sin(rad)) - anchor.x) < 1e-8);
  assert.ok(Math.abs(nextCy - result.scale * (100 * Math.sin(rad) + 50 * Math.cos(rad)) - anchor.y) < 1e-8);
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

test('webview wiring puts selected handles above media and keeps local style updates', () => {
  assert.match(handlerSource, /querySelectorAll\('\.akari-caption-handle-box, \.akari-caption-handle'\)[\s\S]*\.forEach\(handle => handle\.remove\(\)\)/u);
  assert.match(handlerSource, /const caption = captions\.find\(candidate => selectedCaptionIds\.has\([\s\S]*if \(!caption\) return/u);
  assert.match(handlerSource, /const handleBox = document\.createElement\('div'\)/u);
  assert.match(handlerSource, /handleBox\.className = 'akari-caption-handle-box'/u);
  assert.match(handlerSource, /handleBox\.appendChild\(handle\)/u);
  assert.match(handlerSource, /captionSelectBox\.appendChild\(handleBox\)/u);
  for (const kind of ['nw', 'ne', 'sw', 'se', 'rot']) {
    assert.match(handlerSource, new RegExp(`data-h="${kind}"`));
  }
  assert.match(handlerSource, /setProperty\('--caption-scale', String\(patch\.scale\)\)/u);
  assert.match(handlerSource, /setProperty\('--caption-rotate', patch\.rotate \+ 'deg'\)/u);
  assert.match(handlerSource, /plateTransform: \{ captionIds: targets, \.\.\.patch \}/u);
});

test('selected captions create controls in chrome and deselection removes them', () => {
  const view = harness({
    cues: [{ id: 'c1', start: 0, end: 2, text: '字幕' }],
    selectedIds: ['c1'],
  });
  view.tick(1);
  view.run("selectedCaptionId = 'c1'; applyCaptionSelectionAttrs();");
  assert.equal(view.run('captionSelectBox.children.flatMap(box => box.children).length'), 6);
  assert.equal(view.plate.querySelectorAll('.akari-caption-handle-box, .akari-caption-handle').length, 0);
  view.run('selectedCaptionId = null; selectedCaptionIds = new Set(); applyCaptionSelectionAttrs();');
  assert.equal(view.run('captionSelectBox.children.length'), 0);
});

test('handle box shares the selected frame and compensates for stage zoom', () => {
  assert.match(handlerSource, /const syncCaptionHandleBox = \(\) => \{/u);
  assert.match(handlerSource, /captionSelectBox\.querySelector\('\.akari-caption-handle-box'\)/u);
  assert.match(handlerSource, /captionControlScaleFn\(previewStage\.offsetWidth, display\.width,/u);
  assert.match(handlerSource, /captionSelectBox\.style\.transform = 'rotate\('/u);
  assert.match(handlerSource, /updateCaptionSelectBoxForRect = rect => \{\s*syncCaptionHandleBox\(\)/u);
  assert.match(handlerSource, /updateCaptionSelectBox = \(\) => \{\s*syncCaptionHandleBox\(\)/u);
});

test('body drag keeps Alt group position and batches one cue for ordinary movement', () => {
  assert.match(handlerSource, /if \(groupMode\) \{[\s\S]*captionWrite\(cueId, \{ groupPosition \}\)/u);
  assert.match(handlerSource, /else \{\s*const cuePosition = captionPositionFromVisualRect\([\s\S]*?\);\s*await window\.akari\.engine\.captionWrite\(cueId, \{\s*cuePosition\s*\}\);/u);
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
  const individual = 'rotate:var(--caption-rotate,0deg);scale:var(--caption-scale,1);transform-origin:center;';
  assert.equal(handlerSource.split(individual).length - 1, 2);
  assert.ok(visualContract.resolved_single_line_caption_css.includes(
    'transform:rotate(var(--caption-rotate,0deg)) scale(var(--caption-scale,1));transform-origin:center;'));
  assert.match(handlerSource, /plate\.style\.rotate = 'none';[\s\S]*?plate\.style\.scale = 'none';/u);
  assert.match(handlerSource, /plate\.style\.rotate = previousRotate;[\s\S]*?plate\.style\.scale = previousScale;/u);
  assert.ok(visualContract.resolved_caption_style_variable_names.includes('--caption-scale'));
  assert.ok(visualContract.resolved_caption_style_variable_names.includes('--caption-rotate'));
});

test('explicit-x caption handles measure the ink box and preserve the opposite corner', () => {
  assert.equal(captionAnchorPositionVars('bc', { x: 0.2, y: 0.8 }, undefined)['--caption-width'], 'max-content');
  assert.equal((handlerSource.match(/width:var\(--caption-width,auto\);[^']*?transform-origin:center;/gu) ?? []).length, 2);
  assert.equal((renderCaptionSource.match(/width: var\(--caption-width, auto\);[\s\S]{0,350}?transform-origin: center;/gu) ?? []).length, 2);
  assert.match(visualContract.resolved_single_line_caption_css,
    /width:var\(--caption-width,auto\);[\s\S]*?transform-origin:center;/u);
  assert.match(handlerSource, /const captionLayoutRect = [\s\S]*?plate\.style\.transform = 'none';[\s\S]*?const ink = captionVisualRect\(captionPlate\);[\s\S]*?return \{ \.\.\.ink, pivot:[\s\S]*?plate\.style\.transform = previousTransform;/u);
  assert.match(handlerSource, /const rect = captionVisualRect\(\);\s*const layoutRect = captionLayoutRect\(captionPlate\);\s*const center = \{ x: \(rect\.left \+ rect\.right\) \/ 2, y: \(rect\.top \+ rect\.bottom\) \/ 2 \};/u);

  const center = { x: 256 + 109, y: 540 };
  const corners = [[-109, -31], [109, -31], [109, 31], [-109, 31]];
  for (const scale of [0.4, 1, 1.5, 3]) {
    for (const rotate of [0, 15, 90]) {
      const angle = rotate * Math.PI / 180;
      const transformed = corners.map(([x, y]) => ({
        x: center.x + scale * (x * Math.cos(angle) - y * Math.sin(angle)),
        y: center.y + scale * (x * Math.sin(angle) + y * Math.cos(angle))
      }));
      const visualCenterX = (Math.min(...transformed.map(p => p.x)) + Math.max(...transformed.map(p => p.x))) / 2;
      const visualCenterY = (Math.min(...transformed.map(p => p.y)) + Math.max(...transformed.map(p => p.y))) / 2;
      assert.ok(Math.abs(visualCenterX - center.x) < 1e-9, `${scale} ${rotate} x`);
      assert.ok(Math.abs(visualCenterY - center.y) < 1e-9, `${scale} ${rotate} y`);
    }
  }
});

test('resolved display_lines render one paragraph per line', () => {
  assert.match(handlerSource, /Array\.isArray\(caption\.displayLines\)[\s\S]*caption\.displayLines\.length >= 2/u);
  assert.match(handlerSource, /caption\.displayLines\.map\(line => renderText\(line\)\)\.join\([\s\S]*akari-caption__line/u);
});
