import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AkariOnboardingServiceImpl } from '../../lib/node/onboarding-service.js';
import { lintProject } from '../../../../../../packages/edit-lint/src/edit-lint.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sample = join(here, '../../../../resources/onboarding-sample/talkinghead-desk-ja-01');
const exists = path => stat(path).then(() => true, () => false);

test('図解の要素は書き起こしの語時刻で現れ、画面右の安全域で消える', async () => {
    const transcript = JSON.parse(await readFile(join(sample, 'transcript.json'), 'utf8'));
    const cues = [
        { id: 'dialogue', start: 7.8, words: [['person', 7.82], ['ai', 8.11], ['video', 9.37]] },
        { id: 'automatic', start: 11.34, words: [['voice', 11.34], ['cut', 12.03], ['caption', 12.44], ['title', 12.98]] },
        { id: 'effects', start: 15.36, words: [['wave', 16.64], ['burst', 18.95]] },
        { id: 'diagram', start: 22.62, words: [['axis', 22.85], ['bar-one', 23.26], ['bar-two', 23.43], ['bar-three', 23.72], ['line', 24.19]] },
        { id: 'finishing', start: 26.86, words: [['phone', 26.89], ['music', 29.28], ['karaoke', 30.45]] }
    ];
    for (const { id, start, words } of cues) {
        const html = await readFile(join(sample, 'overlays', id, 'fragment.html'), 'utf8');
        assert.match(html, /left:var\(--figure-left,56%\);top:var\(--figure-top,25%\);width:var\(--figure-width,41%\);max-height:var\(--figure-max-height,38%\)/);
        assert.match(html, /\[data-akari-active\]/);
        assert.match(html, /100%\{opacity:0;transform:translateY\(0\)\}/);
        assert.match(html, /<svg\b/);
        for (const [name, absolute] of words) {
            assert.ok(transcript.tokens.items.some(token => Math.abs(token.start - absolute) < .001), `${id}: ${name} の語時刻`);
            const actual = html.match(new RegExp(`--${id}-${name}-delay,([0-9.]+)s`));
            assert.ok(actual, `${id}: ${name} の局所遅延`);
            assert.ok(Math.abs(Number(actual[1]) - (absolute - start)) < .011, `${id}: ${name} の表示秒`);
        }
    }
});

test('同梱の図解と BGM が素材ライブラリへ届く', async t => {
    const root = await mkdtemp(join(process.env.AKARI_TEST_SCRATCH || tmpdir(), 'akari-demo-library-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const service = new AkariOnboardingServiceImpl();
    const destination = await service.ensureSample(root);
    for (const name of ['bgm.m4a', 'overlays/dialogue/fragment.html', 'overlays/finishing/fragment.html']) {
        assert.equal(await exists(join(destination, name)), true, name);
    }
});

test('お手本は図解を順に追加し、最後に BGM を追加して edit-lint を通す', async t => {
    const root = await mkdtemp(join(process.env.AKARI_TEST_SCRATCH || tmpdir(), 'akari-demo-rich-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(join(root, '.akari'), { recursive: true });
    await copyFile(join(sample, 'clip.mp4'), join(root, 'assets', 'サンプル動画.mp4'));
    await writeFile(join(root, 'edit.json'), '{}');
    const uri = pathToFileURL(root).toString();
    const service = new AkariOnboardingServiceImpl();
    service.load = async () => ({ schema: 1, step: 'work', sub: 0, projectUri: uri, imported: true });
    const transcript = JSON.parse(await readFile(join(sample, 'transcript.json'), 'utf8'));
    const segments = transcript.segments.items;
    await service.writeExample(uri, join(sample, 'clip.mp4'), segments, segments.length, true, { figures: 2, bgm: false });
    let edit = JSON.parse(await readFile(join(root, 'edit.json'), 'utf8'));
    assert.equal(edit.tracks.find(track => track.id === 'figures').items.length, 2);
    assert.equal(edit.tracks.some(track => track.id === 'onboarding-bgm'), false);
    await service.writeExample(uri, join(sample, 'clip.mp4'), segments, segments.length, true);
    edit = JSON.parse(await readFile(join(root, 'edit.json'), 'utf8'));
    const figures = edit.tracks.find(track => track.id === 'figures').items;
    const bgm = edit.tracks.find(track => track.id === 'onboarding-bgm').items[0];
    assert.equal(figures.length, 5);
    assert.ok(figures.every(item => item.source.kind === 'html' && item.at >= 234 && item.at + item.duration <= 1128));
    assert.deepEqual({ role: bgm.role, duration: bgm.duration, gain_db: bgm.gain_db,
        fade_in: bgm.fade_in, fade_out: bgm.fade_out, ducking: bgm.ducking },
        { role: 'bgm', duration: 1128, gain_db: -12, fade_in: 1, fade_out: 2.8, ducking: true });
    assert.equal(await exists(join(root, 'assets', 'onboarding-bgm.m4a')), true);
    const lint = await lintProject(root);
    assert.equal(lint.verdict, 'pass', JSON.stringify(lint.findings.filter(finding => finding.severity === 'error')));
});

test('ツアーのリセットはコピーした図解と BGM だけを片付ける', async t => {
    const root = await mkdtemp(join(process.env.AKARI_TEST_SCRATCH || tmpdir(), 'akari-demo-reset-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(join(root, '.akari'), { recursive: true });
    await copyFile(join(sample, 'clip.mp4'), join(root, 'assets', 'サンプル動画.mp4'));
    await writeFile(join(root, 'edit.json'), '{}');
    const uri = pathToFileURL(root).toString();
    const service = new AkariOnboardingServiceImpl();
    service.load = async () => ({ schema: 1, step: 'tour3', sub: 0, projectUri: uri, exampleActive: true });
    const segments = JSON.parse(await readFile(join(sample, 'transcript.json'), 'utf8')).segments.items;
    await service.writeExample(uri, join(sample, 'clip.mp4'), segments, segments.length, true);
    const changed = join(root, 'overlays', 'dialogue', 'fragment.html');
    const changedBgm = join(root, 'assets', 'onboarding-bgm.m4a');
    await writeFile(changed, 'owner changed');
    await writeFile(changedBgm, 'owner changed music');
    await service.resetTourExample(uri, join(sample, 'clip.mp4'), segments);
    assert.equal(await readFile(changed, 'utf8'), 'owner changed');
    assert.equal(await readFile(changedBgm, 'utf8'), 'owner changed music');
    assert.equal(await exists(join(root, 'overlays', 'automatic', 'fragment.html')), false);
    assert.equal(await exists(join(root, 'overlays', 'finishing', 'fragment.html')), false);
});

test('頼む文と作業ログには図解・BGM が入り、約15秒で完了する', async () => {
    const controller = await readFile(join(here, 'controller.ts'), 'utf8');
    const prompt = controller.match(/const PROMPT = '([^']+)'/)?.[1];
    const log = controller.slice(controller.indexOf('const LOG:'), controller.indexOf('const esc ='));
    const times = [...log.matchAll(/\{ t: (\d+),/g)].map(match => Number(match[1]));
    assert.equal(prompt, 'この動画を編集したいです。タイトルと字幕を入れて、話している内容に合わせて図解と BGM も入れてください。');
    assert.equal(times.length, 14);
    assert.ok(times.every((time, index) => index === 0 || time > times[index - 1]));
    assert.ok(times.at(-1) + 700 <= 15000);
    assert.equal((log.match(/figures: [1-5]/g) ?? []).length, 5);
    assert.match(log, /bgm: true/);
});
