import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ajv = new Ajv2020({ strict: false });
const load = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

test('language-bearing intake and transcript fixtures validate', () => {
  const intake = load('test/fixtures/content-language/intake.json');
  const analysis = load('test/fixtures/content-language/analysis.json');
  const validateIntake = ajv.compile(load('intake.schema.json'));
  const validateAnalysis = ajv.compile(load('analysis.schema.json'));
  assert.equal(validateIntake(intake), true, JSON.stringify(validateIntake.errors));
  assert.equal(validateAnalysis(analysis), true, JSON.stringify(validateAnalysis.errors));
  assert.equal(validateIntake({ ...intake, language: 'en_US' }), false);
  assert.equal(validateAnalysis({ ...analysis, transcript_language: 'en_US' }), false);
  assert.equal(validateAnalysis({ ...analysis, transcript: { language: 'en', segments: [] } }), false);
  const { transcript_language: _language, ...legacyAnalysis } = analysis;
  assert.equal(validateAnalysis(legacyAnalysis), true, JSON.stringify(validateAnalysis.errors));
});

test('validate-intake CLI accepts language and rejects an invalid tag', () => {
  const cli = join(root, 'bin/validate-intake.mjs');
  const fixture = join(root, 'test/fixtures/content-language/intake.json');
  const valid = spawnSync(process.execPath, [cli, fixture], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);

  const directory = mkdtempSync(join(tmpdir(), 'intake-language-'));
  try {
    const invalidFile = join(directory, 'intake.json');
    writeFileSync(invalidFile, JSON.stringify({ ...load('test/fixtures/content-language/intake.json'), language: 'en_US' }));
    const invalid = spawnSync(process.execPath, [cli, invalidFile], { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /language/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
