import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { lintProject } from '../src/edit-lint.mjs';
import { createRequire } from 'node:module';
import { readLintSourceSync } from './helpers/read-lint-source.mjs';

const require = createRequire(import.meta.url);
const { projectLegacyEdit, readInternalEdit } = require('../../edit-store/lib/index.js');
const scratch = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.tmp-lane');
const lintSource = readLintSourceSync();
const validatorSource = lintSource.slice(lintSource.indexOf('function validateCutTransformFields('),
  lintSource.indexOf('function validateStillImageCuts('));
const validateLegacyCuts = cuts => {
  const findings = [];
  vm.runInNewContext(`${validatorSource}; validateCutTransformFields(cuts, findings)`, {
    cuts, findings, isRecord: value => value !== null && typeof value === 'object' && !Array.isArray(value),
    isFiniteNumber: value => typeof value === 'number' && Number.isFinite(value),
    isPositiveNumber: value => typeof value === 'number' && Number.isFinite(value) && value > 0,
    addFinding: (list, finding) => list.push(finding),
  });
  return findings;
};

const editFor = (version, transform) => {
  const cut = { id: 'still', at: 0, src: 'main', in: 0, out: 1, transform };
  const shared = {
    output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4' }],
  };
  if (version === 1) return { version, ...shared, cuts: [cut], overlays: [] };
  return { version, ...shared, tracks: [{ id: 'visual', lane: 'visual', items: [{
    id: 'still', at: 0, duration: 30, source: { kind: 'media', src: 'main', in: 0, out: 1 }, transform,
  }] }] };
};

async function lint(edit) {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'cut-transform-'));
  try {
    await writeFile(join(root, 'edit.json'), `${JSON.stringify(edit)}\n`);
    await writeFile(join(root, 'main.mp4'), '');
    return await lintProject(root, { writeReports: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const version of [1, 2]) {
  test(`v${version} cut accepts positive scaleX and scaleY`, async () => {
    const transform = { scale: 0.5, scaleX: 0.6, scaleY: 0.5 };
    const edit = editFor(version, transform);
    if (version === 2) {
      const projected = projectLegacyEdit(readInternalEdit(edit));
      assert.deepEqual(projected.cuts[0].transform, transform);
    }
    const findings = version === 2 ? (await lint(edit)).findings : validateLegacyCuts(edit.cuts);
    assert.equal(findings.filter(f => f.check === 'cuts.transform' && f.severity === 'error').length, 0);
  });

  for (const [field, value] of [['scaleX', -1], ['scaleY', 0], ['scaleX', '0.6'], ['scaleY', '0.5']]) {
    test(`v${version} cut rejects ${field}=${JSON.stringify(value)}`, async () => {
      const edit = editFor(version, { scale: 0.5, scaleX: 0.6, scaleY: 0.5, [field]: value });
      const findings = validateLegacyCuts(version === 2
        ? [{ transform: edit.tracks[0].items[0].transform }] : edit.cuts);
      assert.ok(findings.some(f => f.severity === 'error'
        && (f.path?.endsWith(`.transform.${field}`) || f.message?.includes(field))),
      JSON.stringify(findings));
      if (version === 2) await assert.rejects(lint(edit), new RegExp(field));
    });
  }
}
