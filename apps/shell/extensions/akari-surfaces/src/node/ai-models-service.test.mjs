import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { AkariAiModelsServiceImpl } from '../../lib/node/ai-models-service.js';
const model = (id, kind, callable = true) => ({ id, kind, name: id, maker: 'maker', group: id, main: true, callable,
    via: 'local', inputs: {}, outputs: {}, price: null });
test('一時リポの loadAiModels と会社表を読み、保存・優先順位・破損を扱う', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'akari-ai-models-'));
    const oldHome = process.env.AKARI_HOME;
    process.env.AKARI_HOME = join(root, 'home');
    t.after(async () => { if (oldHome === undefined) {
        delete process.env.AKARI_HOME;
    }
    else {
        process.env.AKARI_HOME = oldHome;
    } await rm(root, { recursive: true, force: true }); });
    const schemas = join(root, 'packages', 'schemas');
    const generate = join(root, 'packages', 'generate', 'src');
    await mkdir(schemas, { recursive: true });
    await mkdir(generate, { recursive: true });
    const rows = [model('image-a', 'image'), model('image-b', 'image'), model('image-later', 'image', false),
        model('video-a', 'video'), model('voice-a', 'voice'), model('transcribe-a', 'transcribe')];
    await writeFile(join(generate, 'ai-models.mjs'), `export async function loadAiModels(){ return ${JSON.stringify(rows)}; }`);
    await writeFile(join(schemas, 'ai-makers.json'), JSON.stringify({ maker: { name: '会社', initials: '会', background: '#000', color: '#fff' } }));
    const set = { label: 'ふつう', defaults: { image: 'image-later', video: 'video-a', voice: 'voice-a', transcribe: 'transcribe-a' }, favorites: { image: ['image-later', 'image-a'] } };
    await writeFile(join(schemas, 'ai-model-sets.json'), JSON.stringify({ version: 1, sets: { normal: set, cheap: set, quality: set } }));
    const service = new AkariAiModelsServiceImpl();
    service.repoRoot = root;
    await t.test('カタログと会社', async () => { const catalog = await service.getAiModelCatalog(); assert.deepEqual(catalog.models, rows); assert.equal(catalog.makers.maker.name, '会社'); });
    await t.test('呼べないセットの既定を外し全種類を解決', async () => {
        const preferences = await service.getAiModelPreferences();
        assert.equal(preferences.defaults.image, 'image-a');
        assert.equal(preferences.source.image, 'set');
        assert.deepEqual(Object.keys(preferences.defaults).sort(), ['image', 'transcribe', 'video', 'voice']);
    });
    await t.test('お気に入りの付け外しといつものを保存', async () => {
        await service.toggleFavorite('image', 'image-b');
        assert.equal((await service.getAiModelPreferences()).favorites.image.includes('image-b'), true);
        await service.toggleFavorite('image', 'image-b');
        assert.equal((await service.getAiModelPreferences()).favorites.image.includes('image-b'), false);
        await service.setDefault('image', 'image-b');
        assert.equal((await service.getAiModelPreferences()).source.image, 'app');
        const document = JSON.parse(await readFile(join(root, 'home', 'ai-models.json'), 'utf8'));
        assert.equal(document.version, 1);
        assert.equal(document.defaults.image, 'image-b');
    });
    await t.test('この動画の固定が優先し、解除するとアプリ全体へ戻る', async () => {
        const project = join(root, 'project');
        const projectRootUri = pathToFileURL(project).href;
        await mkdir(join(project, '.akari'), { recursive: true });
        await service.setDefault('image', 'image-a', { projectRootUri });
        const chosen = await service.getAiModelPreferences({ projectRootUri });
        assert.equal(chosen.defaults.image, 'image-a');
        assert.equal(chosen.source.image, 'project');
        assert.equal(chosen.projectAvailable, true);
        const document = JSON.parse(await readFile(join(project, '.akari', 'ai-models.json'), 'utf8'));
        assert.deepEqual(Object.keys(document), ['version', 'defaults']);
        await service.setDefault('image', null, { projectRootUri });
        assert.equal((await service.getAiModelPreferences({ projectRootUri })).defaults.image, 'image-b');
    });
    await t.test('壊れたファイルは無視し、セットへ戻る', async () => {
        await writeFile(join(root, 'home', 'ai-models.json'), '{broken');
        const preferences = await service.getAiModelPreferences();
        assert.equal(preferences.defaults.image, 'image-a');
        assert.equal(preferences.source.image, 'set');
    });
    await t.test('セット押下は呼べるモデルだけを全種類保存', async () => {
        await service.applySet('quality');
        const document = JSON.parse(await readFile(join(root, 'home', 'ai-models.json'), 'utf8'));
        assert.equal(document.defaults.image, 'image-a');
        assert.deepEqual(Object.keys(document.defaults).sort(), ['image', 'transcribe', 'video', 'voice']);
        assert.equal(document.favorites.image.includes('image-later'), false);
    });
    await t.test('この動画でセットを押すと固定とアプリ全体のお気に入りを保存する', async () => {
        const project = join(root, 'set-project');
        await mkdir(join(project, '.akari'), { recursive: true });
        await service.applySet('cheap', { projectRootUri: pathToFileURL(project).href });
        const local = JSON.parse(await readFile(join(project, '.akari', 'ai-models.json'), 'utf8'));
        const app = JSON.parse(await readFile(join(root, 'home', 'ai-models.json'), 'utf8'));
        assert.deepEqual(Object.keys(local.defaults).sort(), ['image', 'transcribe', 'video', 'voice']);
        assert.equal(local.favorites, undefined);
        assert.deepEqual(app.favorites.image, ['image-a']);
    });
    await t.test('この動画は .akari ディレクトリを持つプロジェクトだけで選べる', async () => {
        const plain = join(root, 'plain-folder');
        await mkdir(plain, { recursive: true });
        assert.equal((await service.getAiModelPreferences()).projectAvailable, false);
        assert.equal((await service.getAiModelPreferences({ projectRootUri: pathToFileURL(plain).href })).projectAvailable, false);
        await assert.rejects(service.setDefault('image', 'image-a', { projectRootUri: plain }), /動画プロジェクト/);
        await mkdir(join(plain, '.akari'));
        assert.equal((await service.getAiModelPreferences({ projectRootUri: plain })).projectAvailable, true);
    });
});
