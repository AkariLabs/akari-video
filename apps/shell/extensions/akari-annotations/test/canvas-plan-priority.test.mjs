import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { canvasAtFrame, canvasDropTargets } = require('../lib/browser/canvas-drop-target.js');
test('planned child is the drop target inside a template group', () => {
  const tracks = [{ lane: 'visual', items: [{ id: 'root', at: 0, duration: 30,
    source: { kind: 'group', canvas: { origin: 'user' } }, items: [{ id: 'slot', at: 0, duration: 30,
      source: { kind: 'group', canvas: { origin: 'plan' } }, items: [] }] }] }];
  assert.equal(canvasAtFrame(canvasDropTargets(tracks), 15).id, 'slot');
});
