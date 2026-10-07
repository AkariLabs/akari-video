import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateTasks } from '../bin/validate-tasks.mjs';

const root = fileURLToPath(new URL('./fixtures/tasks/', import.meta.url));
const cli = fileURLToPath(new URL('../bin/validate-tasks.mjs', import.meta.url));
for (const group of ['valid', 'invalid']) {
  for (const name of fs.readdirSync(path.join(root, group))) {
    test(`${group}/${name}`, () => {
      const dir = path.join(root, group, name);
      const file = path.join(dir, 'tasks.json');
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
      const result = validateTasks(doc);
      assert.equal(result.ok, expected.ok);
      assert.equal(spawnSync(process.execPath, [cli, file]).status, expected.ok ? 0 : 1);
    });
  }
}

test('引数が無ければ終了コード 2', () => {
  assert.equal(spawnSync(process.execPath, [cli]).status, 2);
});

test('契約文書の JSON 例は検証できる', () => {
  const contract = fs.readFileSync(fileURLToPath(new URL('../../../docs/contract-2026-10-07-tasks-v0.md', import.meta.url)), 'utf8');
  const examples = [...contract.matchAll(/```json\n([\s\S]*?)\n```/g)];
  assert.ok(examples.length > 0);
  for (const example of examples) assert.equal(validateTasks(JSON.parse(example[1])).ok, true);
});

test('任意の列挙値は警告に留める', () => {
  const doc = { version: 0, tasks: [{ id: 't-0001', source: 'annotation', state: 'unsent',
    createdAt: '2026-10-07T00:00:00Z', priority: 'future' }] };
  const result = validateTasks(doc);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(warning => warning.includes('priority')));
});
