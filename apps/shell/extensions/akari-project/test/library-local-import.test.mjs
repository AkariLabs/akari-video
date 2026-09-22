import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planAdd, applyAdd } from '../../../../../packages/asset-resolver/src/add.mjs';
import { libraryImportGroups } from '../lib/common/library-import.js';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';
import { buildMaterialContextMenuItems } from '../lib/common/material-context-menu-items.js';
const src = fileURLToPath(new URL('../../../../../packages/asset-resolver/src/', import.meta.url));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'shell-library-import-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const env = { ...process.env, HOME: root, AKARI_HOME: join(root, 'home'), AKARI_CREATOR_ROOT: join(root, 'creator'), AKARI_LIBRARY_ROOT: join(root, 'library'), AKARI_ASSETS_CATALOG: join(root, 'missing.json') };
    const input = join(root, 'input'); await mkdir(input);
    const file = async (name, content = name) => { const path = join(input, name); await writeFile(path, content); return path; };
    class Service extends AkariProjectServiceImpl {
        async findAssetResolverSrcDir() { return src; }
        async runResolverScript(script, input) {
            return new Promise((resolveResult, reject) => {
                const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env });
                let stdout = '', stderr = '';
                child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
                child.on('error', reject); child.on('close', code => resolveResult({ code, stdout, stderr }));
                child.stdin.end(input);
            });
        }
    }
    return { root, input, env, file, service: new Service() };
}

test('resolver の全形式と rejected をシート用のグループに変換（再分類なし）', async t => {
    const f = await fixture(t);
    const extensions = { sfx: 'mp3 wav m4a aac flac ogg aif aiff', still: 'png jpg jpeg webp gif svg', broll: 'mp4 mov webm m4v', font: 'ttf otf woff woff2', scene3d: 'glb gltf' };
    for (const values of Object.values(extensions)) for (const ext of values.split(' ')) await f.file(`one.${ext}`);
    for (const name of ['grade.cube', 'text.docx']) await f.file(name);
    const plan = await planAdd([f.input], { env: f.env, probe: () => 0.8 });
    const groups = libraryImportGroups(plan);
    for (const [kind, values] of Object.entries(extensions)) assert.equal(groups.find(group => group.kind === kind).items.length, values.split(' ').length);
    assert.equal(plan.rejected.length, 2);
    assert.match(plan.rejected.find(item => item.name === 'grade.cube').reason, /presets/);
    assert.ok(plan.items.every(item => item.folder === 'input'));
});

for (const [seconds, kind, ambiguous] of [[9.9, 'sfx', false], [10, 'sfx', true], [29.9, 'sfx', true], [30, 'bgm', false]]) {
    test(`尺 ${seconds} 秒の機械層結果をそのまま扱う`, async t => {
        const f = await fixture(t);
        const plan = await planAdd([await f.file('sound.wav')], { env: f.env, probe: () => seconds });
        assert.deepEqual([plan.items[0].kind, plan.items[0].ambiguous], [kind, ambiguous]);
        assert.equal(libraryImportGroups(plan).length, ambiguous ? 0 : 1);
    });
}

test('サイズ推定の ambiguous は常時展開対象、壊れた音は rejected', async t => {
    const f = await fixture(t);
    for (const [bytes, kind, ambiguous] of [[1199999, 'sfx', false], [1200000, 'sfx', true], [4000000, 'sfx', true], [4000001, 'bgm', false]]) {
        const source = await f.file(`${bytes}.wav`, Buffer.alloc(bytes));
        const plan = await planAdd([source], { env: f.env, probe: () => null });
        assert.deepEqual([plan.items[0].kind, plan.items[0].ambiguous, plan.items[0].durationSource], [kind, ambiguous, 'size']);
    }
    const plan = await planAdd([await f.file('bad.wav')], { env: f.env, probe: () => { throw Error('壊れた音'); } });
    assert.match(plan.rejected[0].reason, /壊れた音/);
});

test('service → apply: 元ファイル不変、meta 検証、folder/pack/credit、duplicate の既存タイトル', async t => {
    const f = await fixture(t);
    const source = await f.file('image.png', png);
    const plan = await f.service.planLibraryImport([f.input]);
    plan.pack = { id: 'my-pack', title: '私のセット' }; plan.credit = '作者 A';
    const result = await f.service.applyLibraryImport(plan);
    assert.equal(result.failures.length, 0); assert.equal(result.added.length, 1);
    const directory = result.added[0].libraryDir;
    const meta = JSON.parse(await readFile(join(directory, 'meta.json'), 'utf8'));
    for (const tag of ['origin:own', 'folder:input', 'pack:my-pack']) assert.ok(meta.tags.includes(tag));
    assert.equal(meta.license.scope, 'private-owned'); assert.equal(meta.license.ai_training_allowed, false);
    assert.equal(meta.license.attribution_required, true); assert.equal(meta.price, 0);
    assert.equal((await readFile(join(directory, 'CREDIT.txt'), 'utf8')).trim(), '作者 A');
    assert.deepEqual(await readFile(source), png);
    assert.deepEqual(await readdir(f.input), ['image.png']);
    const repeated = await f.service.planLibraryImport([source]);
    assert.equal(repeated.items.length, 0); assert.equal(repeated.duplicates[0].title, 'image');
    assert.equal(repeated.duplicates[0].id, result.added[0].id);
    assert.equal((await f.service.applyLibraryImport(repeated)).added.length, 0);
    assert.equal((await f.service.loadLibraryPacks())[0].title, '私のセット');
});

