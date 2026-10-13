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
  source: { path: 'source.mp4' },
  cuts: [
    { in: 0, out: 2, transition_out: { type, duration: 0.5, align: 'before-cut' } },
    { in: 2, out: 4 },
  ],
  overlays: [],
});

const editV2For = type => ({
  version: 2,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [{ id: 'main', path: 'source.mp4' }],
  tracks: [{ id: 'visual', lane: 'visual', items: [
    { id: 'first', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2,
      transition_out: { type, duration: 0.5, align: 'before-cut' } } },
    { id: 'second', at: 45, duration: 60, source: { kind: 'media', src: 'main', in: 2, out: 4 } },
  ] }],
});

test('正準 29 種は JSON Schema と validate-edit CLI を往復する', () => {
  assert.equal(TRANSITION_TYPE_IDS.length, 29);
  assert.deepEqual(schema.$defs.transitionOut.properties.type['x-akari-known-values'], TRANSITION_TYPE_IDS);
  const root = mkdtempSync(join(tmpdir(), 'akari-transition-schema-'));
  try {
    for (const [version, makeEdit] of [[0, editFor], [2, editV2For]]) for (const type of TRANSITION_TYPE_IDS) {
      const edit = makeEdit(type);
      assert.equal(validate(edit), true, `${type}: ${JSON.stringify(validate.errors)}`);
      const editPath = join(root, `${version}-${type}.json`);
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

test('未知種別と align があっても v0 / v2 の schema と validate-edit CLI は通る', () => {
  const root = mkdtempSync(join(tmpdir(), 'akari-transition-schema-unknown-'));
  try {
    for (const [version, makeEdit] of [[0, editFor], [2, editV2For]]) {
      const edit = makeEdit('future-kind');
      assert.equal(validate(edit), true, JSON.stringify(validate.errors));
      const editPath = join(root, `${version}.json`);
      writeFileSync(editPath, `${JSON.stringify(edit)}\n`);
      const executed = spawnSync(process.execPath, [join(packageRoot, 'bin', 'validate-edit.mjs'), editPath], {
        encoding: 'utf8'
      });
      assert.equal(executed.status, 0, executed.stderr);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
