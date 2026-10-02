import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AkariOnboardingServiceImpl } from '../../lib/node/onboarding-service.js';
import { splitOnboardingTokens } from '../../lib/onboarding/model.js';
import { lintProject } from '../../../../../../packages/edit-lint/src/edit-lint.mjs';
import { readRenderEdit } from '../../../../../../packages/render-cut/src/internal-render.mjs';
import { loadCaptions, loadOverlays } from '../../../../../../packages/render-cut/src/render-cut.mjs';
import { evaluateGpuEligibility } from '../../../../../../packages/gpu-export/src/eligibility.mjs';

const require = createRequire(import.meta.url);
const { toAnchorCaptions } = require('../../../../../../packages/edit-store/lib/index.js');

// Production layout: apps/shell/extensions/akari-surfaces/evidence/onboarding-demo-production/plan.json.
// お手本に声のダッキング鍵は無いので ducking を使わず、声の下は -14 dB、「BGM も」は +8 dB、締めは +10 dB。
// keyframes は 8 点以下に保ち、音声 item が edit-store の motion 袋へ移されないようにする。
// phone-screen reuses sample, so captions: 'off' prevents duplicate subtitles.
const html = (track, id, name, at, duration, path) =>
    ({ track, item: { id, name, at, duration, source: { kind: 'html', path } } });
const sfx = (id, at, duration, gain_db, name, out) =>
    ({ track: 'demo-sfx', item: { id, at, duration, role: 'sfx', gain_db,
        source: { kind: 'media', src: `demo-${name}`, in: 0, out } } });
