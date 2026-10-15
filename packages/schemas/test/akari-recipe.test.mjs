import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateAkariRecipe } from '../validate-akari-recipe.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recipe = JSON.parse(readFileSync(path.join(root, 'test', 'fixtures', 'akari-recipes', 'music.json'), 'utf8'));

test('recipe accepts v0 and rejects unknown capability or wrong kind', () => {
  assert.equal(validateAkariRecipe(recipe).ok, true);
  assert.equal(validateAkariRecipe(JSON.parse(readFileSync(path.join(root, 'test', 'fixtures', 'akari-recipes', 'three-d.json'), 'utf8'))).ok, true);
  assert.equal(validateAkariRecipe({ ...recipe, needs: ['teleport'] }).ok, false);
  assert.equal(validateAkariRecipe({ ...recipe, kind: 'recipe' }).ok, false);
});

test('connection schema accepts optional capability and adapter declarations', () => {
  const schema = JSON.parse(readFileSync(path.join(root, 'connections.schema.json'), 'utf8'));
  const fixture = JSON.parse(readFileSync(path.join(root, 'examples', 'connections-v0-notify-valid', 'connections.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const provider = fixture.providers[0];
  provider.provides = ['publish'];
  provider.adapter = { type: 'official-api' };
  provider.terms = { checked: '2026-10-16', commercialUse: 'allowed' };
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
  provider.provides = ['teleport'];
  assert.equal(validate(fixture), false);
});

test('validator works without ajv in a standalone copy', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'akari-recipe-schema-'));
  try {
    const dir = path.join(temp, 'schemas');
    mkdirSync(dir);
    for (const name of ['validate-akari-recipe.mjs', 'akari-recipe.schema.json', 'capabilities.json']) {
      writeFileSync(path.join(dir, name), requireFile(path.join(root, name)));
    }
    const file = path.join(temp, 'recipe.json');
    writeFileSync(file, JSON.stringify(recipe));
    const run = spawnSync(process.execPath, [path.join(dir, 'validate-akari-recipe.mjs'), file], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    writeFileSync(file, JSON.stringify({ ...recipe, needs: ['teleport'] }));
    const bad = spawnSync(process.execPath, [path.join(dir, 'validate-akari-recipe.mjs'), file], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

function requireFile(file) { return readFileSync(file); }
