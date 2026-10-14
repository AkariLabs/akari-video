import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const catalog = path.join(repo, 'catalog');
const validator = path.join(repo, 'packages/schemas/bin/validate-asset.mjs');

test('every catalog asset entry passes the validator', () => {
  let count = 0;
  for (const category of ['overlay', 'still', 'scene3d', 'audio', 'broll', 'font', 'textstyle']) {
    const categoryDir = path.join(catalog, category);
    if (!existsSync(categoryDir)) continue;
    for (const id of readdirSync(categoryDir)) {
      const dir = path.join(categoryDir, id);
      if (!existsSync(path.join(dir, 'meta.json'))) continue;
      count++;
      const result = spawnSync(process.execPath, [validator, dir], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${category}/${id}\n${result.stdout}\n${result.stderr}`);
    }
  }
  assert.ok(count > 0, 'catalog contains no asset entries');
});