const expectedPlan = {
  stages: [
    { stage: 1, key: 'title', items: [
        html('demo-stage', 'demo-title', 'タイトル', 7, 217, 'overlays/demo-title/fragment.html'),
        sfx('demo-sfx-title-whoosh', 0, 29, -10, 'sfx-whoosh-air-soft', 0.95),
        sfx('demo-sfx-name-pop', 107, 15, -6, 'sfx-pop-ding', 0.5)
    ] },
    { stage: 2, key: 'telops', items: [
        html('demo-stage', 'demo-chat', 'AI との対話', 256, 73, 'overlays/demo-chat/fragment.html'),
        html('demo-stage', 'demo-done', '編集完了', 338, 108, 'overlays/demo-done/fragment.html'),
        sfx('demo-sfx-chat-pop-1', 256, 5, -4, 'sfx-pop-bubble-big', 0.15),
        sfx('demo-sfx-chat-pop-2', 277, 5, -4, 'sfx-pop-bubble-big', 0.15),
        sfx('demo-sfx-done-tone', 402, 17, -3, 'sfx-correct-tone', 0.55)
    ] },
    { stage: 3, key: 'effects', items: [
        html('demo-stage', 'demo-effects', '効果音とエフェクト', 524, 135, 'overlays/demo-effects/fragment.html'),
        html('demo-flash', 'demo-flash', '閃光', 590, 12, 'overlays/demo-flash/fragment.html'),
        sfx('demo-sfx-kouka-pop', 524, 5, -4, 'sfx-pop-cork', 0.15),
        sfx('demo-sfx-pa-whoosh', 581, 23, -4, 'sfx-whoosh-punchy', 0.75),
        sfx('demo-sfx-hora-sparkle', 617, 44, 2, 'sfx-shimmer-sparkle', 1.45)
    ] },
    { stage: 4, key: 'diagram', items: [
        html('demo-stage', 'demo-diagram', '図解', 697, 110, 'overlays/demo-diagram/fragment.html'),
        sfx('demo-sfx-diagram-pon', 697, 15, -3, 'sfx-diagram-pon', 0.482),
        sfx('demo-sfx-diagram-stack', 713, 5, -3, 'sfx-diagram-stack', 0.147),
        sfx('demo-sfx-diagram-playhead', 727, 7, -3, 'sfx-diagram-playhead', 0.216),
        sfx('demo-sfx-diagram-count', 743, 18, -3, 'sfx-diagram-count', 0.567)
    ] },
    { stage: 5, key: 'phone', items: [
        { track: 'demo-phone-screen', item: { id: 'demo-phone-screen', name: 'スマホの画面', at: 833, duration: 144, crop: { x: 0.208, y: 0, w: 0.2645, h: 1 }, transform: { x: 372, y: -24, scale: 0.6607 }, source: { kind: 'media', src: 'sample', in: 27.7667, out: 32.5667, mute: true }, captions: 'off' } },
        html('demo-stage', 'demo-phone', 'スマホ', 809, 179, 'overlays/demo-phone/fragment.html'),
        sfx('demo-sfx-phone-swoosh', 805, 20, -5, 'sfx-swoosh-up', 0.65),
        sfx('demo-sfx-phone-tap', 833, 5, -6, 'sfx-click-mouse-single', 0.15)
    ] },
    { stage: 6, key: 'bgm', items: [
        { track: 'onboarding-bgm', item: { id: 'onboarding-bgm', at: 0, duration: 1128, role: 'bgm', gain_db: -14, fade_in: 0.6, fade_out: 1.2,
            keyframes: [{ t: 0, gain_db: 0 }, { t: 879, gain_db: 0 }, { t: 888, gain_db: 8, easing: 'out-cubic' }, { t: 918, gain_db: 8 },
                { t: 942, gain_db: 0, easing: 'in-out-cubic' }, { t: 1070, gain_db: 0 }, { t: 1080, gain_db: 10, easing: 'out-cubic' }],
            source: { kind: 'media', src: 'onboarding-bgm', in: 0, out: 37.6 } } },
        html('demo-accents', 'demo-bgm-chip', 'BGM', 883, 105, 'overlays/demo-bgm/fragment.html')
    ] },
    { stage: 7, key: 'karaoke', items: [] },
    { stage: 8, key: 'credit', items: [
        html('demo-stage', 'demo-credit', 'クレジット', 1068, 60, 'overlays/demo-credit/fragment.html'),
        sfx('demo-sfx-punchline-ding', 1069, 42, -2, 'sfx-ding-single', 1.4)
    ] }
  ],
  punch_in_keyframes: [{ t: 590, transform: { x: 0, scale: 1 } }, { t: 592, transform: { x: 0, scale: 1.1 }, easing: 'out-expo' }, { t: 593, transform: { x: 4, scale: 1.1 } }, { t: 594, transform: { x: -4, scale: 1.1 } }, { t: 595, transform: { x: 0, scale: 1.1 } }, { t: 633, transform: { x: 0, scale: 1.1 } }, { t: 642, transform: { x: 0, scale: 1 }, easing: 'in-out-cubic' }]
};
const sample = join(dirname(fileURLToPath(import.meta.url)), '../../../../resources/onboarding-sample/talkinghead-desk-ja-01');
const exists = path => stat(path).then(() => true, () => false);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const overlays = ['demo-title', 'demo-chat', 'demo-done', 'demo-effects', 'demo-flash',
    'demo-diagram', 'demo-phone', 'demo-bgm', 'demo-credit'];
test('同梱オーバーレイの easing 変数にはフォールバックがある', async () => {
    for (const name of overlays) {
        const fragment = await readFile(join(sample, 'overlays', name, 'fragment.html'), 'utf8');
        assert.deepEqual(fragment.match(/var\(--ease-[a-z-]+\)/g), null, name);
    }
});
const sounds = ['sfx-whoosh-air-soft', 'sfx-pop-ding', 'sfx-pop-bubble-big', 'sfx-correct-tone',
    'sfx-pop-cork', 'sfx-whoosh-punchy', 'sfx-shimmer-sparkle', 'sfx-diagram-pon',
    'sfx-diagram-stack', 'sfx-diagram-playhead', 'sfx-diagram-count',
    'sfx-swoosh-up', 'sfx-click-mouse-single', 'sfx-ding-single'];
