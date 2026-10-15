import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOnboardingGuide } from '../../lib/onboarding/guide.js';
import { splitOnboardingTokens } from '../../lib/onboarding/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const samples = join(here, '../../../../resources/onboarding-sample');
const sample = join(samples, 'talkinghead-desk-en-01');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const guideJson = await readJson(join(sample, 'guide.json'));
const guide = parseOnboardingGuide(guideJson, 'talkinghead-desk-en-01/guide.json');
const transcript = await readJson(join(sample, 'transcript.json'));
const items = guide.demo_plan.stages.flatMap(stage => stage.items);
const item = id => items.find(entry => entry.item.id === id)?.item;
const JAPANESE = /[぀-ヿ㐀-鿿＀-￯]/u;

test('英語のお手本は 35.2 秒・1056 コマで、ガイドの値は英語', () => {
    assert.equal(guide.language, 'en');
    assert.equal(guide.duration_seconds, 35.2);
    assert.equal(guide.duration_frames, 1056);
    assert.equal(guide.asset_name, 'Example.mp4');
    const visible = { ...guide, demo_plan: undefined, subtitles: undefined };
    assert.doesNotMatch(JSON.stringify(visible), JAPANESE);
    for (const { item: entry } of items) {
        assert.ok(entry.at >= 0 && entry.at + entry.duration <= guide.duration_frames, entry.id);
        if (entry.name !== undefined) assert.doesNotMatch(entry.name, JAPANESE, entry.id);
    }
    assert.ok(guide.seek_seconds.every((second, index, all) => index === 0 || second > all[index - 1]));
});

test('書き起こしは台本と同じ語の並びで、時刻は重ならない', () => {
    const tokens = transcript.tokens.items;
    assert.equal(transcript.language, 'en');
    assert.equal(tokens.map(token => token.t).join(' '), transcript.script);
    tokens.forEach((token, index) => {
        assert.ok(token.end > token.start, `token ${index}`);
        if (index) assert.ok(token.start >= tokens[index - 1].end, `token ${index}: 前の語と重ならない`);
    });
    assert.ok(tokens.at(-1).end < guide.duration_seconds);
    // 残す 1 秒と詰める 2 秒の間
    assert.deepEqual(transcript.silences.items.map(silence => silence.intent), ['keep', 'natural', 'trim']);
});

test('字幕は 32 字以内で、見せ場の語の頭から出る', () => {
    const captions = splitOnboardingTokens(transcript.tokens.items, guide.subtitles);
    assert.equal(captions.length, 20);
    assert.ok(captions.every(caption => caption.text.length <= guide.subtitles.max_characters && caption.end > caption.start));
    assert.equal(captions.map(caption => caption.text).join(' '), transcript.script);
    const startOf = text => captions.find(caption => caption.text.startsWith(text))?.start;
    assert.equal(startOf('Hi there!'), 0.24);
    assert.equal(startOf('or effects'), 16.71);
    assert.equal(startOf('diagrams'), 21.55);
    // カラオケは「background music,」の次の行をまるごと塗る
    const karaoke = captions.findIndex(caption => caption.text === guide.karaoke.text);
    assert.ok(karaoke > 0);
    assert.equal(captions[karaoke - 1].text, guide.karaoke.head);
    for (const { text } of guide.emphasis) assert.ok(captions.some(caption => caption.text.includes(text)), text);
});

