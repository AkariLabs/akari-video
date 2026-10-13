import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { AkariProjectServiceImpl, ensureVoicesReadDenied, GENERATED_EDIT_ALLOW, VOICES_READ_DENY } from '../lib/node/akari-project-service.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const lane = join(root, '.tmp-lane');
const template = join(root, 'templates', 'project-default', '.claude', 'settings.json');

test('既存の設定に不足した拒否だけを末尾へ足す', () => {
    const before = { permissions: { allow: ['Read(./notes/**)'], deny: ['Edit(./media/**)'] }, custom: 1 };
    const first = ensureVoicesReadDenied(JSON.stringify(before));
    assert.equal(first.changed, true);
    const after = JSON.parse(first.text);
    assert.deepEqual(after.permissions.allow, before.permissions.allow);
    assert.deepEqual(after.permissions.deny, ['Edit(./media/**)', ...VOICES_READ_DENY]);
    assert.equal(after.custom, 1);
    assert.deepEqual(ensureVoicesReadDenied(first.text), { changed: false });
    assert.deepEqual(JSON.parse(ensureVoicesReadDenied('{}').text).permissions.deny,
        [...VOICES_READ_DENY]);
    assert.deepEqual(JSON.parse(ensureVoicesReadDenied('{"permissions":{}}').text).permissions.deny,
        [...VOICES_READ_DENY]);
});

test('旧雛形の assets 丸ごとの編集拒否を外し、生成物の置き場を許可する', () => {
    for (const legacy of ['Edit(/assets/**)', 'Edit(./assets/**)']) {
        const before = { permissions: { allow: ['Read(./**)'], deny: [legacy, 'Edit(./assets/raw/**)', ...VOICES_READ_DENY] } };
        const first = ensureVoicesReadDenied(JSON.stringify(before));
        assert.equal(first.changed, true);
        const after = JSON.parse(first.text);
        assert.deepEqual(after.permissions.deny, ['Edit(./assets/raw/**)', ...VOICES_READ_DENY]);
        assert.deepEqual(after.permissions.allow, ['Read(./**)', GENERATED_EDIT_ALLOW]);
        assert.deepEqual(ensureVoicesReadDenied(first.text), { changed: false });
    }
    assert.deepEqual(JSON.parse(ensureVoicesReadDenied('{"permissions":{"deny":["Edit(/assets/**)"]}}').text).permissions.allow,
        [GENERATED_EDIT_ALLOW]);
});

test('雛形は assets/ を拒否せず、生成物の置き場を許可する', () => {
    const settings = JSON.parse(ensureVoicesReadDenied(undefined).text);
    assert.ok(settings.permissions.allow.includes(GENERATED_EDIT_ALLOW));
    assert.ok(!settings.permissions.deny.some(rule => rule.includes('assets')));
});

test('壊れた設定は変えず、ファイル無しは雛形と同じ設定を作る', async () => {
    for (const raw of ['{', '[]', '{"permissions":[]}', '{"permissions":{"deny":{}}}']) {
        const result = ensureVoicesReadDenied(raw);
        assert.equal(result.changed, false);
        assert.equal(typeof result.error, 'string');
        assert.equal(result.text, undefined);
    }
    assert.equal(ensureVoicesReadDenied(undefined).text, await readFile(template, 'utf8'));
});

test('サービスは既存設定を直し、壊れた JSON は保持する', async t => {
    await mkdir(lane, { recursive: true });
    const project = await mkdtemp(join(lane, 'voices-settings-'));
    t.after(() => rm(project, { recursive: true, force: true }));
    const file = join(project, '.claude', 'settings.json');
    await mkdir(dirname(file));
    await writeFile(file, '{"permissions":{"deny":["Edit(/assets/**)"]}}');
    const service = new AkariProjectServiceImpl();
    await service.ensureProjectAgentSettings(project);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).permissions.deny, [...VOICES_READ_DENY]);
    await writeFile(file, '{');
    const warning = console.warn;
    console.warn = () => {};
    try { await service.ensureProjectAgentSettings(project); }
    finally { console.warn = warning; }
    assert.equal(await readFile(file, 'utf8'), '{');
});
