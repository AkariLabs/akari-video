import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnboardingEdit, createOnboardingCaptions, createEmptyOnboardingEdit, splitOnboardingTokens } from '../lib/onboarding/model.js';
import { AkariOnboardingServiceImpl } from '../lib/node/onboarding-service.js';
import { planCaptionLookMigration, resolveCaptionStylePreset } from '@akari-video/edit-store';
import { loadTextstyleCatalogSync } from '@akari-video/edit-store/lib/textstyle-library-node';

const here = dirname(fileURLToPath(import.meta.url));
const sample = join(here, '../../../resources/onboarding-sample/talkinghead-desk-ja-01');
const guide = JSON.parse(await readFile(join(sample, 'guide.json'), 'utf8'));
const expected = JSON.parse(await readFile(join(here, 'fixtures/onboarding/golden-base-sha256.json'), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');

test('日本語サンプルの model・全段階の edit / captions が期待値とバイト一致する', async t => {
    const transcript = JSON.parse(await readFile(join(sample, 'transcript.json'), 'utf8'));
    const segments = splitOnboardingTokens(transcript.tokens.items, guide.subtitles);
    const check = (name, value) => assert.equal(digest(value), expected[name], name);
    check('model-segments.json', JSON.stringify(segments, null, 2));
    check('model-empty-edit.json', JSON.stringify(createEmptyOnboardingEdit(), null, 2));
    check('model-edit-plain.json', JSON.stringify(createOnboardingEdit('assets/サンプル動画.mp4', false, guide), null, 2));
    check('model-edit-title.json', JSON.stringify(createOnboardingEdit('assets/サンプル動画.mp4', true, guide), null, 2));
    check('model-captions-title.json', JSON.stringify(createOnboardingCaptions(segments, segments.length, true, guide), null, 2));
    check('model-captions-5.json', JSON.stringify(createOnboardingCaptions(segments, 5, false, guide), null, 2));
    const scratch = await mkdtemp(join(tmpdir(), 'akari-golden-'));
    t.after(async () => { await import('node:fs/promises').then(fs => fs.rm(scratch,
        { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })); });
    const project = async name => {
        const root = join(scratch, name);
        await mkdir(root);
        await mkdir(join(root, 'assets'));
        await mkdir(join(root, '.akari'));
        await copyFile(join(sample, 'clip.mp4'), join(root, 'assets', 'サンプル動画.mp4'));
        await writeFile(join(root, 'edit.json'), '{}');
        const uri = pathToFileURL(root).toString();
        const service = new AkariOnboardingServiceImpl();
        service.load = async () => ({ schema: 1, step: 'work', sub: 0, projectUri: uri, imported: true, exampleActive: true });
        return { root, uri, service };
    };
    const stages = await project('stages');
    for (let stage = 0; stage <= 8; stage++) {
        await stages.service.writeExample(stages.uri, join(sample, 'clip.mp4'), segments, segments.length, stage > 0, { stage });
        check(`stage-${stage}-edit.json`, await readFile(join(stages.root, 'edit.json')));
        check(`stage-${stage}-captions.json`, await readFile(join(stages.root, 'captions.json')));
    }
    for (const [label, count, title] of [['c0-notitle', 0, false], ['c5-notitle', 5, false],
        ['c5-title', 5, true], ['call-title', segments.length, true], ['call-notitle', segments.length, false]]) {
        const run = await project(label);
        await run.service.writeExample(run.uri, join(sample, 'clip.mp4'), segments, count, title);
        check(`noprogress-${label}-edit.json`, await readFile(join(run.root, 'edit.json')));
        check(`noprogress-${label}-captions.json`, await readFile(join(run.root, 'captions.json')));
    }
});

test('ja / en のガイド全段階で字幕の見た目は保たれ、移行の試しは差分なし', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-look-stages-'));
    t.after(async () => { await import('node:fs/promises').then(fs => fs.rm(scratch,
        { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })); });
    const catalog = loadTextstyleCatalogSync({ env: process.env }).catalog;
    const baseStyle = resolveCaptionStylePreset({ style_preset: 'subtitle-standard' }, catalog).record.text_style;
    for (const language of ['ja', 'en']) {
        const source = join(here, `../../../resources/onboarding-sample/talkinghead-desk-${language}-01`);
        const selectedGuide = JSON.parse(await readFile(join(source, 'guide.json'), 'utf8'));
        const transcript = JSON.parse(await readFile(join(source, 'transcript.json'), 'utf8'));
        const segments = splitOnboardingTokens(transcript.tokens.items, selectedGuide.subtitles);
        const root = join(scratch, language);
        await mkdir(join(root, 'assets'), { recursive: true });
        await mkdir(join(root, '.akari'));
        await copyFile(join(source, 'clip.mp4'), join(root, 'assets', selectedGuide.asset_name));
        await writeFile(join(root, 'edit.json'), '{}');
        const uri = pathToFileURL(root).toString();
        const service = new AkariOnboardingServiceImpl();
        service.load = async () => ({ schema: 1, step: 'work', sub: 0,
            projectUri: uri, sampleId: `talkinghead-desk-${language}-01`,
            imported: true, exampleActive: true });
        let expectedText;
        for (let stage = 0; stage <= 8; stage++) {
            await service.writeExample(uri, join(source, 'clip.mp4'), segments, segments.length,
                stage > 0, { stage });
            const written = JSON.parse(await readFile(join(root, 'captions.json'), 'utf8'));
            const migration = planCaptionLookMigration(written, catalog);
            assert.deepEqual(migration.diff, [], `${language} stage ${stage}`);
            expectedText ??= written.captions.map(row => row.text);
            assert.deepEqual(written.captions.map(row => row.text), expectedText);
            for (const row of written.captions) {
                assert.equal(row.style_preset, undefined);
                assert.deepEqual(row.style_sources.look.kind, 'builtin');
                assert.equal(row.style_sources.look.id, 'subtitle-standard');
                if (row.style === 'karaoke') {
                    assert.equal(row.text_style.size_px, 62);
                    assert.deepEqual(row.text_style.karaoke, { fill: 'smooth', done_color: '#FB923C' });
                } else assert.deepEqual(row.text_style, baseStyle);
                for (const run of row.runs) {
                    assert.ok(run.id);
                    assert.equal(run.style, undefined);
                    assert.equal(run.look.color, '#FB923C');
                    assert.equal(run.look.font_weight, 900);
                }
            }
        }
        assert.equal(await service.lintExample(uri), 0, `${language} edit-lint`);
    }
});

test('起点の prepare / import 出力は言語欄・guide・sampleId の追加を除いて一致する', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-golden-prepare-'));
    const previousHome = process.env.AKARI_HOME;
    process.env.AKARI_HOME = join(scratch, 'home');
    t.after(async () => {
        if (previousHome === undefined) delete process.env.AKARI_HOME;
        else process.env.AKARI_HOME = previousHome;
        await import('node:fs/promises').then(fs => fs.rm(scratch,
            { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    });
    const creator = join(scratch, 'creator');
    await mkdir(creator);
    const service = new AkariOnboardingServiceImpl();
    const dropped = [];
    service.projects = {
        ensureCreatorRoot: async () => pathToFileURL(creator).toString(),
        createProject: async uri => {
            await mkdir(join(fileURLToPath(uri), '.akari'), { recursive: true });
            await mkdir(join(fileURLToPath(uri), 'assets'), { recursive: true });
        }
    };
    service.projectService = { recordDroppedAssets: async (_uri, items) => {
        dropped.push(items);
        return items.map(item => ({ success: true, assetPath: `assets/${item.name}` }));
    } };
    const check = (name, value) => assert.equal(digest(value), expected[name], name);
    const normalize = value => value.replaceAll(scratch, '<SCRATCH>')
        .replace(/\d{4}-\d{2}-\d{2}-first-video/g, '<DATE>-first-video');
    const prepared = await service.prepare();
    const project = fileURLToPath(prepared.projectUri);
    const result = structuredClone(prepared);
    delete result.sample.sampleId;
    delete result.sample.guide;
    check('prepare-result.json', normalize(JSON.stringify(result, null, 2)));
    const intake = JSON.parse(await readFile(join(project, '.akari', 'intake.json'), 'utf8'));
    assert.equal(intake.language, 'ja');
    delete intake.language;
    check('prepare-intake.json', `${JSON.stringify(intake, null, 2)}\n`);
    check('prepare-edit.json', await readFile(join(project, 'edit.json')));
    const state = JSON.parse(await readFile(join(process.env.AKARI_HOME, 'onboarding-v1.json'), 'utf8'));
    assert.equal(state.sampleId, 'talkinghead-desk-ja-01');
    delete state.sampleId;
    check('prepare-state.json', normalize(`${JSON.stringify(state, null, 2)}\n`));
    const rel = await service.importSample(prepared.projectUri, prepared.sample.sourcePath);
    check('import-rel.txt', rel);
    check('import-dropped.json', JSON.stringify(dropped, null, 2).replaceAll(scratch, '<SCRATCH>'));
    const analysis = JSON.parse(await readFile(join(project, '.akari', 'sidecars', `${rel}.analysis`, 'analysis.json'), 'utf8'));
    assert.equal(analysis.transcript_language, 'ja');
    delete analysis.transcript_language;
    check('import-analysis.json', `${JSON.stringify(analysis, null, 2)}\n`);
});