test('演出は英語の語頭に合わせて置かれ、右の舞台は一度に 1 つ', () => {
    const word = text => transcript.tokens.items.find(token => token.t.replace(/[^A-Za-z]/gu, '') === text).start;
    const frame = seconds => Math.round(seconds * 30);
    assert.ok(Math.abs(item('demo-sfx-name-pop').at - frame(word('Akari'))) <= 1);
    assert.ok(Math.abs(item('demo-flash').at - frame(word('pop'))) <= 1);
    assert.ok(Math.abs(item('demo-phone-screen').at - frame(word('mockups'))) <= 1);
    assert.ok(Math.abs(item('demo-bgm-chip').at - frame(word('background'))) <= 1);
    assert.ok(Math.abs(item('demo-phone-screen').source.in - item('demo-phone-screen').at / 30) < .001);
    const stage = items.filter(entry => entry.track === 'demo-stage').map(entry => entry.item).sort((a, b) => a.at - b.at);
    stage.slice(1).forEach((entry, index) => assert.ok(entry.at >= stage[index].at + stage[index].duration,
        `${stage[index].id} と ${entry.id} が重ならない`));
    assert.equal(item('onboarding-bgm').duration, guide.duration_frames);
    assert.equal(item('onboarding-bgm').source.out, guide.duration_seconds);
});

test('演出の断片は英語の文字だけを表示する', async () => {
    const paths = [...new Set(items.map(entry => entry.item.source?.path).filter(Boolean))];
    assert.equal(paths.length, 9);
    for (const path of paths) {
        const source = await readFile(join(sample, path), 'utf8');
        const visible = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/<!--[\s\S]*?-->/gu, '')
            .replace(/url\(data:[^)]*\)/gu, '');
        assert.doesNotMatch(visible, JAPANESE, path);
    }
});

test('音源は日本語版と同じ効果音と、英語の尺に切り出した BGM', async () => {
    const sources = await readJson(join(sample, 'audio-sources.json'));
    assert.equal(sources.sample_id, 'talkinghead-desk-en-01');
    const ja = await readJson(join(samples, 'talkinghead-desk-ja-01/audio-sources.json'));
    for (const file of sources.files) {
        const bytes = await readFile(join(sample, file.file));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.file);
        assert.equal(bytes.length, file.bytes, file.file);
        if (file.file !== 'bgm.m4a') assert.equal(file.sha256, ja.files.find(entry => entry.file === file.file).sha256, file.file);
    }
    assert.deepEqual(sources.files.find(file => file.file === 'bgm.m4a').source_range_s, [0.37, 35.57]);
});

test('英語の完成形: 字幕は英語の表示方針で、全行に語の時刻があり、カラオケの行が塗られる', async t => {
    const { mkdir, mkdtemp, rm, writeFile, copyFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { pathToFileURL } = await import('node:url');
    const { createRequire } = await import('node:module');
    const { AkariOnboardingServiceImpl } = await import('../../lib/node/onboarding-service.js');
    const { validateCaptionDisplayPolicy } = createRequire(import.meta.url)('@akari-video/edit-store');
    const root = await mkdtemp(join(process.env.AKARI_TEST_SCRATCH || tmpdir(), 'akari-sample-en-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(join(root, '.akari'), { recursive: true });
    await copyFile(join(sample, 'clip.mp4'), join(root, 'assets', 'Example.mp4'));
    await writeFile(join(root, 'edit.json'), '{}');
    const uri = pathToFileURL(root).toString();
    const service = new AkariOnboardingServiceImpl();
    service.load = async () => ({ schema: 1, step: 'work', sub: 0, projectUri: uri, sampleId: 'talkinghead-desk-en-01',
        imported: true, exampleActive: true });
    service.bundledSample = async id => id === 'talkinghead-desk-en-01' ? sample : undefined;
    const segments = splitOnboardingTokens(transcript.tokens.items, guide.subtitles);
    await service.writeExample(uri, join(sample, 'clip.mp4'), segments, segments.length, true, { stage: 8 });
    const written = await readJson(join(root, 'captions.json'));
    assert.equal(validateCaptionDisplayPolicy(written.display_policy).locale, 'en');
    const captions = written.captions.filter(caption => caption.sourceRef !== null);
    assert.equal(captions.length, 20);
    assert.ok(captions.every(caption => Array.isArray(caption.words) && caption.words.length > 0), 'every line has word timings');
    const karaoke = captions.find(caption => caption.style === 'karaoke');
    assert.equal(karaoke.text, guide.karaoke.text);
    assert.deepEqual(karaoke.words.map(word => word.text), ['and', 'even', 'karaoke-style', 'captions.']);
});
