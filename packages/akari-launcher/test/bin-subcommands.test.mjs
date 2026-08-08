import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(packageRoot, 'bin', 'akari.mjs');

for (const [name, args, expected] of [
  ['new', ['new', '--help'], 'akari new <target-dir>'],
  ['narration', ['narration', '--help'], 'akari narration generate'],
  ['internal', ['internal', '--help'], 'beat-sync-render-when-idle']
]) {
  test(`bin/akari.mjs: ${name} 分岐が help を表示する`, () => {
    const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(expected));
  });
}
