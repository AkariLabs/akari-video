import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(packageRoot, 'edit.schema.json'), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const { TRANSITION_TYPE_IDS } = createRequire(import.meta.url)(
  '../../edit-store/lib/index.js'
);

const editFor = type => ({
  version: 0,
  output: { width: 1280, height: 720, fps: 30 },
  source: { path: 'source.mp4', proxy: null },
  cuts: [
    { in: 0, out: 2, transition_out: { type, duration: 0.5 } },
    { in: 2, out: 4 },
  ],
  overlays: [],
});

test('正準 29 種は JSON Schema と validate-edit CLI を往復する', () => {
  assert.deepEqual(schema.$defs.transitionOut.properties.type.enum, TRANSITION_TYPE_IDS);
  const root = mkdtempSync(join(tmpdir(), 'akari-transition-schema-'));
  try {
    for (const type of TRANSITION_TYPE_IDS) {
      const edit = editFor(type);
      assert.equal(validate(edit), true, `${type}: ${JSON.stringify(validate.errors)}`);
      const editPath = join(root, `${type}.json`);
      writeFileSync(editPath, `${JSON.stringify(edit)}\n`);
      const executed = spawnSync(process.execPath, [join(packageRoot, 'bin', 'validate-edit.mjs'), editPath], {
        encoding: 'utf8'
      });
      assert.equal(executed.status, 0, `${type}: ${executed.stderr}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('未知種別は schema と validate-edit CLI の双方で拒否される', () => {
  const edit = editFor('future-transition');
  assert.equal(validate(edit), false);
  const root = mkdtempSync(join(tmpdir(), 'akari-transition-schema-invalid-'));
  try {
    const editPath = join(root, 'edit.json');
    writeFileSync(editPath, `${JSON.stringify(edit)}\n`);
    const executed = spawnSync(process.execPath, [join(packageRoot, 'bin', 'validate-edit.mjs'), editPath], {
      encoding: 'utf8'
    });
    assert.equal(executed.status, 1);
    assert.match(executed.stderr, /future-transition|いずれか/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
