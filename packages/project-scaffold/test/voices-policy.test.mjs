import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const deniedReads = ['Read(/.akari/sidecars/**/voices.json)', 'Read(./.akari/sidecars/**/voices.json)'];

test('雛形と 2 つの予備設定で声の側ファイルの読み取りを拒む', async () => {
  const template = JSON.parse(await readFile(path.join(root, 'templates/project-default/.claude/settings.json'), 'utf8'));
  for (const rule of deniedReads) assert.ok(template.permissions.deny.includes(rule));

  const scaffold = await readFile(path.join(root, 'packages/project-scaffold/src/index.mjs'), 'utf8');
  const service = await readFile(path.join(root, 'apps/shell/extensions/akari-project/src/node/akari-project-service.ts'), 'utf8');
  for (const source of [scaffold, service]) {
    for (const rule of deniedReads) assert.ok(source.includes(`'${rule}'`));
  }
});
