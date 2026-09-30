import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AkariOnboardingServiceImpl } from '../../lib/node/onboarding-service.js';
import { splitOnboardingTokens } from '../../lib/onboarding/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const sample = join(here, '../../../../resources/onboarding-sample/talkinghead-desk-ja-01');
const timingFile = join(here, '../../evidence/onboarding-demo-production/analysis/word-timing.json');
const LEGACY_DIGEST = 'b384cae62959224be1c65d036da836ce53023169f0aa778afc1dffd307696c69';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

test('同梱の書き起こしは声で合わせ直した語の時刻（word-timing.json）と一致する', async () => {
    const transcript = await readJson(join(sample, 'transcript.json'));
    const timing = await readJson(timingFile);
    const tokens = transcript.tokens.items;
    assert.equal(tokens.length, 131);
    assert.equal(tokens.length, timing.tokens.length);
    tokens.forEach((token, index) => {
        const expected = timing.tokens[index];
        assert.deepEqual({ t: token.t, start: token.start, end: token.end },
            { t: expected.t, start: expected.start, end: expected.end }, `token ${index}`);
        assert.ok(token.end >= token.start, `token ${index}: end >= start`);
        if (index) assert.ok(token.start >= tokens[index - 1].end, `token ${index}: 前の語と重ならない`);
    });
    assert.deepEqual(tokens.slice(5, 8).map(token => token.t), ['ア', 'カ', 'リ']);
    assert.match(transcript.tokens.precision, /^2026-10-01 声の 10ms 包絡と口の開閉で合わせ直し。語頭 ±0\.05〜0\.10 s$/);
    assert.match(transcript.segments.items[0].text, /アカリビデオ/);
    assert.doesNotMatch(JSON.stringify(transcript), /あかり/);
    // 台本の本文（句読点・空白を除く）と語の連結が同じ = 文字列・個数・順序はそのまま
    const plain = text => text.replace(/[\s、。！？!?,，]/gu, '');
    assert.equal(plain(tokens.map(token => token.t).join('')), plain(transcript.script));
});

test('字幕の区切りは 22 行のまま、時刻だけが声に合う（captions_after_realign と一致）', async () => {
    const transcript = await readJson(join(sample, 'transcript.json'));
    const timing = await readJson(timingFile);
    const captions = splitOnboardingTokens(transcript.tokens.items);
    assert.equal(captions.length, 22);
    assert.deepEqual(captions.map((caption, index) => ({
        id: `c-${String(index + 1).padStart(4, '0')}`, start: caption.start, end: caption.end, text: caption.text
    })), timing.captions_after_realign);
    // 見せ場の語は、字幕の出始めがその語頭（声の立ち上がり）に来る
    const startOf = text => captions.find(caption => caption.text.startsWith(text))?.start;
    assert.equal(startOf('こんにちは'), 0.29);
    assert.equal(startOf('アカリビデオ'), 3.59);
    assert.equal(startOf('エフェクト'), 18.74);
    assert.equal(startOf('図解'), 23.78);
    assert.equal(startOf('BGM'), 29.45);
});

test('既定の旧版ダイジェストは語の時刻を合わせ直す前の同梱 transcript.json だけ', () => {
    assert.deepEqual([...new AkariOnboardingServiceImpl().legacyTranscriptDigests], [LEGACY_DIGEST]);
});

async function library(t, content) {
    const root = await mkdtemp(join(process.env.AKARI_TEST_SCRATCH || tmpdir(), 'akari-sample-transcript-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const destination = join(root, 'library', 'broll', 'talkinghead-desk-ja-01');
    if (content !== undefined) {
        await mkdir(destination, { recursive: true });
        await writeFile(join(destination, 'transcript.json'), content);
    }
    return { root, transcript: join(destination, 'transcript.json') };
}

// 旧版の実物（sha256 b384cae6…）は git の履歴にしか無いので、形の同じ偽の旧版で置き換えの規則を確かめる
async function fakeLegacy() {
    const bundled = await readJson(join(sample, 'transcript.json'));
    const legacy = structuredClone(bundled);
    legacy.tokens.precision = '概算。';
    legacy.tokens.items = legacy.tokens.items.map(token => ({ ...token, start: Math.max(0, token.start - 1), end: Math.max(0, token.end - 1) }));
    return JSON.stringify(legacy, null, 2);
}

for (const [name, lineEnding] of [['LF', '\n'], ['CRLF', '\r\n']]) {
    test(`ライブラリに残った旧版の書き起こし（${name}）は同梱版へ置き換わる`, async t => {
        const legacy = (await fakeLegacy()).replaceAll('\n', lineEnding);
        const setup = await library(t, legacy);
        const service = new AkariOnboardingServiceImpl();
        service.legacyTranscriptDigests = [sha256(legacy.replaceAll('\r\n', '\n'))];
        await service.ensureSample(setup.root);
        assert.equal(sha256(await readFile(setup.transcript)), sha256(await readFile(join(sample, 'transcript.json'))));
    });
}

test('利用者が手を入れた書き起こしは置き換えない', async t => {
    const edited = (await fakeLegacy()).replace('概算。', '自分で直した');
    const setup = await library(t, edited);
    const service = new AkariOnboardingServiceImpl();
    service.legacyTranscriptDigests = [sha256(await fakeLegacy())];
    await service.ensureSample(setup.root);
    assert.equal(await readFile(setup.transcript, 'utf8'), edited);
});

test('書き起こしがまだ無ければ同梱版をそのまま置く', async t => {
    const setup = await library(t, undefined);
    await new AkariOnboardingServiceImpl().ensureSample(setup.root);
    assert.equal(sha256(await readFile(setup.transcript)), sha256(await readFile(join(sample, 'transcript.json'))));
});
