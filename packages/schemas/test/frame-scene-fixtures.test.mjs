import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFrameScene } from '../../frame-scene/src/schema.mjs';

const root = fileURLToPath(new URL('../fixtures/frame-scene/', import.meta.url));
for (const group of ['valid', 'invalid']) for (const name of fs.readdirSync(path.join(root, group))) {
  test(`${group}/${name}`, () => {
    const dir = path.join(root, group, name);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
    const result = validateFrameScene(doc);
    assert.equal(result.ok, expected.ok);
    assert.deepEqual([...result.errors, ...result.warnings].map(i => i.code).sort(), expected.code.slice().sort());
  });
}
