import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validatePlaybook } from '../validate-playbook.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'project-scaffold', 'test', 'fixtures', 'playbook-sample');
const sample = JSON.parse(await readFile(join(root, 'playbook.json'), 'utf8'));
const markdown = await readFile(join(root, 'playbook.md'), 'utf8');

test('contract example passes', async () => {
  assert.deepEqual((await validatePlaybook(sample, { markdown })).errors, []);
});
test('missing required field fails', async () => {
  const value = structuredClone(sample); delete value.name;
  assert.equal((await validatePlaybook(value, { markdown })).ok, false);
});
test('own sample fails', async () => {
  const value = structuredClone(sample); value.placeholders[0].sample.source = 'own';
  assert.equal((await validatePlaybook(value, { markdown })).ok, false);
});
test('category outside fixed vocabulary fails', async () => {
  const value = structuredClone(sample); value.category = 'other';
  assert.equal((await validatePlaybook(value, { markdown })).ok, false);
});
test('own part fails, unknown skill warns, missing heading fails', async () => {
  const value = structuredClone(sample); value.parts[0].source = 'site'; value.steps[0].skill = 'no-such-skill';
  const result = await validatePlaybook(value, { markdown: markdown.replace('## 要る道具', '## 道具') });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /parts\[0\]/);
  assert.match(result.errors.join(' '), /要る道具/);
  assert.match(result.warnings.join(' '), /no-such-skill/);
});
