import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariTasksServiceImpl } from '../lib/node/akari-tasks-service.js';
import { importTaskifyResult } from '../lib/node/taskify/taskify-import.js';
import { validateResult } from '../lib/node/taskify/taskify-schema.js';
import { applyTaskPatch } from '../../../../../packages/edit-store/lib/tasks-store.js';
import { availableActions } from '../lib/common/task-actions.js';
const raw = { summary: '案', tasks: [{ ref: 't1', title: '公開前に確認', body: '公開前に確認する', kind: 'ask',
  target: { outputT: 0, src: 'a', sourceT: 0, cutIndex: 0, refs: [], region: null },
  evidence: { memo: 'c-0001', speech: [0, 1], quote: '確認', ink: [] }, confidence: 'low',
  needsConfirm: true, question: '確認しますか', risk: 'outbound', route: 'human', priority: 0, dependsOn: [] }] };
test('proposal import is idempotent, revision preserving, and never writes review.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'taskify-import-'));
  const uri = pathToFileURL(root).toString(); const review = join(root, 'review.json');
  await writeFile(review, '{"annotations":[]}\n'); const before = await stat(review);
  const service = new AkariTasksServiceImpl(); const result = validateResult(raw);
  const request = jobId => ({ projectRootUri: uri, memoId: 'c-0001', jobId,
    paperPath: 'review/canvas/c-0001/taskify/r1/input/paper.png', result });
  assert.equal(await importTaskifyResult(service, request('c-0001-r1')), 1);
  assert.equal(await importTaskifyResult(service, request('c-0001-r1')), 0);
  assert.equal(await importTaskifyResult(service, request('c-0001-r2')), 1);
  const tasks = (await service.list({ projectRootUri: uri })).tasks.filter(t => t.source === 'proposal');
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].state, 'unsent'); assert.equal(tasks[0].needsConfirm, true);
  assert.equal(tasks[0].createdBy, 'ai'); assert.equal(tasks[0].via, 'paper');
  assert.equal(tasks[0].target, '画面');
  assert.equal(tasks[0].attachments[0].path, 'review/canvas/c-0001/taskify/r1/input/paper.png');
  assert.equal(tasks[0].gate, 'ask'); assert.equal(tasks[0].undo.reversible, false);
  assert.deepEqual(availableActions(tasks[0]).map(action => action.id), ['approve', 'dismiss']);
  assert.equal(availableActions(tasks[0]).some(action => action.id === 'send'), false);
  assert.equal((await readFile(review, 'utf8')), '{"annotations":[]}\n');
  assert.equal((await stat(review)).mtimeMs, before.mtimeMs);
  await assert.rejects(service.create({ projectRootUri: uri, task: { ...tasks[0], body: 'bad' } }));
  await assert.rejects(service.createProposal({ projectRootUri: uri, task: { ...tasks[0], body: 'bad' } }));
  assert.throws(() => applyTaskPatch(tasks[0], { needsConfirm: false, confirmedAt: new Date().toISOString() }, 'agent'));
  const approved = applyTaskPatch(tasks[0], { needsConfirm: false, confirmedAt: new Date().toISOString() }, 'human');
  assert.equal(approved.gate, 'ask'); assert.equal(approved.risk, 'outbound');
  assert.equal(availableActions(approved).find(action => action.id === 'send').confirm, true);
});
