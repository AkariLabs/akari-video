import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lintProject } from '../src/edit-lint.mjs';

for (const nested of [false, true]) {
  for (const baked of [undefined, 'existing.mov']) {
    test(`telop retirement: nested=${nested}, baked=${baked ?? 'absent'}`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'akari-telop-retired-'));
      try {
        const item = { id: 'telop', at: 0, duration: 30, source: { kind: 'telop', preset: 'legacy', ...(baked ? { baked } : {}) } };
        const edit = {
          version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
          tracks: [{ id: 'visual', lane: 'visual', items: nested
            ? [{ id: 'group', at: 0, duration: 30, source: { kind: 'group' }, items: [item] }]
            : [item] }],
        };
        await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
        // File existence is sufficient for the lint compatibility check; no renderer is invoked.
        if (baked) await writeFile(join(root, baked), 'existing baked asset');
        const result = await lintProject(root, { writeReports: false });
        const errors = result.findings.filter(f => f.severity === 'error');
        if (baked) assert.deepEqual(errors, []);
        else {
          assert.equal(errors.length, 1);
          assert.equal(errors[0].check, 'telop.retired');
          assert.match(errors[0].message, /退役.*HTML.*Lab/);
          assert.match(errors[0].path, nested ? /items\[0\]\.items\[0\]\.source$/ : /items\[0\]\.source$/);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}
