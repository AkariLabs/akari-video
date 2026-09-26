import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { lintProject } from '../../../../../../packages/edit-lint/src/edit-lint.mjs';

const require = createRequire(import.meta.url);
const {
    INITIAL_ONBOARDING_STATE, ONBOARDING_STEPS, parseOnboardingState,
    nextOnboardingState, shouldResumeOnboarding, partnerToConnect,
    createEmptyOnboardingEdit, createOnboardingEdit, createOnboardingCaptions
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

test('ガイドは14段で、初回状態から順に進む', () => {
    assert.equal(ONBOARDING_STEPS.length, 14);
    let state = INITIAL_ONBOARDING_STATE;
    for (const step of ONBOARDING_STEPS.slice(1)) state = nextOnboardingState(state, step);
    assert.equal(state.step, 'done');
    assert.equal(state.completed, true);
    assert.deepEqual(createEmptyOnboardingEdit(), {
        version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [], tracks: []
    });
});

test('保存形式を検査し、同じプロジェクトでのみ中断段から再開する', () => {
    const state = { schema: 1, step: 'caption', sub: 2, answer: 'chatgpt', projectUri: 'file:///project', imported: true };
    assert.deepEqual(parseOnboardingState(JSON.parse(JSON.stringify(state))), { ...state, samplePath: undefined, completed: false });
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
