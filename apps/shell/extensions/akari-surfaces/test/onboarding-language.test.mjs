import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AkariOnboardingServiceImpl } from '../lib/node/onboarding-service.js';
import { parseOnboardingGuide } from '../lib/onboarding/guide.js';
import { splitOnboardingTokens } from '../lib/onboarding/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const en = join(here, 'fixtures/onboarding/talkinghead-desk-en-01');
const ja = join(here, '../../../resources/onboarding-sample/talkinghead-desk-ja-01');
const json = async path => JSON.parse(await readFile(path, 'utf8'));

test('英語 fixture の選択・字幕・言語欄・sampleId の保持と ja への後退', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-language-'));
    t.after(() => import('node:fs/promises').then(fs => fs.rm(root,
        { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })));
    const make = available => {
        const service = new AkariOnboardingServiceImpl();
        let state;
        service.load = async () => state;
        service.save = async next => { state = next; };
        service.projects = {
            ensureCreatorRoot: async () => pathToFileURL(root).toString(),
            createProject: async uri => {
                await mkdir(join(fileURLToPath(uri), '.akari'), { recursive: true });
                await mkdir(join(fileURLToPath(uri), 'assets'), { recursive: true });
            }
        };
        service.bundledSample = async id => id === 'talkinghead-desk-en-01' && available ? en :
            id === 'talkinghead-desk-ja-01' ? ja : undefined;
        service.ensureSample = async (_root, id) => id === 'talkinghead-desk-en-01' ? en : ja;
        service.projectService = { recordDroppedAssets: async () => [{ success: true, assetPath: 'assets/Example.mp4' }] };
        return service;
    };
    const service = make(true);
    const first = await service.prepare('en');
    assert.equal(first.sample.sampleId, 'talkinghead-desk-en-01');
    const defaults = await json(join(here, '../../../../../packages/content-language/src/caption-defaults.json'));
    assert.equal(first.sample.guide.subtitles.max_characters, defaults.en.landscapeCharacters);
    const intake = await json(join(fileURLToPath(first.projectUri), '.akari', 'intake.json'));
    assert.equal(intake.language, 'en');
    assert.equal(intake.title, first.sample.guide.project_title);
    assert.deepEqual(first.sample.segments.map(segment => segment.text), ['Editing with AI is simple.', 'Add music,', 'then export.']);
    const resumed = await service.prepare('ja');
    assert.equal(resumed.sample.sampleId, first.sample.sampleId);
    const rel = await service.importSample(first.projectUri, first.sample.sourcePath);
    assert.equal((await json(join(fileURLToPath(first.projectUri), '.akari', 'sidecars', `${rel}.analysis`, 'analysis.json'))).transcript_language, 'en');
    const fallback = await make(false).prepare('en');
    assert.equal(fallback.sample.sampleId, 'talkinghead-desk-ja-01');
    assert.equal(fallback.sample.guide.language, 'ja');
    assert.equal((await make(true).prepare('fr')).sample.sampleId, 'talkinghead-desk-en-01');
    assert.equal((await make(false).prepare('fr')).sample.sampleId, 'talkinghead-desk-ja-01');
    const legacy = make(true);
    const old = await legacy.prepare('ja');
    await legacy.save({ schema: 1, step: 'tour0', sub: 0, projectUri: old.projectUri });
    assert.equal((await legacy.prepare('en')).sample.sampleId, 'talkinghead-desk-ja-01');
    const words = (await json(join(en, 'transcript.json'))).tokens.items;
    assert.deepEqual(splitOnboardingTokens(words, { language: 'en', max_characters: 13 }).map(segment => segment.text),
        ['Editing with', 'AI is simple.', 'Add music,', 'then export.']);
});

test('壊れた guide は欄名を含むエラーになる', async () => {
    const guide = await json(join(en, 'guide.json'));
    guide.seek_seconds = [];
    assert.throws(() => parseOnboardingGuide(guide, 'fixture'), /Invalid onboarding guide fixture: seek_seconds/);
});

test('新しいガイドは guide 欠落・JSON 破損・検証失敗から次の候補へ後退する', async t => {
    for (const [name, contents] of [
        ['missing', undefined],
        ['invalid-json', '{'],
        ['invalid-guide', JSON.stringify({ language: 'en' })]
    ]) {
        await t.test(name, async () => {
            const root = await mkdtemp(join(tmpdir(), 'akari-guide-fallback-'));
            t.after(() => import('node:fs/promises').then(fs => fs.rm(root,
                { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })));
            const broken = join(root, 'broken');
            await mkdir(broken);
            if (contents !== undefined) await writeFile(join(broken, 'guide.json'), contents);
            const service = new AkariOnboardingServiceImpl();
            let state;
            service.load = async () => state;
            service.save = async next => { state = next; };
            service.projects = {
                ensureCreatorRoot: async () => pathToFileURL(root).toString(),
                createProject: async uri => mkdir(join(fileURLToPath(uri), '.akari'), { recursive: true })
            };
            service.bundledSample = async id => id === 'talkinghead-desk-en-01' ? broken : ja;
            service.ensureSample = async () => ja;
            const warnings = [];
            const originalWarn = console.warn;
            console.warn = message => warnings.push(message);
            try {
                const prepared = await service.prepare('en');
                assert.equal(prepared.sample.sampleId, 'talkinghead-desk-ja-01');
                assert.equal(prepared.sample.guide.language, 'ja');
                assert.equal(warnings.length, 1);
                assert.match(warnings[0], /Guide for talkinghead-desk-en-01 is unavailable/);
                service.bundledSample = async () => broken;
                await assert.rejects(service.prepare('en'), /Cannot read onboarding guide|Invalid onboarding guide/);
                assert.equal(warnings.length, 1, 'resumed sample must not fall back');
                state = undefined;
                await assert.rejects(service.prepare('en'), /Cannot read onboarding guide|Invalid onboarding guide/);
                assert.equal(warnings.length, 3, 'each distinct unusable candidate logs once');
                assert.match(warnings[2], /^\[akari-onboarding\] Guide for talkinghead-desk-ja-01 is unavailable; no usable sample remains\.$/);
                assert.doesNotMatch(warnings[2], /trying the next sample/);
            } finally { console.warn = originalWarn; }
        });
    }
});