const files = [...overlays.map(name => [`overlays/${name}/fragment.html`, `overlays/${name}/fragment.html`]),
    ...sounds.map(name => [`audio/${name}.m4a`, `assets/onboarding/${name}.m4a`]),
    ['bgm.m4a', 'assets/onboarding-bgm.m4a']];
const stageItems = [
    { 'demo-stage': ['demo-title'], 'demo-sfx': ['demo-sfx-title-whoosh', 'demo-sfx-name-pop'] },
    { 'demo-stage': ['demo-chat', 'demo-done'], 'demo-sfx': ['demo-sfx-chat-pop-1', 'demo-sfx-chat-pop-2', 'demo-sfx-done-tone'] },
    { 'demo-stage': ['demo-effects'], 'demo-flash': ['demo-flash'], 'demo-sfx': ['demo-sfx-kouka-pop', 'demo-sfx-pa-whoosh', 'demo-sfx-hora-sparkle'] },
    { 'demo-stage': ['demo-diagram'], 'demo-sfx': ['demo-sfx-diagram-pon', 'demo-sfx-diagram-stack', 'demo-sfx-diagram-playhead', 'demo-sfx-diagram-count'] },
    { 'demo-phone-screen': ['demo-phone-screen'], 'demo-stage': ['demo-phone'], 'demo-sfx': ['demo-sfx-phone-swoosh', 'demo-sfx-phone-tap'] },
    { 'onboarding-bgm': ['onboarding-bgm'], 'demo-accents': ['demo-bgm-chip'] },
    {},
    { 'demo-stage': ['demo-credit'], 'demo-sfx': ['demo-sfx-punchline-ding'] }
];
const sourceAdds = [
    ['demo-sfx-whoosh-air-soft', 'demo-sfx-pop-ding'],
    ['demo-sfx-pop-bubble-big', 'demo-sfx-correct-tone'],
    ['demo-sfx-pop-cork', 'demo-sfx-whoosh-punchy', 'demo-sfx-shimmer-sparkle'],
    ['demo-sfx-diagram-pon', 'demo-sfx-diagram-stack', 'demo-sfx-diagram-playhead', 'demo-sfx-diagram-count'],
    ['demo-sfx-swoosh-up', 'demo-sfx-click-mouse-single'],
    ['onboarding-bgm'], [], ['demo-sfx-ding-single']
];
const keywordRuns = new Map([
    ['c-0003', [[0, 6]]], ['c-0006', [[3, 8]]], ['c-0012', [[3, 6]]],
    ['c-0013', [[0, 5], [6, 9]]], ['c-0016', [[0, 2]]], ['c-0017', [[0, 3]]],
    ['c-0018', [[0, 6]]], ['c-0019', [[0, 3]]]
]);

