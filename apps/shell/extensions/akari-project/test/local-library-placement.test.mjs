import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

const resolverSrc = fileURLToPath(new URL('../../../../../packages/asset-resolver/src/', import.meta.url));
class Service extends AkariProjectServiceImpl {
    async findAssetResolverSrcDir() { return resolverSrc; }
}
async function fixture(t) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'akari-local-placement-')));
    const overrides = { AKARI_HOME: join(root, 'home'), AKARI_LIBRARY_ROOT: join(root, 'library'), AKARI_CREATOR_ROOT: join(root, 'creator') };
    const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    Object.assign(process.env, overrides);
    t.after(async () => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        await rm(root, { recursive: true, force: true });
    });
    const source = { category: 'audio', id: 'sample', libraryDir: join(overrides.AKARI_LIBRARY_ROOT, 'audio', 'sample') };
    const project = join(root, 'project');
    const destination = join(project, 'assets', 'audio', 'sample');
    await mkdir(source.libraryDir, { recursive: true });
    await writeFile(join(source.libraryDir, 'sound.wav'), 'original media');
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'sentinel.txt'), 'previous project asset');
    return { root, source, project, destination, service: new Service(), projectUri: pathToFileURL(project).href, env: overrides };
}
async function assertRejected(f, source) {
    const result = await f.service.placeLibraryAsset(source, f.projectUri);
    assert.equal(result.success, false, JSON.stringify(result));
    assert.ok(result.error);
    assert.equal(await readFile(join(f.destination, 'sentinel.txt'), 'utf8'), 'previous project asset');
    assert.equal(await readFile(join(f.source.libraryDir, 'sound.wav'), 'utf8'), 'original media');
}

test('実子プロセスで置き場を検証し、assets/category/idへコピー（大元は維持）', async t => {
    const f = await fixture(t);
    const result = await f.service.placeLibraryAsset(f.source, f.projectUri);
    assert.deepEqual(result, { success: true, projectAssetPath: f.destination });
    assert.equal(await readFile(join(f.destination, 'sound.wav'), 'utf8'), 'original media');
    assert.equal(await readFile(join(f.source.libraryDir, 'sound.wav'), 'utf8'), 'original media');
    await assert.rejects(readFile(join(f.destination, 'sentinel.txt')), { code: 'ENOENT' });
});

test('移行前の置き場も resolver の read roots に従ってコピーできる', async t => {
    const f = await fixture(t);
    const legacy = join(f.env.AKARI_HOME, 'assets', 'audio', 'sample');
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'legacy.wav'), 'legacy');
    assert.equal((await f.service.placeLibraryAsset({ ...f.source, libraryDir: legacy }, f.projectUri)).success, true);
    assert.equal(await readFile(join(f.destination, 'legacy.wav'), 'utf8'), 'legacy');
});

for (const id of ['..', '../sample', 'nested/sample', 'nested\\sample', 'a..b', '.', '']) {
    test(`不正なid ${JSON.stringify(id)} をコピー前に拒否する`, async t => {
        const f = await fixture(t);
        await assertRejected(f, { ...f.source, id });
    });
}
for (const [label, changes] of [
    ['basename不一致', { id: 'different' }], ['親カテゴリ不一致', { category: 'still' }],
    ['カテゴリのパス逸脱', { category: '../audio' }], ['相対パス', { libraryDir: 'audio/sample' }]
]) {
    test(`${label}を拒否する`, async t => {
        const f = await fixture(t);
        await assertRejected(f, { ...f.source, ...changes });
    });
}

test('置き場と同じ接頭辞の外部フォルダを拒否する', async t => {
    const f = await fixture(t), outside = join(f.root, 'library-outside', 'audio', 'sample');
    await mkdir(outside, { recursive: true });
    await assertRejected(f, { ...f.source, libraryDir: outside });
});

test('置き場内に見える外部へのsymlinkもrealpathで拒否する', async t => {
    const f = await fixture(t), outside = join(f.root, 'outside', 'audio', 'escaped');
    await mkdir(outside, { recursive: true });
    const link = join(f.root, 'library', 'audio', 'escaped');
    await symlink(outside, link, 'dir');
    await assertRejected(f, { category: 'audio', id: 'escaped', libraryDir: link });
});

test('配置先assetsが外を向くsymlinkなら外部もプロジェクトも変更しない', async t => {
    const f = await fixture(t), outside = join(f.root, 'external-project-assets');
    await mkdir(outside, { recursive: true });
    const project = join(f.root, 'linked-project');
    await mkdir(project);
    await symlink(outside, join(project, 'assets'), 'dir');
    const result = await f.service.placeLibraryAsset(f.source, pathToFileURL(project).href);
    assert.equal(result.success, false);
    assert.match(result.error, /プロジェクトの外/);
    await assert.rejects(readFile(join(outside, 'audio', 'sample', 'sound.wav')), { code: 'ENOENT' });
});

test('配置先が大元と同じならコピー関数の削除処理へ渡さない', async t => {
    const f = await fixture(t);
    // project/assets → library として、大元が配置先になる条件を作る。
    const project = join(f.root, 'same-project');
    await mkdir(project);
    // library が project 内にある場合でも、同じ素材を消さない。
    const ownLibrary = join(project, 'library');
    const sourceDir = join(ownLibrary, 'audio', 'sample');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'sound.wav'), 'keep');
    process.env.AKARI_LIBRARY_ROOT = ownLibrary;
    await symlink(ownLibrary, join(project, 'assets'), 'dir');
    const result = await f.service.placeLibraryAsset({ ...f.source, libraryDir: sourceDir }, pathToFileURL(project).href);
    assert.equal(result.success, false);
    assert.match(result.error, /大元/);
    assert.equal(await readFile(join(sourceDir, 'sound.wav'), 'utf8'), 'keep');
});

test('リンク経由で開いたプロジェクトもwidgetが相対化できるパスを返す', async t => {
    const f = await fixture(t), alias = join(f.root, 'project-alias');
    await symlink(f.project, alias, 'dir');
    const result = await f.service.placeLibraryAsset(f.source, pathToFileURL(alias).href);
    assert.deepEqual(result, { success: true, projectAssetPath: join(alias, 'assets', 'audio', 'sample') });
    assert.equal(await readFile(join(result.projectAssetPath, 'sound.wav'), 'utf8'), 'original media');
});

test('素材の大元の中へ再帰コピーする配置を拒否する', async t => {
    const f = await fixture(t), nestedProject = join(f.source.libraryDir, 'project');
    await mkdir(nestedProject);
    const result = await f.service.placeLibraryAsset(f.source, pathToFileURL(nestedProject).href);
    assert.equal(result.success, false);
    assert.match(result.error, /大元/);
    assert.equal(await readFile(join(f.source.libraryDir, 'sound.wav'), 'utf8'), 'original media');
});
