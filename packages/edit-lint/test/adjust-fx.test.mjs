import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintProject } from '../src/edit-lint.mjs';
import { editWithAdjust } from '../../schemas/test/fixtures/adjust-v1-cases.mjs';
import { fxExamples, invalidFxCases, validGroup2FxCases } from '../../schemas/test/fixtures/adjust-fx-cases.mjs';

async function lint(edit) {
  const root = await mkdtemp(join(tmpdir(), 'akari-adjust-fx-'));
  try {
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
    await writeFile(join(root, 'main.mp4'), '');
    return (await lintProject(root, { writeReports: false })).findings.filter(f => f.check.startsWith('adjust.'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
for (const { name, check, edit } of fxExamples) {
  test('lint adjust fx example: ' + name, async () => {
    const findings = await lint(edit);
    if (check) assert.ok(findings.some(f => f.severity === 'error' && f.check === check && f.path.startsWith('edit.json#tracks[0].items[0].adjust.fx')), JSON.stringify(findings));
    else assert.deepEqual(findings, []);
  });
}
test('lint fx uses stable error checks even when bypassed', async () => {
  for (const [name, adjust, check] of invalidFxCases) {
    const findings = await lint(editWithAdjust(adjust.fx !== undefined ? { ...adjust, sections: { fx: false } } : adjust));
    assert.ok(findings.some(f => f.severity === 'error' && f.check === check), name + ': ' + JSON.stringify(findings));
  }
});
test('lint accepts empty and default fx with either section state', async () => {
  for (const fx of [[], [{ id: 'blur' }]]) for (const enabled of [true, false]) {
    assert.deepEqual(await lint(editWithAdjust({ fx, sections: { fx: enabled } })), []);
  }
});

test('group two accepts defaults and inclusive boundaries with either section state', async () => {
  for (const value of validGroup2FxCases) for (const enabled of [true, false]) {
    const adjust = { ...value, sections: { fx: enabled } };
    assert.deepEqual(await lint(editWithAdjust(adjust)), []);
  }
});
