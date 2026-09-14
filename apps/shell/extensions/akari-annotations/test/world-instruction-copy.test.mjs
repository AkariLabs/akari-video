import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { worldInstructionCopy } = require('../lib/common/world-instruction-copy.js');

test('stop copy contains intent and the minimal locator', () => {
  const text = worldInstructionCopy({ kind: 'world', world: { id: 'w', label: '庭' }, stop: { id: 'pond', at: 1, leave: 2 } });
  assert.match(text, /停留所「pond」/); assert.match(text, /cameraStops\[id="pond"\]/); assert.doesNotMatch(text, /schemaVersion|worlds/);
});
test('edge copy contains transition and the minimal locator', () => {
  const text = worldInstructionCopy({ kind: 'world', world: { id: 'w', label: '庭' }, edge: { id: 'gate', from: 'a', to: 'b', type: 'portal', transition: { kind: 'dive', cover: .2 } } });
  assert.match(text, /a → b・portal・transition dive・cover 0.2 s/); assert.match(text, /edges\[id="gate"\]/); assert.doesNotMatch(text, /schemaVersion|cameraStops/);
});
