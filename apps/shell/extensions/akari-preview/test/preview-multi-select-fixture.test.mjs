import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolvePreviewItemWriteBatch } from '../../../../../packages/edit-store/lib/edit-v2-item-write.js';
import { lintProject } from '../../../../../packages/edit-lint/src/edit-lint.mjs';

test('prepared L1 fixture and three-item batch both pass the actual edit-lint candidate checks', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'akari-multi-fixture-test-'));
  try {
    const prepare = fileURLToPath(new URL('../evidence/preview-multi-select-v1/scripts/prepare-fixture.mjs', import.meta.url));
    execFileSync(process.execPath, [prepare, workspace], { stdio: 'pipe' });
    const project = join(workspace, 'project'), editPath = join(project, 'edit.json');
    const original = await readFile(editPath, 'utf8');
    const edit = JSON.parse(original);
    assert.deepEqual(edit.tracks.map(track => [track.lane, track.items.map(item => item.id)]),
      ['a','b','c','g'].map(id => ['visual', [id]]));
    assert.ok(edit.tracks.every(track => track.items[0].at === 0 && track.items[0].duration === 120));
    const commands = ['a','b','c'].map(itemId => ({ kind: 'overlay', itemId, patch: { transform: { x: 25, y: 18 } } }));
    const resolved = resolvePreviewItemWriteBatch(original, commands);
    assert.equal(typeof resolved.candidateText, 'string');
    const moved = JSON.parse(resolved.candidateText).tracks.flatMap(track => track.items);
    assert.deepEqual(moved.slice(0, 3).map(item => item.transform), Array(3).fill({ x: 25, y: 18 }));
    assert.deepEqual(moved[3], edit.tracks[3].items[0]);
    for (const [label, text] of [['prepared', original], ['batch candidate', resolved.candidateText]]) {
      const lint = await lintProject(project, { inputOverrides: { 'edit.json': text }, writeReports: false });
      assert.equal(lint.verdict, 'pass', `${label}: ${JSON.stringify(lint.findings)}`);
      assert.ok(!lint.findings.some(finding => finding.severity === 'error'), label);
    }
    assert.equal(await readFile(editPath, 'utf8'), original, 'candidate checking does not write edit.json');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
