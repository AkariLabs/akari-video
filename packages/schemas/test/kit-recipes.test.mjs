import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validator = path.join(root, 'bin', 'validate-kit-manifest.mjs');

test('kit manifest validates recipe contents in a separate process', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'akari-kit-recipe-'));
  try {
    const dir = path.join(temp, 'recipes', 'music');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(temp, 'README.md'), '# Test\n');
    writeFileSync(path.join(temp, 'LICENSE.md'), '# CC0\n');
    const manifest = { schemaVersion: 1, id: 'test-kit', kind: 'kit', name: 'Test', version: 1,
      requires: { cli: '>=1.4.0' }, license: 'CC0-1.0', recipes: [{ dir: 'recipes/music' }] };
    const recipe = { version: 0, kind: 'akari-recipe', id: 'music', name: 'Music',
      needs: ['music-generation'], inputs: {}, outputs: [], checkpoint: '', gates: [] };
    const run = () => spawnSync(process.execPath, [validator, temp], { encoding: 'utf8' });
    writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(path.join(dir, 'recipe.json'), JSON.stringify(recipe));
    assert.equal(run().status, 0, run().stderr);
    writeFileSync(path.join(dir, 'recipe.json'), JSON.stringify({ ...recipe, needs: ['teleport'] }));
    assert.match(run().stderr, /validate-akari-recipe/);
    writeFileSync(path.join(dir, 'recipe.json'), JSON.stringify({ ...recipe, id: 'other' }));
    assert.match(run().stderr, /id がフォルダ名と一致しません/);
    manifest.recipes = [{ dir: '../outside' }];
    writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify(manifest));
    assert.match(run().stderr, /recipes\[0\]\.dir/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
