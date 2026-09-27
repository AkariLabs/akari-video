import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { lintProject } from '../../../../../../packages/edit-lint/src/edit-lint.mjs';

const require = createRequire(import.meta.url);
const {
    INITIAL_ONBOARDING_STATE, ONBOARDING_STEPS, parseOnboardingState,
    COUNTED_ONBOARDING_STEPS, nextOnboardingState, shouldResumeOnboarding, partnerToConnect,
    onboardingCount, previousOnboardingStep, onboardingRevisit,
    createEmptyOnboardingEdit, createOnboardingEdit, createOnboardingCaptions, splitOnboardingTokens
} = require('../../lib/onboarding/model.js');
const segments = [
    { start: 0.3, end: 1.1, text: 'こんにちは。' },
    { start: 1.3, end: 2.1, text: '今日はですね。' },
    { start: 2.3, end: 3.1, text: '動画を編集します。' },
    { start: 3.3, end: 4.1, text: 'AI に頼みます。' },
    { start: 4.3, end: 5.1, text: '字幕を入れます。' },
    { start: 5.3, end: 6.1, text: 'タイトルも入れます。' },
    { start: 6.3, end: 7.1, text: 'できました。' }
];

test('案内は17段で、実演の9段だけを数える', () => {
    assert.equal(ONBOARDING_STEPS.length, 17);
    assert.equal(COUNTED_ONBOARDING_STEPS.length, 9);
    for (const step of ['welcome', 'first', 'invite', 'tour0', 'tour1', 'tour2', 'tour3', 'done'])
        assert.equal(onboardingCount(step), undefined);
    assert.deepEqual(onboardingCount('drag'), { current: 1, total: 9 });
    assert.deepEqual(onboardingCount('export'), { current: 9, total: 9 });
    let state = INITIAL_ONBOARDING_STATE;
    for (const step of ONBOARDING_STEPS.slice(1)) state = nextOnboardingState(state, step);
    assert.equal(state.step, 'done');
    assert.equal(state.completed, true);
    assert.deepEqual(createEmptyOnboardingEdit(), {
        version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [], tracks: []
    });
});

test('戻るの順序と再訪は完了済みの成果を維持する', () => {
    assert.equal(previousOnboardingStep('tour0'), undefined);
    assert.equal(previousOnboardingStep('tour1'), undefined);
    assert.equal(previousOnboardingStep('tour2'), 'tour1');
    assert.equal(previousOnboardingStep('drag'), 'tour3');
    assert.equal(previousOnboardingStep('play'), 'prompt');
    assert.equal(previousOnboardingStep('work'), undefined);
    const completed = { ...INITIAL_ONBOARDING_STATE, imported: true, materialOpened: true, workCompleted: true };
    assert.equal(onboardingRevisit({ ...completed, step: 'drag' }), 'imported');
    assert.equal(onboardingRevisit({ ...completed, step: 'matpreview' }), 'previewed');
    assert.equal(onboardingRevisit({ ...completed, step: 'prompt' }), 'completed');
    const backward = nextOnboardingState(completed, 'prompt');
    assert.equal(backward.imported, true);
    assert.equal(backward.workCompleted, true);
    assert.equal(shouldResumeOnboarding({ ...backward, projectUri: 'file:///project' }, 'file:///project'), true);
});

test('保存形式を検査し、同じプロジェクトでのみ中断段から再開する', () => {
    const state = { schema: 1, step: 'caption', sub: 2, answer: 'chatgpt', projectUri: 'file:///project', imported: true };
    assert.deepEqual(parseOnboardingState(JSON.parse(JSON.stringify(state))), {
        ...state, samplePath: undefined, exampleActive: false, workCompleted: false,
        materialOpened: false, played: false, completed: false
    });
    assert.equal(shouldResumeOnboarding(parseOnboardingState(state), 'file:///project'), true);
    assert.equal(shouldResumeOnboarding({ ...state, projectUri: 'file:///C:/Project/First' }, 'file:///c%3A/project/first'), true);
    assert.equal(shouldResumeOnboarding(parseOnboardingState(state)), true);
    assert.equal(shouldResumeOnboarding(parseOnboardingState(state), 'file:///other'), false);
    assert.equal(shouldResumeOnboarding({ ...state, completed: true }, 'file:///project'), false);
    assert.equal(parseOnboardingState({ ...state, step: 'sign-in' }), undefined);
    assert.equal(parseOnboardingState({ ...state, sub: -1 }), undefined);
});

test('最後の接続先は回答に従い、未使用・その他には表示しない', () => {
    assert.equal(partnerToConnect('claude'), 'Claude Code CLI');
    assert.equal(partnerToConnect('chatgpt'), 'Codex CLI');
    assert.equal(partnerToConnect('google'), 'Antigravity CLI');
    assert.equal(partnerToConnect('none'), undefined);
    assert.equal(partnerToConnect('other'), undefined);
});

test('同梱の語時刻から短い一行字幕を決定的に作る', async () => {
    const transcript = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)),
        '../../../../resources/onboarding-sample/talkinghead-desk-ja-01/transcript.json'), 'utf8'));
    const result = splitOnboardingTokens(transcript.tokens.items);
    assert.ok(result.length > 7);
    assert.equal(result.map(item => item.text).join(''), transcript.tokens.items.map(item => item.t).join(''));
    assert.ok(result.every(item => item.text.length <= 14 && item.end > item.start));
    assert.deepEqual(result, splitOnboardingTokens(transcript.tokens.items));
});

test('お手本の本編、1行ずつの字幕、右上タイトルが edit-lint を通る', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const dir = await mkdtemp(join(here, '.onboarding-test-'));
    try {
        await mkdir(join(dir, 'assets'));
        await mkdir(join(dir, '.akari'));
        await writeFile(join(dir, 'assets', 'sample.txt'), 'test fixture');
        for (const count of [0, 1, 4, 7]) {
            const title = count === 7;
            const edit = createOnboardingEdit('assets/sample.txt', count > 0);
            const captions = createOnboardingCaptions(segments, count, title);
            assert.equal(captions.captions.filter(caption => caption.sourceRef !== null).length, count);
            if (title) {
                const item = captions.captions.find(caption => caption.id === 'c-0008');
                assert.equal(item.text_style.zone, 'top-right');
                assert.ok(item.text_style.background);
            }
            await writeFile(join(dir, 'edit.json'), JSON.stringify(edit));
            await writeFile(join(dir, 'captions.json'), JSON.stringify(captions));
            const result = await lintProject(dir);
            assert.deepEqual(result.findings.filter(finding => finding.severity === 'error'), [],
                `count=${count}: ${JSON.stringify(result.findings)}`);
        }
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