test('保存したサンプルの同梱フォルダが無ければ ID を示す', async () => {
    const service = new AkariOnboardingServiceImpl();
    service.load = async () => ({ schema: 1, step: 'work', sub: 0,
        projectUri: 'file:///guide', sampleId: 'talkinghead-desk-en-01' });
    service.bundledSample = async () => undefined;
    await assert.rejects(service.importSample('file:///guide', 'file:///library/clip.mp4'),
        /Missing bundled onboarding sample talkinghead-desk-en-01/);
});

test('空白つき字幕は語の途中の点と読点で切らない', () => {
    const tokens = ['The', 'value', '3.5', 'in', 'the', 'U.S.', 'is', '1,000', 'today.', 'Next!"']
        .map((word, index) => ({ t: word, start: index, end: index + .5 }));
    assert.deepEqual(splitOnboardingTokens(tokens, { language: 'en', max_characters: 80 }).map(segment => segment.text),
        ['The value 3.5 in the U.S. is 1,000 today.', 'Next!"']);
});

test('同梱設定はサンプルフォルダを丸ごと含む', async () => {
    const shell = await json(join(here, '../../../package.json'));
    assert.ok(shell.build.extraResources.some(resource => resource.from === 'resources/onboarding-sample' &&
        resource.to === 'onboarding-sample'));
    assert.equal((await json(join(ja, 'guide.json'))).language, 'ja');
});

test('英語 guide の最終段と古いライブラリ guide の上書き防止', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-en-example-'));
    t.after(() => import('node:fs/promises').then(fs => fs.rm(root,
        { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })));
    const source = join(root, 'library', 'clip.mp4');
    const project = join(root, 'project');
    await mkdir(join(root, 'library', 'overlays', 'demo-title'), { recursive: true });
    await mkdir(join(project, 'assets'), { recursive: true });
    await mkdir(join(project, '.akari'), { recursive: true });
    await writeFile(source, '');
    await writeFile(join(project, 'assets', 'Example.mp4'), '');
    await writeFile(join(project, 'edit.json'), '{}');
    await writeFile(join(root, 'library', 'overlays', 'demo-title', 'fragment.html'), '<div>Edit with AI</div>');
    const guide = await json(join(en, 'guide.json'));
    await writeFile(join(root, 'library', 'guide.json'), JSON.stringify({ ...guide, asset_name: 'Stale.mp4',
        title_caption: 'Stale title' }));
    const transcript = await json(join(en, 'transcript.json'));
    transcript.tokens.items.push(
        { t: 'Music,', start: 2.7, end: 2.85 },
        { t: 'captions', start: 2.9, end: 3.1 },
        { t: 'sing.', start: 3.15, end: 3.35 }
    );
    await writeFile(join(root, 'library', 'transcript.json'), JSON.stringify(transcript));
    const segments = splitOnboardingTokens(transcript.tokens.items, guide.subtitles);
    const uri = pathToFileURL(project).toString();
    const service = new AkariOnboardingServiceImpl();
    service.load = async () => ({ schema: 1, step: 'work', sub: 0, projectUri: uri,
        sampleId: 'talkinghead-desk-en-01', imported: true, exampleActive: true });
    service.bundledSample = async id => id === 'talkinghead-desk-en-01' ? en : undefined;
    await service.writeExample(uri, source, segments, segments.length, true, { stage: 8 });
    const edit = await json(join(project, 'edit.json'));
    assert.equal(edit.sources[0].path, 'assets/Example.mp4');
    assert.equal(edit.tracks.find(track => track.id === 'video').name, guide.tracks.video);
    assert.equal(edit.tracks.find(track => track.id === 'captions').name, guide.tracks.captions);
    const overlay = edit.tracks.find(track => track.id === 'demo-stage');
    assert.equal(overlay.name, guide.tracks['demo-stage']);
    assert.equal(overlay.items[0].name, guide.title_caption);
    const captions = (await json(join(project, 'captions.json'))).captions;
    assert.ok(captions.some(caption => caption.text === 'Editing with AI is simple.' &&
        caption.runs.some(run => run.role === 'emphasis' && run.style.scale === 1.15)));
    assert.ok(captions.some(caption => caption.text === guide.karaoke.text && caption.style === 'karaoke'));
    let importedName;
    service.projectService = { recordDroppedAssets: async (_uri, items) => {
        importedName = items[0].name;
        return [{ success: true, assetPath: 'assets/Example.mp4' }];
    } };
    await service.importSample(uri, source);
    assert.equal(importedName, guide.asset_name);
    assert.equal((await json(join(project, '.akari', 'sidecars', 'assets/Example.mp4.analysis', 'analysis.json'))).transcript_language, 'en');
    service.load = async () => ({ schema: 1, step: 'tour3', sub: 0, projectUri: uri,
        sampleId: 'talkinghead-desk-en-01', imported: false, exampleActive: true });
    await service.resetTourExample(uri, source, segments);
    await assert.rejects(readFile(join(project, 'assets', guide.asset_name)), { code: 'ENOENT' });
});
