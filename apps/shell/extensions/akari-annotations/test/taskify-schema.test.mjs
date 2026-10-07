import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TASKIFY_SCHEMA, validateResult } from '../lib/node/taskify/taskify-schema.js';

const base = { summary: '案', tasks: [{ ref: 't1', title: '字幕を動かす', body: '字幕を動かす', kind: 'edit',
  target: { outputT: 0, src: 'a', sourceT: 0, cutIndex: 0, refs: ['cut:0'], region: null },
  evidence: { memo: 'c-0001', speech: [0, 1], quote: '字幕', ink: [] }, confidence: 'high',
  needsConfirm: false, question: null, risk: 'reversible', route: 'agent', priority: 0, dependsOn: [] }] };
const edit = { cuts: [{}], overlays: [{ id: 'x' }] };
test('CLI schema excludes unsupported keywords', () => {
  assert.doesNotMatch(JSON.stringify(TASKIFY_SCHEMA), /\$schema|prefixItems|uniqueItems/);
});
test('vocabulary, title length, and count are checked in the app', () => {
  for (const change of [task => task.kind = 'wrong', task => task.title = 'あ'.repeat(41),
    task => task.route = 'wrong']) {
    const value = structuredClone(base); change(value.tasks[0]); assert.throws(() => validateResult(value, { edit }));
  }
  assert.throws(() => validateResult({ ...base, tasks: Array(6).fill(base.tasks[0]) }, { edit }));
});
test('unknown refs are removed and proposed regions require confirmation', () => {
  const value = structuredClone(base); value.tasks[0].target.refs.push('overlay:missing');
  value.tasks[0].target.region = { box: [0.1, 0.2, 0.3, 0.4] };
  const result = validateResult(value, { edit });
  assert.deepEqual(result.tasks[0].target.refs, ['cut:0']); assert.equal(result.validated.refsDropped, 1);
  assert.equal(result.tasks[0].needsConfirm, true); assert.equal(result.tasks[0].confidence, 'low');
});
test('the real corner-coordinate reply becomes a paper-relative width and height', () => {
  const reply = structuredClone(base);
  reply.tasks[0].target.region = { box: [0.56, 0.63, 0.73, 0.93] };
  const result = validateResult(reply, { edit });
  const [x, y, width, height] = result.tasks[0].target.region.box;
  assert.deepEqual([x, y], [0.56, 0.63]);
  assert.ok(Math.abs(width - 0.17) < 1e-9); assert.ok(Math.abs(height - 0.30) < 1e-9);
  assert.ok(result.validated.warnings.some(warning => warning.includes('region を補正')));
  assert.equal(result.tasks[0].needsConfirm, true);
});
test('region values are clamped; an unrecoverable box becomes null', () => {
  const clipped = structuredClone(base);
  clipped.tasks[0].target.region = { box: [-0.2, 0.2, 0.4, 0.5] };
  const corrected = validateResult(clipped, { edit });
  assert.deepEqual(corrected.tasks[0].target.region.box, [0, 0.2, 0.4, 0.5]);
  assert.ok(corrected.validated.warnings.some(warning => warning.includes('region を補正')));
  const invalid = structuredClone(base);
  invalid.tasks[0].target.region = { box: [0.9, 0.9, 0.2, 0.1] };
  const dropped = validateResult(invalid, { edit });
  assert.equal(dropped.tasks[0].target.region, null);
  assert.ok(dropped.validated.warnings.some(warning => warning.includes('region を破棄')));
  const valid = structuredClone(base);
  valid.tasks[0].target.region = { box: [0.2, 0.3, 0.4, 0.5] };
  assert.deepEqual(validateResult(valid, { edit }).tasks[0].target.region.box, [0.2, 0.3, 0.4, 0.5]);
});
test('command text is warned and outbound risk survives; empty tasks are valid', () => {
  const value = structuredClone(base); value.tasks[0].risk = 'outbound';
  value.tasks[0].body = 'https://example.test rm -rf ~/elsewhere/file';
  const result = validateResult(value, { edit });
  assert.equal(result.tasks[0].risk, 'outbound'); assert.equal(result.validated.outboundHeld, 1);
  assert.equal(result.validated.warnings.length, 3);
  assert.deepEqual(validateResult({ summary: '紙が空です', tasks: [] }).tasks, []);
});
test('ten raw experiment outputs validate when the read-only lab is supplied', async t => {
  const lab = process.env.AKARI_TASKIFY_LAB;
  if (!lab) { t.skip('AKARI_TASKIFY_LAB is not set'); return; }
  const fixtureEdit = JSON.parse(await readFile(join(lab, 'fixture', 'edit.json'), 'utf8'));
  const names = (await readdir(join(lab, 'results'))).filter(name => /-claude-sonnet-default$/.test(name));
  assert.equal(names.length, 10);
  for (const name of names) {
    const raw = JSON.parse(await readFile(join(lab, 'results', name, 'stdout.txt'), 'utf8'));
    assert.doesNotThrow(() => validateResult(raw.structured_output ?? JSON.parse(raw.result), { edit: fixtureEdit }), name);
  }
});