async function fixture(t) {
    const root = await mkdtemp(join(process.env.AKARI_TEST_SCRATCH || tmpdir(), 'akari-demo-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(join(root, '.akari'), { recursive: true });
    await copyFile(join(sample, 'clip.mp4'), join(root, 'assets', 'サンプル動画.mp4'));
    await writeFile(join(root, 'edit.json'), '{}');
    const uri = pathToFileURL(root).toString();
    const service = new AkariOnboardingServiceImpl();
    service.load = async () => ({ schema: 1, step: 'work', sub: 0, projectUri: uri, imported: true, exampleActive: true });
    const segments = splitOnboardingTokens((await json(join(sample, 'transcript.json'))).tokens.items);
    return { root, uri, service, segments };
}

test('同梱の音源 15 本は出所・ライセンス・price・秒数が記録され、\u4eee\u7f6e\u304dの記述が無い', async t => {
    const sourcesText = await readFile(join(sample, 'audio-sources.json'), 'utf8');
    const sources = JSON.parse(sourcesText);
    assert.equal(sources.schema, 'akari-onboarding-audio-sources/v1');
    assert.equal(sources.sample_id, 'talkinghead-desk-ja-01');
    assert.equal(sources.bundled, true);
    assert.equal(sources.files.length, 15);
    const soundFiles = (await readdir(join(sample, 'audio')))
        .filter(file => file.endsWith('.m4a')).map(file => `audio/${file}`);
    assert.deepEqual(sources.files.map(record => record.file).sort(), [...soundFiles, 'bgm.m4a'].sort());

    const { root, uri, service, segments } = await fixture(t);
    await service.writeExample(uri, join(sample, 'clip.mp4'), segments, segments.length, true, { stage: 8 });
    const edit = await json(join(root, 'edit.json'));
    const audioItems = edit.tracks.filter(track => ['demo-sfx', 'onboarding-bgm'].includes(track.id))
        .flatMap(track => track.items);
    for (const record of sources.files) {
        assert.equal(record.license, 'LicenseRef-AKARI-Sounds-v0', record.file);
        assert.equal(record.price, 0, record.file);
        assert.ok(typeof record.akari_sounds_id === 'string' && record.akari_sounds_id.length > 0 ||
            Array.isArray(record.akari_sounds_id) && record.akari_sounds_id.length > 0 &&
            record.akari_sounds_id.every(id => typeof id === 'string' && id.length > 0), record.file);
        assert.ok(record.source_range_s, record.file);
        assert.ok(record.file_duration_s > 0, record.file);
        assert.ok(record.used_s > 0 && record.used_s <= record.file_duration_s, record.file);
        const data = await readFile(join(sample, record.file));
        assert.equal(record.bytes, data.length, record.file);
        for (const algorithm of ['md5', 'sha256'])
            assert.equal(record[algorithm], createHash(algorithm).update(data).digest('hex'), record.file);
        const sourceId = record.file === 'bgm.m4a' ? 'onboarding-bgm' :
            `demo-${basename(record.file, '.m4a')}`;
        const matching = audioItems.filter(item => item.source.src === sourceId);
        assert.deepEqual(matching.map(item => item.id).sort(), [...record.used_by].sort(), record.file);
        for (const item of matching) assert.equal(item.source.out, record.used_s, item.id);
    }
    assert.equal(sources.total_bytes, sources.files.reduce((sum, record) => sum + record.bytes, 0));
    const metaText = await readFile(join(sample, 'meta.json'), 'utf8');
    for (const text of [sourcesText, metaText])
        assert.doesNotMatch(text, /\u4eee\u7f6e\u304d|\u4e86\u627f\u5f85\u3061|\u672a\u78ba\u5b9a/);
});

test('同梱 24 本が library に届き、旧図解は同梱されない', async t => {
    assert.equal(files.length, 24);
    for (const [origin] of files) assert.equal(await exists(join(sample, origin)), true, origin);
    for (const old of ['automatic', 'dialogue', 'effects', 'diagram', 'finishing'])
        assert.equal(await exists(join(sample, 'overlays', old)), false, old);
    const root = await mkdtemp(join(process.env.AKARI_TEST_SCRATCH || tmpdir(), 'akari-demo-library-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const library = await new AkariOnboardingServiceImpl().ensureSample(root);
    for (const [origin] of files) assert.equal(await exists(join(library, origin)), true, origin);
});

test('段階 0〜8 の edit・字幕・素材コピーと lint', async t => {
    const { root, uri, service, segments } = await fixture(t);
    let expected = {};
    let expectedSources = ['sample'];
    let copied = new Set();
    for (let stage = 0; stage <= 8; stage++) {
        await service.writeExample(uri, join(sample, 'clip.mp4'), segments, segments.length, stage > 0,
            { stage });
        if (stage > 0) {
            for (const [track, ids] of Object.entries(stageItems[stage - 1]))
                expected[track] = [...(expected[track] || []), ...ids];
            expectedSources = [...expectedSources.filter(id => id !== 'onboarding-bgm'),
                ...sourceAdds[stage - 1].filter(id => id !== 'onboarding-bgm')];
            if (stage >= 6) expectedSources.push('onboarding-bgm');
        }
        const edit = await json(join(root, 'edit.json'));
        const captionData = await json(join(root, 'captions.json'));
        const trackIds = ['video', 'demo-phone-screen', 'demo-flash', 'demo-stage', 'demo-accents', 'captions',
            'onboarding-bgm', 'demo-sfx'].filter(id => id === 'video' || id === 'captions' || expected[id]?.length);
        assert.deepEqual(edit.tracks.map(track => track.id), trackIds, `stage ${stage} tracks`);
        for (const track of edit.tracks) {
            if (track.id === 'video') assert.deepEqual(track.items.map(item => item.id), ['sample']);
            else if (track.id === 'captions') assert.deepEqual(track.items.map(item => item.id), ['captions']);
            else assert.deepEqual(track.items.map(item => item.id), [...expected[track.id]].sort((a, b) => {
                const itemA = track.items.find(item => item.id === a);
                const itemB = track.items.find(item => item.id === b);
                return itemA.at - itemB.at;
            }), `stage ${stage} ${track.id}`);
        }
        assert.deepEqual(edit.sources.map(source => source.id), expectedSources, `stage ${stage} sources`);
        assert.equal(captionData.captions.length, 22);
        assert.ok(captionData.captions.every(caption => caption.style_preset !== 'title-impact' && caption.time_domain !== 'output'));
        assert.equal(captionData.captions[18].text, 'BGMも、');
        assert.equal(captionData.captions[18].display_text, 'BGMも，');
        assert.deepEqual([captionData.captions[18].start, captionData.captions[18].end], [29.45, 30.63]);
        assert.equal(captionData.captions[19].text, '字幕のカラオケ表示もいけます。');
        assert.deepEqual([captionData.captions[19].start, captionData.captions[19].end], [30.63, 32.54]);
        for (const caption of captionData.captions) {
            const positions = stage >= 2 ? keywordRuns.get(caption.id) || [] : [];
            assert.deepEqual(caption.runs.map(run => [run.from, run.to]), positions, `stage ${stage} ${caption.id}`);
            for (const run of caption.runs) {
                assert.equal(run.role, 'emphasis');
                assert.equal(run.style.color, '#FB923C');
                assert.equal(run.style.font_weight, 900);
            }
        }
        if (stage >= 7) {
            const karaoke = captionData.captions[19];
            assert.equal(karaoke.style, 'karaoke');
            assert.equal(karaoke.words.length, 13);
            assert.deepEqual(karaoke.words.map(word => word.text).join(''), karaoke.text);
            assert.deepEqual(karaoke.words.map(word => [word.start, word.end]), [
                [30.63, 30.82], [30.82, 31.15], [31.15, 31.24], [31.33, 31.43], [31.43, 31.55],
                [31.55, 31.70], [31.76, 31.82], [31.88, 32.10], [32.10, 32.18], [32.18, 32.26],
                [32.26, 32.33], [32.33, 32.53], [32.53, 32.54]
            ]);
            assert.deepEqual(karaoke.text_style, { karaoke: { done_color: '#FB923C' }, size_px: 62 });
        } else assert.equal(captionData.captions[19].style, undefined);
        for (const track of edit.tracks) for (const item of track.items) {
            const path = item.source.path;
            if (item.source.kind === 'html') copied.add(path);
            if (item.source.kind === 'media' && item.source.src !== 'sample')
                copied.add(edit.sources.find(source => source.id === item.source.src).path);
        }
        for (const [, destination] of files)
            assert.equal(await exists(join(root, destination)), copied.has(destination), `stage ${stage} ${destination}`);
        if ([1, 3, 5, 6, 8].includes(stage)) {
            const lint = await lintProject(root);
            assert.equal(lint.verdict, 'pass', `stage ${stage}: ${JSON.stringify(lint.findings.filter(f => f.severity === 'error'))}`);
        }
        if (stage === 8) {
            for (const track of edit.tracks) {
                if (track.id === 'video' || track.id === 'captions') continue;
                const expectedItems = expectedPlan.stages.flatMap(part => part.items)
                    .filter(entry => entry.track === track.id).map(entry => entry.item)
                    .sort((a, b) => a.at - b.at);
                assert.deepEqual(track.items, expectedItems, `${track.id} matches appendix A`);
            }
            assert.deepEqual(edit.tracks.find(track => track.id === 'video').items[0].keyframes,
                expectedPlan.punch_in_keyframes);
            assert.deepEqual(edit.tracks.find(track => track.id === 'video').items[0].keyframes.map(frame => frame.t),
                [590, 592, 593, 594, 595, 633, 642]);
            const phone = edit.tracks.find(track => track.id === 'demo-phone-screen').items[0];
            assert.deepEqual(phone.crop, { x: .208, y: 0, w: .2645, h: 1 });
            assert.deepEqual(phone.transform, { x: 372, y: -24, scale: .6607 });
            assert.equal(phone.captions, 'off');
            const bgm = edit.tracks.find(track => track.id === 'onboarding-bgm').items[0];
            assert.equal(bgm.gain_db, -14);
            assert.deepEqual(bgm.keyframes.map(frame => frame.gain_db), [0, 0, 8, 8, 0, 0, 10]);
            assert.ok(bgm.keyframes.length <= 8);
            for (const key of ['ducking', 'duck_db', 'duck_attack', 'duck_release'])
                assert.equal(Object.hasOwn(bgm, key), false, key);
            const sfx = edit.tracks.find(track => track.id === 'demo-sfx').items;
            assert.equal(sfx.length, 15);
            assert.ok(sfx.every((item, index) => index === sfx.length - 1 || item.at + item.duration <= sfx[index + 1].at));
            await service.writeExample(uri, join(sample, 'clip.mp4'), segments, segments.length, true);
            assert.deepEqual(await json(join(root, 'edit.json')), edit, 'five arguments produce stage 8');
        }
    }
});

test('お手本のカラオケ段階と完成形は render-cut 経路で GPU 書き出し可能', async t => {
    const { root, uri, service, segments } = await fixture(t);
    for (const stage of [7, 8]) {
        await service.writeExample(uri, join(sample, 'clip.mp4'), segments, segments.length, true, { stage });
        const editSource = await readFile(join(root, 'edit.json'), 'utf8');
        const captionsRoot = await json(join(root, 'captions.json'));
        const { edit } = readRenderEdit(editSource, join(root, '.akari', 'render-tmp'), {
            captions: toAnchorCaptions(captionsRoot)
        });
        const plannedCaptions = await loadCaptions(root, edit);
        const loadedOverlays = await loadOverlays(root, edit);
        const eligibility = evaluateGpuEligibility({
            edit: { ...edit, overlays: loadedOverlays },
            captions: plannedCaptions.captions,
            defaultTextStyle: plannedCaptions.defaultTextStyle,
            emphasisWords: plannedCaptions.emphasisWords
        });
        assert.equal(eligibility.eligible, true, `stage ${stage}: ${JSON.stringify(eligibility.entries.filter(entry =>
            entry.classification === 'unsupported' || entry.classification === 'degraded'))}`);
        assert.equal(eligibility.summary.unsupported, 0, `stage ${stage}`);
        assert.equal(eligibility.summary.degraded, 0, `stage ${stage}`);
        const karaoke = captionsRoot.captions.find(caption => caption.id === 'c-0020');
        assert.equal(karaoke.style, 'karaoke', `stage ${stage}`);
        assert.equal(karaoke.text_style.karaoke.done_color, '#FB923C', `stage ${stage}`);
        assert.equal(Object.hasOwn(karaoke.text_style.karaoke, 'fill'), false, `stage ${stage}`);
        assert.equal(Object.hasOwn(karaoke.text_style.karaoke, 'start_index'), false, `stage ${stage}`);
        assert.deepEqual(eligibility.entries.find(entry => entry.kind === 'caption' && entry.id === karaoke.id)?.classification,
            'same', `stage ${stage}`);
    }
});

test('既定段階と不正な段階、書き起こし欠落時の後退', async t => {
    const { root, uri, service, segments } = await fixture(t);
    const source = join(sample, 'clip.mp4');
    await service.writeExample(uri, source, segments, 1, true);
    assert.deepEqual((await json(join(root, 'edit.json'))).tracks.map(track => track.id),
        ['video', 'demo-stage', 'captions', 'demo-sfx']);
    for (const [progress, title] of [[{ stage: 9 }, true], [{ stage: 1.5 }, true], [{ stage: 2 }, false]])
        await assert.rejects(service.writeExample(uri, source, segments, segments.length, title, progress),
            /お手本の段階が不正です/);
    const library = await mkdtemp(join(process.env.AKARI_TEST_SCRATCH || tmpdir(), 'akari-no-transcript-'));
    t.after(() => rm(library, { recursive: true, force: true }));
    await copyFile(source, join(library, 'clip.mp4'));
    for (const [origin] of files) {
        await mkdir(dirname(join(library, origin)), { recursive: true });
        await copyFile(join(sample, origin), join(library, origin));
    }
    await service.writeExample(uri, join(library, 'clip.mp4'), segments, segments.length, true, { stage: 7 });
    const captions = (await json(join(root, 'captions.json'))).captions;
    assert.equal(captions[18].text, 'BGMも、字幕のカラオケ');
    assert.equal(captions[19].style, undefined);
});

test('reset は利用者が変更した写しだけ残す', async t => {
    const { root, uri, service, segments } = await fixture(t);
    await service.writeExample(uri, join(sample, 'clip.mp4'), segments, segments.length, true);
    const changedOverlay = join(root, 'overlays', 'demo-title', 'fragment.html');
    const changedSound = join(root, 'assets', 'onboarding', 'sfx-pop-ding.m4a');
    await writeFile(changedOverlay, 'owner overlay');
    await writeFile(changedSound, 'owner sound');
    await service.resetTourExample(uri, join(sample, 'clip.mp4'), segments);
    assert.equal(await readFile(changedOverlay, 'utf8'), 'owner overlay');
    assert.equal(await readFile(changedSound, 'utf8'), 'owner sound');
    for (const [, destination] of files) {
        if ([changedOverlay, changedSound].includes(join(root, destination))) continue;
        assert.equal(await exists(join(root, destination)), false, destination);
    }
    assert.equal(await exists(join(root, 'overlays', 'demo-chat')), false);
    assert.equal(await exists(join(root, 'overlays', 'demo-title')), true);
    assert.equal(await exists(join(root, 'assets', 'onboarding')), true);
    assert.equal(await exists(join(root, 'captions.json')), false);
    assert.deepEqual((await json(join(root, 'edit.json'))).tracks, []);
    assert.ok((await readdir(join(root, 'assets', 'onboarding'))).includes('sfx-pop-ding.m4a'));
});

test('reset は原本どおりの写しと空の専用ディレクトリを片付ける', async t => {
    const { root, uri, service, segments } = await fixture(t);
    await service.writeExample(uri, join(sample, 'clip.mp4'), segments, segments.length, true);
    await service.resetTourExample(uri, join(sample, 'clip.mp4'), segments);
    for (const name of overlays) assert.equal(await exists(join(root, 'overlays', name)), false, name);
    assert.equal(await exists(join(root, 'assets', 'onboarding')), false);
    assert.equal(await exists(join(root, 'assets')), true);
    assert.equal(await exists(join(root, 'overlays')), true);
});
