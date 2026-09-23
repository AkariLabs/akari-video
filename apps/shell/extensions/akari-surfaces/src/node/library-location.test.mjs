import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCreatorRoot, changeAssetLibraryLocation, migrateAssetLibrary,
    readLibraryLocation, resolveAssetLibraryRoots } from '../../../../../../packages/creator-root/src/index.mjs';

async function fixture(t) {
    const temp = await fs.mkdtemp(path.join(tmpdir(), 'akari-surfaces-library-'));
    t.after(() => fs.rm(temp, { recursive: true, force: true }));
    const env = { HOME: temp, AKARI_HOME: path.join(temp, 'akari-home'), AKARI_CREATOR_ROOT: path.join(temp, 'creator') };
    await createCreatorRoot(env.AKARI_CREATOR_ROOT);
    const old = path.join(env.AKARI_HOME, 'assets');
    await fs.mkdir(path.join(old, 'audio', 'theme'), { recursive: true });
    await fs.writeFile(path.join(old, 'audio', 'theme', 'sound.wav'), 'sound');
    return { temp, env, old };
}

test('場所を変えると library-location.json に書き、素材を同じ移行処理で動かす', async t => {
    const { temp, env } = await fixture(t);
    const destination = path.join(temp, 'other-library');
    assert.equal((await changeAssetLibraryLocation(destination, { env })).state, 'done');
    assert.equal(readLibraryLocation(env).root, destination);
    assert.equal(resolveAssetLibraryRoots(env).write, destination);
    assert.equal(await fs.readFile(path.join(destination, 'audio', 'theme', 'sound.wav'), 'utf8'), 'sound');
});

test('同期フォルダでは pending の間は元の置き場に書き、同意まで移さない', async t => {
    const { temp, env, old } = await fixture(t);
    const destination = path.join(temp, 'OneDrive', 'library');
    const result = await changeAssetLibraryLocation(destination, { env });
    assert.equal(result.state, 'pending');
    assert.equal(readLibraryLocation(env).state, 'pending');
    assert.equal(resolveAssetLibraryRoots(env).write, old);
    assert.equal(await fs.readFile(path.join(old, 'audio', 'theme', 'sound.wav'), 'utf8'), 'sound');
    assert.equal((await migrateAssetLibrary({ env, allowCloud: true })).state, 'done');
    assert.equal(resolveAssetLibraryRoots(env).write, destination);
});

test('環境指定した置き場も一時ディレクトリだけを使う', async t => {
    const { temp, env } = await fixture(t);
    const override = path.join(temp, 'override-library');
    assert.equal(resolveAssetLibraryRoots({ ...env, AKARI_LIBRARY_ROOT: override }).write, override);
});
