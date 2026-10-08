import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { enumerateEditContext, contextAt, editContextLine } from '../lib/node/taskify/taskify-edit-context.js';
import { buildBundle } from '../lib/node/taskify/taskify-bundle.js';
import { validateResult } from '../lib/node/taskify/taskify-schema.js';

const editText = await readFile(fileURLToPath(new URL('../../../../../dev-fixtures/overlay-html-slots/edit.json', import.meta.url)), 'utf8');
const edit = JSON.parse(editText);
const task = { ref: 't1', title: '第1章を直す', body: '第1章の表示を直す', kind: 'edit',
  target: { outputT: 1, src: 'background', sourceT: 1, cutIndex: 0,
    refs: ['cut:0', 'overlay:slot-a', 'overlay:missing'], region: null },
  evidence: { memo: 'c-0001', speech: [0, 1], quote: '第1章', ink: [] }, confidence: 'high',
  needsConfirm: false, question: null, risk: 'reversible', route: 'agent', priority: 0, dependsOn: [] };
test('v2 media and overlays share one time and ref enumeration', () => {
  const entries = enumerateEditContext(edit);
  assert.equal(entries.find(entry => entry.ref === 'cut:0').end, 3);
  assert.equal(entries.find(entry => entry.ref === 'overlay:slot-a').kind, 'html');
  assert.match(editContextLine(entries.find(entry => entry.ref === 'cut:0')), /cut:0 background 0–3s \(media photo-a\.png\)/);
  assert.match(editContextLine(entries.find(entry => entry.ref === 'overlay:slot-a')), /overlay:slot-a html 0–3s.*transform\(x=0,y=-110,scale=1,rotate=0\).*第1章/);
  assert.equal(contextAt(entries, 100).length, 0);
  assert.ok(contextAt(entries).length <= 30);
});
test('v2 bundle has readable slot line and validator preserves slot-a', () => {
  const canvas = { memo: '第1章', backdrop: null,
    subject: { playhead: { outputT: 1, src: 'background', sourceT: 1, cutIndex: 0 }, selection: [] } };
  const ink = { schema: 'akari.ink.v0', space: 'canvas-rect', aspect: { w: 1280, h: 720 }, objects: [] };
  const bundle = buildBundle({ canvas, ink, paper: Buffer.from('paper'), includeBackdrop: false, editText });
  assert.match(bundle.context, /overlay:slot-a html 0–3s/);
  assert.doesNotMatch(bundle.context, /"cuts":\[\]/);
  const validated = validateResult({ summary: '案', tasks: [task] }, { edit });
  assert.deepEqual(validated.tasks[0].target.refs, ['cut:0', 'overlay:slot-a']);
  assert.equal(validated.validated.refsDropped, 1);
});
