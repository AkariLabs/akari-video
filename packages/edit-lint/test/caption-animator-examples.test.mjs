import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { lintProject } from '../src/edit-lint.mjs';

const examples = new URL('../../schemas/examples/', import.meta.url);
const cases = [
  { name: 'edit-v2-caption-animator-valid', verdict: 'pass', errors: [] },
  {
    name: 'edit-v2-caption-animator-unknown-ref-invalid', verdict: 'fail',
    errors: [{ check: 'animator.unknown-ref', severity: 'error',
      path: 'edit.json#tracks[0].items[0].keyframes[1].animator["missing"]' }],
  },
];

for (const { name, verdict, errors } of cases) {
  test(`caption animator example verdict parity: ${name}`, async () => {
    for (const engine of [undefined, 'gpu']) {
      const result = await lintProject(fileURLToPath(new URL(`${name}/`, examples)), {
        engine, checkedAt: '2026-09-06T00:00:00.000Z', writeReports: false,
      });
      assert.equal(result.verdict, verdict, JSON.stringify(result.findings));
      assert.deepEqual(result.findings.filter(finding => finding.severity === 'error')
        .map(({ check, severity, path }) => ({ check, severity, path })), errors);
      assert.deepEqual(result.findings.filter(finding => finding.check.startsWith('animator.'))
        .map(({ check, severity, path }) => ({ check, severity, path })), errors);
    }
  });
}

test('caption animator keyframes remain unsupported on osr and are attributed to osr in auto', async () => {
  const root = fileURLToPath(new URL('edit-v2-caption-animator-valid/', examples));
  for (const engine of ['osr', 'auto']) {
    const result = await lintProject(root, { engine, writeReports: false });
    const findings = result.findings.filter(finding => finding.check === 'engine.unsupported-field');
    assert.equal(result.verdict, 'fail');
    assert.ok(findings.some(finding => finding.path.endsWith('.keyframes')));
    assert.ok(findings.some(finding => finding.path.endsWith('.animator')));
    assert.ok(findings.every(finding => finding.message.startsWith('osr')), JSON.stringify(findings));
  }
});

test('GPU caption animator exception accepts selector easing but preserves unsupported channels and targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'caption-animator-examples-'));
  try {
    await cp(new URL('edit-v2-caption-animator-valid/', examples), root, { recursive: true });
    const original = JSON.parse(await readFile(join(root, 'edit.json'), 'utf8'));
    const lint = async edit => {
      await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
      return await lintProject(root, { engine: 'gpu', writeReports: false });
    };
    const eased = structuredClone(original);
    eased.tracks[0].items[0].keyframes[1].easing = 'hold';
    assert.equal((await lint(eased)).verdict, 'pass');

    const unsupported = structuredClone(original);
    unsupported.tracks[0].items[0].keyframes[1].crop = { x: 0, y: 0, w: 1, h: 1 };
    const cropResult = await lint(unsupported);
    assert.ok(cropResult.findings.some(finding => finding.check === 'engine.unsupported-field'
      && finding.path.endsWith('.crop')), JSON.stringify(cropResult.findings));

    const withoutAnimator = structuredClone(original);
    delete withoutAnimator.tracks[0].items[0].animator;
    withoutAnimator.tracks[0].items[0].keyframes = [{ t: 0 }, { t: 15 }];
    const noAnimatorResult = await lint(withoutAnimator);
    assert.ok(noAnimatorResult.findings.some(finding => finding.check === 'engine.unsupported-field'
      && finding.path.endsWith('.keyframes')), JSON.stringify(noAnimatorResult.findings));

    const group = structuredClone(original);
    group.tracks[0].items[0].source = { kind: 'group' };
    const groupResult = await lint(group);
    assert.ok(groupResult.findings.some(finding => finding.check === 'engine.unsupported-field'
      && finding.path.endsWith('.keyframes')), JSON.stringify(groupResult.findings));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
