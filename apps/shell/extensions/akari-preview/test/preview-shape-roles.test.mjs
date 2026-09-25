import assert from 'node:assert/strict';
import test from 'node:test';
import { previewShapeRoles } from '../lib/common/preview-shape-roles.js';

test('v2 shape kind survives HTML lowering as hit-region role', () => {
  const roles = previewShapeRoles({ version: 2, tracks: [{ lane: 'visual', items: [
    { id: 'box', source: { kind: 'shape', shape: 'rect' } },
    { id: 'path', source: { kind: 'shape', shape: 'path' } },
    { id: 'line', source: { kind: 'shape', shape: 'line' } },
    { id: 'group', items: [{ id: 'arrow', source: { kind: 'shape', shape: 'arrow' } }] }
  ] }, { lane: 'audio', items: [{ id: 'ignored', source: { kind: 'shape', shape: 'rect' } }] }] });
  assert.deepEqual([...roles], [['box', 'shape'], ['path', 'shape'], ['line', 'shape-line'], ['arrow', 'shape-line']]);
});
