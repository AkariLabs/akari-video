import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

import {
    loadSkillRenames,
    parseSkillRenameTable,
    resolveSkillName,
    validateSkillRenames
} from '../skill-renames.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '..', '..');
const schema = JSON.parse(await readFile(join(packageRoot, 'skill-renames.schema.json'), 'utf8'));
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);

async function withSkills(callback, names) {
    const root = await mkdtemp(join(tmpdir(), 'akari-skill-renames-'));
    try {
        for (const name of names) {
            await mkdir(join(root, name), { recursive: true });
            await writeFile(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n`, 'utf8');
        }
        return await callback(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

test('schema の $id は他の schema と同じ urn 形式', () => {
    assert.equal(schema.$id, 'urn:akari-video:schema:skill-renames:v1');
});

test('実リポの skills/renames.json は schema と参照整合の両方を通る', async () => {
    const table = loadSkillRenames(join(repoRoot, 'skills'));
    assert.equal(table.version, 1);
    assert.ok(table.renames.length >= 1, '改名が入ったら表に 1 行以上ある');
    assert.ok(table.renames.every(row => row.from !== row.to));
    assert.deepEqual(
        table.renames.filter(row => row.from === 'bake-3d'),
        [{ from: 'bake-3d', to: 'author-scene3d', since: '1.5.2' }]
    );
    assert.equal(validate(table), true);
    assert.deepEqual(validateSkillRenames(table, { skillsRoot: join(repoRoot, 'skills') }), { ok: true, errors: [] });
});

test('schema は version 1 と from / to / since 以外のキーを拒否する', () => {
    assert.equal(validate({ version: 2, renames: [] }), false);
    assert.equal(validate({ version: 1, renames: [{ from: 'old-name', to: 'new-name' }] }), false);
    assert.equal(validate({ version: 1, renames: [{ from: 'old-name', to: 'new-name', since: 'v1.6.0', extra: true }] }), false);
    assert.equal(validate({ version: 1, renames: [{ from: 'old-name', to: 'new-name', since: 'v1.6.0' }] }), true);
});

test('from の重複・to の不在・from の残存を拒否する', async () => {
    await withSkills(async skillsRoot => {
        const duplicate = {
            version: 1,
            renames: [
                { from: 'old-name', to: 'new-name', since: 'v1.6.0' },
                { from: 'old-name', to: 'other-name', since: 'v1.6.1' }
            ]
        };
        assert.match(validateSkillRenames(duplicate, { skillsRoot }).errors.join('\n'), /duplicates old-name/);

        const missingTarget = { version: 1, renames: [{ from: 'old-name', to: 'ghost', since: 'v1.6.0' }] };
        assert.match(validateSkillRenames(missingTarget, { skillsRoot }).errors.join('\n'), /has no skills\/ghost\/SKILL\.md/);

        await mkdir(join(skillsRoot, 'old-name'), { recursive: true });
        await writeFile(join(skillsRoot, 'old-name', 'SKILL.md'), '---\nname: old-name\n---\n', 'utf8');
        const stillExists = { version: 1, renames: [{ from: 'old-name', to: 'new-name', since: 'v1.6.0' }] };
        assert.match(validateSkillRenames(stillExists, { skillsRoot }).errors.join('\n'), /still exists as skills\/old-name\/SKILL\.md/);
    }, ['new-name', 'other-name']);
});

test('連鎖 a → b → c は c に畳め、表としても受理される', async () => {
    await withSkills(async skillsRoot => {
        const table = {
            version: 1,
            renames: [
                { from: 'old-a', to: 'old-b', since: 'v1.6.0' },
                { from: 'old-b', to: 'new-c', since: 'v1.6.1' }
            ]
        };
        assert.equal(resolveSkillName(table.renames, 'old-a'), 'new-c');
        assert.equal(resolveSkillName(table.renames, 'old-b'), 'new-c');
        assert.deepEqual(validateSkillRenames(table, { skillsRoot }), { ok: true, errors: [] });
    }, ['new-c']);
});

test('循環する連鎖は拒否する', async () => {
    await withSkills(async skillsRoot => {
        const table = {
            version: 1,
            renames: [
                { from: 'old-a', to: 'old-b', since: 'v1.6.0' },
                { from: 'old-b', to: 'old-a', since: 'v1.6.1' }
            ]
        };
        const result = validateSkillRenames(table, { skillsRoot });
        assert.equal(result.ok, false);
        assert.match(result.errors.join('\n'), /cycle/);
    }, []);
});

test('parse は schema 違反の表を読まない', () => {
    assert.deepEqual(parseSkillRenameTable('{"version":1,"renames":[]}').renames, []);
    assert.throws(() => parseSkillRenameTable('{"version":1,"renames":[{"from":"a"}]}'), /invalid skill rename table/);
    assert.throws(() => parseSkillRenameTable('not json'), SyntaxError);
});
