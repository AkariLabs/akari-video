import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const schemasRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const markdown = await readFile(
  join(schemasRoot, '..', 'project-scaffold', 'test', 'fixtures', 'playbook-sample', 'playbook.md'), 'utf8');

test('validate-playbook checks the basic shape when ajv is absent', (t) => {
  const isolated = mkdtempSync(join(tmpdir(), 'akari-playbook-no-ajv-'));
  t.after(() => rmSync(isolated, { recursive: true, force: true }));
  for (const name of ['validate-playbook.mjs', 'playbook.schema.json']) {
    copyFileSync(join(schemasRoot, name), join(isolated, name));
  }
  const jsonPath = join(isolated, 'playbook.json');
  const markdownPath = join(isolated, 'playbook.md');
  writeFileSync(markdownPath, markdown);
  const valid = {
    version: 0, kind: 'akari-playbook', id: 'example', name: 'Example', playbookVersion: 1,
    depth: 1, category: 'vlog', steps: [{ id: 'step', title: 'Step', what: 'Do it' }],
    settings: {}, license: 'CC0', provenance: {
      fromProject: 'example', recordedAt: '2026-10-16', akariVersion: '1.4.0', recordedBy: 'test',
    },
  };
  const run = value => {
    writeFileSync(jsonPath, JSON.stringify(value));
    return spawnSync(process.execPath, [join(isolated, 'validate-playbook.mjs'), jsonPath, markdownPath], {
      encoding: 'utf8', env: { ...process.env, NODE_PATH: '' },
    });
  };
  const passed = run(valid);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /^OK:/u);
  assert.deepEqual(passed.stderr.trim().split('\n'), ['WARN: ajv が無いため schema の詳細な検査を省きました']);

  const missing = structuredClone(valid);
  delete missing.name;
  const missingResult = run(missing);
  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /required property 'name'/u);

  const wrongTypes = structuredClone(valid);
  wrongTypes.steps = 'step';
  wrongTypes.provenance.fromProject = 5;
  const wrongTypesResult = run(wrongTypes);
  assert.equal(wrongTypesResult.status, 1);
  assert.match(wrongTypesResult.stderr, /\/steps must be array/u);
  assert.match(wrongTypesResult.stderr, /\/provenance\/fromProject must be string/u);
});
