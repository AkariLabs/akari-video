import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sample = path.resolve(root, '../project-scaffold/test/fixtures/playbook-sample');
const schema = JSON.parse(readFileSync(path.join(root, 'kit-manifest.schema.json'), 'utf8'));
const validate = new Ajv2020({ strict: false }).compile(schema);

test('kit playbooks validate contents, matching id, and safe directory', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'akari-kit-playbook-'));
  const id = 'test-playbook';
  const dir = path.join(temp, 'playbooks', id);
  const manifest = { schemaVersion: 1, id: 'test-kit', kind: 'kit', name: 'Test', version: 1,
    requires: { cli: '>=1.4.0' }, license: 'CC0-1.0', playbooks: [{ dir: `playbooks/${id}` }] };
  const run = () => spawnSync(process.execPath, [path.join(root, 'bin', 'validate-kit-manifest.mjs'), temp], { encoding: 'utf8' });
  try {
    mkdirSync(dir, { recursive: true });
    cpSync(path.join(sample, 'playbook.md'), path.join(dir, 'playbook.md'));
    const playbook = JSON.parse(readFileSync(path.join(sample, 'playbook.json'), 'utf8'));
    playbook.id = id;
    const save = () => writeFileSync(path.join(dir, 'playbook.json'), JSON.stringify(playbook));
    const saveManifest = () => writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify(manifest));
    save(); saveManifest();
    writeFileSync(path.join(temp, 'README.md'), '# Test\n');
    writeFileSync(path.join(temp, 'LICENSE.md'), '# CC0\n');
    assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
    assert.equal(run().status, 0, run().stderr);
    playbook.id = 'different'; save();
    assert.match(run().stderr, /id がフォルダ名と一致しません/);
    playbook.id = id; playbook.kind = 'wrong'; save();
    assert.match(run().stderr, /validate-playbook に失敗/);
    manifest.playbooks[0].dir = '../outside'; saveManifest();
    assert.equal(validate(manifest), false);
    assert.match(run().stderr, /playbooks\[0\]\.dir/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
