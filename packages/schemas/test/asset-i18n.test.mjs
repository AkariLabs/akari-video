import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../asset-meta.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/asset-i18n/${name}.json`, import.meta.url), 'utf8'));
const baseDir = new URL('./fixtures/asset/valid-library/overlay/lower-third-clean/', import.meta.url);
const cli = fileURLToPath(new URL('../bin/validate-asset.mjs', import.meta.url));

test('asset translations validate with matching knob keys', t => {
    const root = mkdtempSync(join(tmpdir(), 'asset-i18n-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const dir = join(root, 'overlay', 'lower-third-clean');
    cpSync(baseDir, dir, { recursive: true });
    for (const [name, expected] of [['valid', 0], ['invalid-ja', 1], ['invalid-field', 1],
        ['invalid-knob', 1], ['invalid-type', 1]]) {
        const meta = fixture(name);
        assert.equal(validate(meta), name === 'invalid-knob' || expected === 0, name);
        writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
        const result = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8' });
        assert.equal(result.status, expected, `${name}: ${result.stderr}`);
    }
});

test('group translations accept declared groups and reject unknown groups', t => {
    const meta = fixture('valid');
    const group = meta.knobs.find(knob => knob.group)?.group;
    assert.ok(group);
    meta.i18n.en.groups = { [group]: 'Controls' };
    assert.equal(validate(meta), true, JSON.stringify(validate.errors));
    const root = mkdtempSync(join(tmpdir(), 'asset-groups-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const dir = join(root, 'overlay', 'lower-third-clean');
    cpSync(baseDir, dir, { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
    assert.equal(spawnSync(process.execPath, [cli, dir], { encoding: 'utf8' }).status, 0);
    meta.i18n.en.groups = { missing: 'Missing' };
    assert.equal(validate(meta), true); // The schema validates shape; the CLI checks references.
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
    assert.equal(spawnSync(process.execPath, [cli, dir], { encoding: 'utf8' }).status, 1);
});
