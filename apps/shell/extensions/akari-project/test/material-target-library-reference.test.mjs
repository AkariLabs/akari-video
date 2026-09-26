import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

// 文字起こし入口の materialTarget() が共有ライブラリ参照（実体がプロジェクトに無い
// 宣言済み素材）で生の ENOENT を UI へ通さないことを固定する。
// 契約: docs/contract-2026-09-02-asset-reference-model.md §2

const DECLARED = 'assets/broll/talkinghead-desk-ja-01/clip.mp4';
const assetResolverSrc = fileURLToPath(new URL('../../../../../packages/asset-resolver/src', import.meta.url));

class Service extends AkariProjectServiceImpl {
    async findAssetResolverSrcDir() { return assetResolverSrc; }
    async findMediaTool() { return 'media.mjs'; }
}

async function fixture(t, { reference = true } = {}) {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'material-target-')));
    t.after(() => rm(base, { recursive: true, force: true }));
    const root = join(base, 'project');
    const library = join(base, 'library');
    await mkdir(join(root, '.akari'), { recursive: true });
    if (reference) {
        await writeFile(join(root, '.akari/asset-references.json'),
            `${JSON.stringify({ version: 0, references: [{ id: 'talkinghead-desk-ja-01', category: 'broll' }] })}\n`);
    }
    const libraryFile = join(library, 'broll/talkinghead-desk-ja-01/clip.mp4');
    await mkdir(join(library, 'broll/talkinghead-desk-ja-01'), { recursive: true });
    await writeFile(libraryFile, 'fixture');
    const previous = process.env.AKARI_LIBRARY_ROOT;
    process.env.AKARI_LIBRARY_ROOT = library;
    t.after(() => {
        if (previous === undefined) delete process.env.AKARI_LIBRARY_ROOT;
        else process.env.AKARI_LIBRARY_ROOT = previous;
    });
    return { root, library, libraryFile, service: new Service() };
}

test('materialTarget: 共有ライブラリ参照を解決し、宣言パスと projectRoot を保つ', async t => {
    const f = await fixture(t);
    const target = await f.service.materialTarget(f.root, DECLARED);
    assert.equal(target.root, f.root);
    assert.equal(target.relativePath, DECLARED);
    assert.equal(target.path, join(f.root, DECLARED));
    assert.equal(target.actualPath, await realpath(f.libraryFile));
});

test('materialTarget: 台帳に無い参照素材は生の ENOENT を出さず日本語エラーで失敗する', async t => {
    const f = await fixture(t, { reference: false });
    await assert.rejects(f.service.materialTarget(f.root, DECLARED), error => {
        assert.equal(error.message, `素材の実体が見つかりません（共有ライブラリにも未取得です）: ${DECLARED}`);
        assert.doesNotMatch(error.message, /ENOENT/);
        return true;
    });
});

test('materialTarget: 台帳にあるが library に実体が無い参照も日本語エラーで失敗する', async t => {
    const f = await fixture(t);
    await rm(f.libraryFile);
    await assert.rejects(f.service.materialTarget(f.root, DECLARED), error => {
        assert.match(error.message, /共有ライブラリにも未取得です/);
        assert.doesNotMatch(error.message, /ENOENT/);
        return true;
    });
});

test('materialTarget: プロジェクト内に実体があるときの既存挙動を変えない', async t => {
    const f = await fixture(t);
    await mkdir(join(f.root, 'assets/broll/talkinghead-desk-ja-01'), { recursive: true });
    await writeFile(join(f.root, DECLARED), 'local');
    const target = await f.service.materialTarget(f.root, DECLARED);
    assert.equal(target.path, await realpath(join(f.root, DECLARED)));
    assert.equal(target.relativePath, DECLARED);
    assert.equal(target.actualPath, undefined);
});

test('materialTarget: プロジェクト外へ出るパスは拒否する', async t => {
    const f = await fixture(t);
    await assert.rejects(f.service.materialTarget(f.root, '../outside.mp4'), /プロジェクト内/);
});

test('transcribeMaterial: 参照素材でも CLI へ宣言パスとプロジェクト根を渡す', async t => {
    const f = await fixture(t);
    const calls = [];
    f.service.runNodeScript = async (_script, args, cwd) => {
        calls.push({ args, cwd });
        return { code: 0, stdout: '{"segments":[]}', stderr: '' };
    };
    await f.service.transcribeMaterial({ projectRoot: f.root, relativePath: DECLARED });
    assert.deepEqual(calls, [{ args: ['transcribe', DECLARED], cwd: f.root }]);
});
