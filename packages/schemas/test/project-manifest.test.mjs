import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateProjectManifest } from '../bin/validate-project-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.schema.json')));
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
const fixture = name => JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'project-manifest', name, 'manifest.json')));

for (const [name, code] of [['valid', null], ['missing', 'MISSING_NODE'], ['cycle', 'CYCLE'], ['dotdot', 'SCHEMA']]) {
  test(`project manifest ${name}`, () => {
    const value = fixture(name);
    const errors = validateProjectManifest(value);
    assert.equal(errors.some(error => error.code === code), Boolean(code), JSON.stringify(errors));
    assert.equal(validate(value), name !== 'dotdot');
    const cli = spawnSync(process.execPath, [path.join(root, 'bin', 'validate-project-manifest.mjs'), path.join(root, 'test', 'fixtures', 'project-manifest', name, 'manifest.json'), '--json'], { encoding: 'utf8' });
    assert.equal(cli.status, code ? 1 : 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).ok, !code);
  });
}

test('unknown node kind and fields remain valid while required fields fail', () => {
  const value = fixture('valid');
  value.nodes.push({ id: 'future:x', kind: 'future-kind', rev: 0, extra: { nested: true } });
  assert.equal(validate(value), true);
  delete value.nodes[0].rev;
  assert.equal(validate(value), false);
});

test('known kinds require their id prefixes and where cannot traverse before a fragment', () => {
  const value = fixture('valid');
  value.nodes[1].id = 'person:w';
  assert.equal(validate(value), false);
  value.nodes[1].id = 'world:w';
  value.nodes[1].where = 'world/..#w';
  assert.equal(validate(value), false);
  value.nodes[1].where = 'world/a..b';
  assert.equal(validate(value), false);
});