test('id 衝突と apply 時の入力変更失敗は機械層の結果を保つ', async t => {
    const f = await fixture(t);
    const source = await f.file('font.otf');
    let plan = await f.service.planLibraryImport([source]);
    assert.equal((await f.service.applyLibraryImport(plan)).added[0].id, 'font');
    await writeFile(source, 'different font content');
    plan = await f.service.planLibraryImport([source]);
    assert.equal((await f.service.applyLibraryImport(plan)).added[0].id, 'font-2');
    const bad = await f.service.planLibraryImport([await f.file('changed.png', png)]);
    await writeFile(bad.items[0].path, 'changed');
    const result = await f.service.applyLibraryImport(bad);
    assert.equal(result.failures.length, 1); assert.equal(result.added.length, 0);
    assert.ok(!(await readdir(f.env.AKARI_LIBRARY_ROOT)).some(name => name.startsWith('.')));
    assert.deepEqual(await readdir(join(f.env.AKARI_LIBRARY_ROOT, 'font')), ['font', 'font-2']);
});

test('validate 失敗時に配置物と一時ディレクトリを残さない', async t => {
    const f = await fixture(t);
    const plan = await planAdd([await f.file('image.png', png)], { env: f.env });
    const result = await applyAdd(plan, { env: f.env, validate: () => { throw Error('検証エラー'); } });
    assert.equal(result.failures.length, 1);
    const walk = async path => (await readdir(path, { withFileTypes: true })).flatMap(entry => entry.isFile() ? [entry.name] : []);
    assert.deepEqual(await walk(f.env.AKARI_LIBRARY_ROOT), []);
    assert.deepEqual(await readdir(join(f.env.AKARI_LIBRARY_ROOT, 'still')).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), []);
});

test('packs は全 read ルートを寛容に読み、同 id は同梱優先・同梱不在でもローカル表示', async t => {
    const f = await fixture(t);
    const builtin = join(f.root, 'catalog');
    await mkdir(builtin); await mkdir(f.env.AKARI_LIBRARY_ROOT); await mkdir(join(f.env.AKARI_HOME, 'assets'), { recursive: true });
    const packs = rows => JSON.stringify({ schema: 'akari-catalog-packs/v0', packs: rows });
    const row = (id, title = id) => ({ id, title, category: 'audio' });
    await writeFile(join(builtin, 'packs.json'), packs([row('same', '同梱')]));
    await writeFile(join(f.env.AKARI_LIBRARY_ROOT, 'packs.json'), packs([row('same', '置き場'), row('new'), { id: 'invalid' }]));
    await writeFile(join(f.env.AKARI_HOME, 'assets/packs.json'), packs([row('legacy'), row('new', '旧') ]));
    f.service.loadResolverCatalogItems = async () => ({ items: [], status: 'ok', entitledProducts: [] });
    f.service.loadLocalCatalogViewItems = async () => ({ items: [], packs: await f.service.loadCatalogPacks(builtin) });
    assert.deepEqual((await f.service.getAssetCatalogView()).packs.map(pack => pack.title), ['同梱', 'new', 'legacy']);
    await writeFile(join(f.env.AKARI_LIBRARY_ROOT, 'packs.json'), '{bad');
    assert.deepEqual((await f.service.loadLibraryPacks()).map(pack => pack.id), ['legacy', 'new']);
    f.service.loadLocalCatalogViewItems = async () => ({ items: [], packs: [] });
    assert.equal((await f.service.getAssetCatalogView()).packs.length, 2);
});

test('実体用メニューだけにライブラリに保管、参照の操作は不変', () => {
    for (const target of ['material', 'unorganized']) {
        const items = buildMaterialContextMenuItems(target, true, { materialKind: 'audio' });
        assert.equal(items[items.findIndex(item => item.id === 'rename') - 1].id, 'store-library');
        assert.ok(!buildMaterialContextMenuItems(target, true, { reference: true }).some(item => item.id === 'store-library'));
    }
    assert.ok(!buildMaterialContextMenuItems('report', true).some(item => item.id === 'store-library'));
});

test('ambiguous の選択と selected=false を apply に透過、セット既定なし', async t => {
    const f = await fixture(t);
    const plan = await planAdd([await f.file('mid.wav'), await f.file('skip.otf')], { env: f.env, probe: () => 14 });
    plan.items.find(item => item.kind === 'sfx').kind = 'bgm';
    plan.items.find(item => item.kind === 'font').selected = false;
    const result = await applyAdd(plan, { env: f.env, waveform: () => ({ ok: false, reason: 'test: ffmpeg unavailable' }) });
    assert.equal(result.added.length, 1);
    const meta = JSON.parse(await readFile(join(result.added[0].libraryDir, 'meta.json'), 'utf8'));
    assert.ok(!meta.tags.includes('sfx')); assert.ok(!meta.tags.some(tag => tag.startsWith('pack:')));
    assert.equal(meta.license.attribution_required, false);
});

test('一部成功・一部失敗を service がどちらも捨てずに返す', async t => {
    const f = await fixture(t);
    const plan = await f.service.planLibraryImport([await f.file('good.png', png), await f.file('changed.otf')]);
    await writeFile(join(f.input, 'changed.otf'), 'content changed after planning');
    const result = await f.service.applyLibraryImport(plan);
    assert.equal(result.added.length, 1); assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].path, /changed.otf$/);
});
