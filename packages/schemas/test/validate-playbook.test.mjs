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
test('relative preview paths and example pass', async () => {
  const value = structuredClone(sample);
  value.preview = { cover: 'preview/cover.png', frames: ['preview/frames/01.png', 'preview/frames/02.png', 'preview/frames/03.png'] };
  value.example = true;
  assert.equal((await validatePlaybook(value, { markdown })).ok, true);
});
test('parent traversal in preview fails', async () => {
  const value = structuredClone(sample);
  value.preview = { frames: ['../outside.png'] };
  assert.equal((await validatePlaybook(value, { markdown })).ok, false);
});
test('beats accept seconds and warn about an unknown placeholder', async () => {
  const value = structuredClone(sample);
  value.beats = [{ id: 'hook', at: 0, duration: 3, title: 'つかみ', placeholder: 'missing' }];
  const result = await validatePlaybook(value, { markdown: `${markdown}\n## 内訳\n` });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.match(result.warnings.join(' '), /missing/);
});
test('beats reject negative starts and nonpositive durations', async () => {
  const value = structuredClone(sample);
  value.beats = [{ id: 'hook', at: -1, duration: 0, title: 'つかみ' }];
  const result = await validatePlaybook(value, { markdown: `${markdown}\n## 内訳\n` });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /beats\/0\/at/);
  assert.match(result.errors.join(' '), /beats\/0\/duration/);
});
