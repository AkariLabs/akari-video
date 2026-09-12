import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(packageRoot, 'bin', 'validate-edit.mjs');
const exampleRoot = join(packageRoot, 'examples');

function runPatchedExample(example, mutator, schemaOnly = false) {
    const directory = mkdtempSync(join(tmpdir(), 'akari-edit-cut-reason-'));
    const value = JSON.parse(readFileSync(join(exampleRoot, example, 'edit.json'), 'utf8'));
    mutator(value);
    const path = join(directory, 'edit.json');
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    if (!schemaOnly) return spawnSync(process.execPath, [cliPath, path], { encoding: 'utf8' });
    const script = `
        import Ajv2020 from 'ajv/dist/2020.js';
        import { readFileSync } from 'node:fs';
        const schema = JSON.parse(readFileSync(${JSON.stringify(join(packageRoot, 'edit.schema.json'))}, 'utf8'));
        const value = JSON.parse(readFileSync(process.argv[1], 'utf8'));
        const validate = new Ajv2020({ strict: false }).compile(schema);
        const valid = validate(value);
        if (!valid) console.error(JSON.stringify(validate.errors));
        process.exit(valid ? 0 : 1);
    `;
    return spawnSync(process.execPath, ['--input-type=module', '-e', script, path], {
        cwd: packageRoot, encoding: 'utf8'
    });
}

test('v0 の cut に無音の由来とラベルを付けられる', () => {
    const executed = runPatchedExample('edit-v0-sample', value => {
        Object.assign(value.cuts[0], { reason: 'silence', label: '無音' });
    });
    assert.equal(executed.status, 0, executed.stderr);
});

test('v1 の cut に語の由来とラベルを付けられる', () => {
    const executed = runPatchedExample('edit-v1-sample', value => {
        Object.assign(value.cuts[0], { reason: 'word', label: 'こんにちは' });
    });
    assert.equal(executed.status, 0, executed.stderr);
});

test('スキーマ runner は既知の由来を受理する', () => {
    const executed = runPatchedExample('edit-v1-sample', value => {
        value.cuts[0].reason = 'silence';
    }, true);
    assert.equal(executed.status, 0, executed.stderr);
});

test('cut の未知の由来は拒否する', () => {
    const executed = runPatchedExample('edit-v1-sample', value => {
        value.cuts[0].reason = 'bogus';
    }, true);
    assert.notEqual(executed.status, 0, executed.stdout);
    assert.match(executed.stderr, /"keyword":"enum"/u);
});

test('v2 media item の由来とラベルを schema / 手書き validator が受理する', () => {
    const executed = runPatchedExample('edit-v2-valid', value => {
        Object.assign(value.tracks[3].items[0], { reason: 'word', label: '言い直し' });
    });
    assert.equal(executed.status, 0, executed.stderr);
});

test('v2 media item の未知の由来を schema / 手書き validator が拒否する', () => {
    const schema = runPatchedExample('edit-v2-valid', value => {
        value.tracks[3].items[0].reason = 'bogus';
    }, true);
    assert.notEqual(schema.status, 0);
    const cli = runPatchedExample('edit-v2-valid', value => {
        value.tracks[3].items[0].reason = 'bogus';
    });
    assert.notEqual(cli.status, 0);
    assert.match(cli.stderr, /reason は silence\/word/u);
});
