import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import { renderOverlaySheet } from '../src/rasterize.mjs';
import { readRenderEdit } from '../src/internal-render.mjs';
import { enumerateDeclaredRenderInputs } from '../src/render-inputs.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { evaluateOverlayMotion, motionRevealCss } = require('../../overlay-runtime/src/item-motion.js');
const fps = 30;
const overlay = {
  id: 'child', start: 1, duration: 2, html: '<div>child</div>',
  transform: { x: 10, y: 4, scale: 2 }, opacity: .5,
  keyframeUnit: 'frames',
  motionSource: { at: 1, duration: 2, keyframeUnit: 'frames', transform: { x: 10, y: 4, scale: 2 },
    opacity: .5, keyframes: [{ t: 0, transform: { x: 0 } }, { t: 60, transform: { x: 100 } }],
    motion: { in: { preset: 'slide-up', duration: 30, amount: 40 } } },
  motionParents: [{ at: 0, duration: 3, keyframeUnit: 'seconds', transform: { x: 7, scale: 1.5 },
    motion: { loop: { preset: 'pulse', period: 30, amount: .1 } } }],
};

test('OSR sheet applies the preview evaluator to transmitted child and canvas motion', () => {
  const sheet = renderOverlaySheet({ overlays: [overlay],
    edit: { output: { width: 640, height: 360, fps } }, duration: 3, projectRoot: '/unused' });
  assert.match(sheet, /window\.akari\.itemMotion\.evaluateOverlayMotion/u);
  const attribute = sheet.match(/data-akari-item-motion="([^"]+)"/u)?.[1];
  assert.ok(attribute);
  const transmitted = JSON.parse(attribute.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  const script = sheet.match(/window\.__akariSyncAnimations = function\(seconds\) \{[\s\S]*?\n    \};/u)?.[0];
  assert.ok(script);
  const styles = new Map();
  const container = {
    dataset: { akariItemMotion: JSON.stringify(transmitted) },
    hasAttribute: name => name === 'data-akari-item-motion' || name === 'data-akari-keyframes',
    style: { setProperty: (name, value) => styles.set(name, value) },
    getAnimations: () => [],
  };
  const context = { window: { akari: { itemMotion: { evaluateOverlayMotion, motionRevealCss } } },
    document: { querySelectorAll: () => [container] } };
  vm.runInNewContext(script, context);
  for (const seconds of [1, 1.25, 1.5, 2, 2.75]) {
    context.window.__akariSyncAnimations(seconds);
    const expected = evaluateOverlayMotion(overlay, seconds, fps);
    assert.ok(Math.abs(Number.parseFloat(styles.get('--x')) - expected.x) < 1e-9);
    assert.ok(Math.abs(Number.parseFloat(styles.get('--y')) - expected.y) < 1e-9);
    assert.ok(Math.abs(Number(styles.get('--scale')) - expected.scale) < 1e-9);
    assert.ok(Math.abs(Number(styles.get('opacity')) - expected.opacity) < 1e-9);
  }
});

test('render projection carries a shape and HTML child through canvas motion', async t => {
  const root = mkdtempSync(join(tmpdir(), 'akari-motion-projection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const edit = { version: 2, output: { width: 640, height: 360, fps }, sources: [],
    tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'canvas', at: 30, duration: 60,
      source: { kind: 'group' }, transform: { x: 10 },
      motion: { in: { preset: 'scale', duration: 30, amount: .2 } },
      items: [{ id: 'shape', at: 0, duration: 60, source: { kind: 'shape', shape: 'ellipse' },
        keyframes: [{ t: 0, transform: { x: 0 } }, { t: 60, transform: { x: 100 } }] }]
    }] }] };
  writeFileSync(join(root, 'edit.json'), JSON.stringify(edit));
  const projected = readRenderEdit(JSON.stringify(edit), join(root, '.akari', 'render-tmp'),
    { projectRoot: root }).edit.overlays;
  const shape = projected.find(record => record.id === 'shape');
  assert.ok(shape);
  assert.equal(shape.motionSource.keyframeUnit, 'frames');
  assert.equal(shape.motionParents.length, 1);
  assert.equal(shape.keyframes[1].t, 60);
  assert.equal(evaluateOverlayMotion(shape, 1, fps).x, 10);
  assert.equal(evaluateOverlayMotion(shape, 2, fps).x, 60);
  const inputs = await enumerateDeclaredRenderInputs({ projectRoot: root,
    edit: { ...edit, overlays: projected }, editText: JSON.stringify(edit) });
  assert.ok(inputs.some(input => input.role === 'overlay:shape'));
});
