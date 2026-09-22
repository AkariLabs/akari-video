import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recordProjectReference } from '../../../../../packages/asset-resolver/src/project-references.mjs';
import { resolveProjectAssetPath, projectReferenceMediaUris, listProjectReferenceAssets } from '../../../../../packages/asset-resolver/src/shell-reference.mjs';
import { assetResolveOutcome, referencePresentation, restrictedReferenceCount } from '../lib/common/project-asset-reference.js';
import { buildMaterialContextMenuItems } from '../lib/common/material-context-menu-items.js';

async function fixture(t) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'reference-shell-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, 'project'), library = join(root, 'library'), home = join(root, 'home');
    const env = { AKARI_HOME: home, AKARI_LIBRARY_ROOT: library, AKARI_CREATOR_ROOT: join(root, 'creator') };
    await mkdir(project);
    const put = async (base, name, value = 'media') => { const p = join(base, name); await mkdir(join(p, '..'), { recursive: true }); await writeFile(p, value); return p; };
    return { root, project, library, home, env, put, declared: 'assets/audio/sample/sound.wav' };
}

test('戻り型: 参照・既存コピー・失敗の全枝', () => {
    assert.deepEqual(assetResolveOutcome({ success: true, referenced: true, dir: '/library/audio/x' }, '/project/assets/audio/x'),
        { success: true, reference: true, libraryDir: '/library/audio/x', projectAssetPath: '/project/assets/audio/x' });
    assert.deepEqual(assetResolveOutcome({ success: true, projectDir: '/old' }, '/unused'), { success: true, projectAssetPath: '/old' });
    assert.equal(assetResolveOutcome({ success: true }, '/unused').success, false);
    assert.deepEqual(assetResolveOutcome({ success: false, error: 'offline' }, '/unused'), { success: false, error: 'offline' });
});

test('node 解決: 実体が勝つ・台帳なしは解決しない・2 か所の置き場は新しい順', async t => {
    const f = await fixture(t);
    const newer = await f.put(f.library, 'audio/sample/sound.wav', 'new');
    const older = await f.put(join(f.home, 'assets'), 'audio/sample/sound.wav', 'old');
    assert.equal(await resolveProjectAssetPath(f.project, f.declared, f.env), null);
    await recordProjectReference(f.project, { category: 'audio', id: 'sample' });
    assert.equal(await resolveProjectAssetPath(f.project, f.declared, f.env), newer);
    await rm(newer);
    assert.equal(await resolveProjectAssetPath(f.project, f.declared, f.env), older);
    const local = await f.put(f.project, f.declared, 'copy-era');
    assert.equal(await resolveProjectAssetPath(f.project, f.declared, f.env), local);
    assert.equal((await projectReferenceMediaUris(f.project, f.env))[f.declared], pathToFileURL(local).href);
});

test('node 解決: 字句・ライブラリとプロジェクトの symlink 脱出を拒否', async t => {
    const f = await fixture(t);
    await recordProjectReference(f.project, { category: 'audio', id: 'sample' });
    const outside = await f.put(f.root, 'outside.wav');
    await mkdir(join(f.library, 'audio/sample'), { recursive: true });
    await symlink(outside, join(f.library, 'audio/sample/sound.wav'));
    assert.equal(await resolveProjectAssetPath(f.project, f.declared, f.env), null);
    await assert.rejects(resolveProjectAssetPath(f.project, 'assets/audio/sample/../../../outside.wav', f.env), /外/);
    await mkdir(join(f.project, 'assets/audio/sample'), { recursive: true });
    await symlink(outside, join(f.project, f.declared));
    await assert.rejects(resolveProjectAssetPath(f.project, f.declared, f.env), /外/);
    await rm(join(f.project, 'assets'), { recursive: true });
    await symlink(f.library, join(f.project, 'assets'));
    await assert.rejects(resolveProjectAssetPath(f.project, 'assets/audio/sample/absent.wav', f.env), /外/);
});

test('台帳は取得済みと見つからない参照の両方をカード入力へ返す', async t => {
    const f = await fixture(t);
    await recordProjectReference(f.project, { category: 'audio', id: 'sample' });
    await recordProjectReference(f.project, { category: 'still', id: 'missing' });
    await f.put(f.library, 'audio/sample/sound.wav');
    const entries = await listProjectReferenceAssets(f.project, f.env);
    assert.equal(entries.length, 2);
    assert.equal(referencePresentation(entries[0]).badge, '参照');
    assert.equal(referencePresentation(entries[1]).badge, '見つかりません');
    assert.equal(referencePresentation(entries[1]).recovery, '入れ直してください');
    assert.equal(referencePresentation(entries[1], true).recovery, 'もう一度取得');
});

test('参照メニューはライブラリと台帳から外すだけ', () => {
    assert.deepEqual(buildMaterialContextMenuItems('material', true, { reference: true, assetGroup: true, materialKind: 'audio' }).map(item => item.label),
        ['ライブラリで見る', 'このプロジェクトから外す']);
});

test('まとめる前の警告件数は own/site/subscription の和集合（重複なし）', () => {
    const entry = tags => ({ category: 'audio', id: 'sample', tags, files: [] });
    assert.equal(restrictedReferenceCount([
        entry([]), entry(['origin:own']), entry(['origin:site', 'license:subscription']), entry(['license:subscription']),
        { ...entry([]), sourceKind: 'own' }, { ...entry([]), sourceKind: 'lab' }
    ]), 4);
});
