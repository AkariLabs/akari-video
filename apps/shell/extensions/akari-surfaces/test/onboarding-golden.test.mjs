import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnboardingEdit, createOnboardingCaptions, createEmptyOnboardingEdit, splitOnboardingTokens } from '../lib/onboarding/model.js';
import { AkariOnboardingServiceImpl } from '../lib/node/onboarding-service.js';

const here = dirname(fileURLToPath(import.meta.url));
const sample = join(here, '../../../resources/onboarding-sample/talkinghead-desk-ja-01');
const guide = JSON.parse(await readFile(join(sample, 'guide.json'), 'utf8'));
const expected = JSON.parse(await readFile(join(here, 'fixtures/onboarding/golden-base-sha256.json'), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');

test('起点の日本語サンプル出力と model・全段階の edit / captions がバイト一致する', async t => {
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
