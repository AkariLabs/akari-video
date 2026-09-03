import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
    applyHistoryPolicy,
    GENERATED_MEDIA_EXTENSIONS,
    hasGeneratedMediaExtension,
    HISTORY_BLOCK_BEGIN,
    HISTORY_BLOCK_END,
    LEGACY_PROJECT_GITIGNORES,
    PROJECT_GITIGNORE
} from '../src/history-policy.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function isIgnored(root, candidate) {
    try {
        execFileSync('git', ['-C', root, 'check-ignore', '-q', '--no-index', '--', candidate], { stdio: 'pipe' });
        return true;
    } catch (error) {
        if (error.status === 1) {
            return false;
        }
        throw error;
    }
}

test('雛形の .gitignore: issue #48 の期待表どおりに分かれる（git check-ignore で実測）', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-history-policy-'));
    try {
        execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'pipe' });
        await writeFile(path.join(root, '.gitignore'), PROJECT_GITIGNORE, 'utf8');

        const expected = new Map([
            ['exports/final.mp4', true],
            ['assets/IMG_0001.MOV', true],
            ['exports/.gitkeep', false],
            ['assets/.gitkeep', false],
            ['.akari/sidecars/shot-01/proxy.mp4', false],
            ['.akari/reports/contact-sheet.png', true],
            ['.akari/reports/export-check/result.json', false],
            ['.akari/work/base.mp4', true],
            ['.akari/work/notes.json', false],
            ['edit.json', false],
            ['captions.json', false],
            ['planning/plan.md', false],
            ['.akari/events/2026-09-03-export-completed.json', false]
        ]);
        for (const [candidate, ignored] of expected) {
            assert.equal(isIgnored(root, candidate), ignored, `${candidate} の判定が期待と違う`);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('雛形の .gitignore: 90 GB 問題の実体（書き出し中間・一時領域・キャッシュ）を除外する', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-history-policy-'));
    try {
        execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'pipe' });
        await writeFile(path.join(root, '.gitignore'), PROJECT_GITIGNORE, 'utf8');

        for (const candidate of [
            'exports/master.gpu-video.mp4',
            'exports/master.osr-video.mp4',
            '.akari/render-tmp/2026-09-03-run/frame-000001.png',
            '.akari/cache/thumbnails/a1b2.jpg',
            '.akari/diffs/1756800000000/before/edit.json'
        ]) {
            assert.equal(isIgnored(root, candidate), true, `${candidate} が履歴に入ってしまう`);
        }
        // 消えると困るテキストの正本は残す。
        for (const candidate of [
            'motion/camera.json',
            'exports/nle/timeline.xml',
            '.akari/diffs/.gitkeep',
            '.akari/sidecars/.gitkeep',
            '.akari/work/keep/semantic-keep-plan.json'
        ]) {
            assert.equal(isIgnored(root, candidate), false, `${candidate} が履歴から落ちる`);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('拡張子の集合は 1 つ: 雛形の除外行と hasGeneratedMediaExtension が一致する', () => {
    const patterns = PROJECT_GITIGNORE.split('\n').filter(line => /^\*\.[a-z0-9]+$/.test(line));
    assert.deepEqual(patterns, GENERATED_MEDIA_EXTENSIONS.map(extension => `*${extension}`));
    for (const extension of GENERATED_MEDIA_EXTENSIONS) {
        assert.equal(hasGeneratedMediaExtension(`exports/final${extension}`), true);
        assert.equal(hasGeneratedMediaExtension(`exports/final${extension.toUpperCase()}`), true);
    }
});

test('hasGeneratedMediaExtension: 拡張子の無いファイルと隠しファイルを取り違えない', () => {
    for (const candidate of ['.gitignore', 'planning/.gitkeep', 'akari.sh', 'edit.json', 'README', 'a/.mp4x']) {
        assert.equal(hasGeneratedMediaExtension(candidate), false, `${candidate} を生成物と誤判定した`);
    }
    assert.equal(hasGeneratedMediaExtension('a\\b\\clip.MP4'), true);
    assert.equal(hasGeneratedMediaExtension(undefined), false);
});

test('applyHistoryPolicy: 無い / 空 / 旧世代そのまま は全文を差し替える', () => {
    assert.deepEqual(applyHistoryPolicy(undefined), { text: PROJECT_GITIGNORE, changed: true, mode: 'created' });
    assert.deepEqual(applyHistoryPolicy('\n \n'), { text: PROJECT_GITIGNORE, changed: true, mode: 'created' });
    for (const legacy of LEGACY_PROJECT_GITIGNORES) {
        assert.deepEqual(applyHistoryPolicy(legacy), { text: PROJECT_GITIGNORE, changed: true, mode: 'replaced' });
    }
});

test('applyHistoryPolicy: 現行の全文は何も変えない', () => {
    assert.deepEqual(applyHistoryPolicy(PROJECT_GITIGNORE), {
        text: PROJECT_GITIGNORE,
        changed: false,
        mode: 'unchanged'
    });
});

test('applyHistoryPolicy: 利用者が書き足した行は消さず、囲みの中だけを入れ替える', () => {
    const outdatedBlock = [
        '# わたしのメモ',
        'scratch/**',
        '',
        HISTORY_BLOCK_BEGIN,
        '*.mp4',
        HISTORY_BLOCK_END,
        '',
        'notes.local.md',
        ''
    ].join('\n');
    const outcome = applyHistoryPolicy(outdatedBlock);
    assert.equal(outcome.mode, 'updated-block');
    assert.match(outcome.text, /^# わたしのメモ\nscratch\/\*\*\n/);
    assert.match(outcome.text, /\nnotes\.local\.md\n$/);
    assert.ok(outcome.text.includes('!.akari/sidecars/**'));
    // 2 回目は不動点。
    assert.deepEqual(applyHistoryPolicy(outcome.text), { text: outcome.text, changed: false, mode: 'unchanged' });
});

test('applyHistoryPolicy: 書き換え済みで囲みが無ければ末尾へ足す（既存の行は残す）', () => {
    const customized = '# 自分で書いた\n*.psd\n';
    const outcome = applyHistoryPolicy(customized);
    assert.equal(outcome.mode, 'appended');
    assert.ok(outcome.text.startsWith(customized));
    assert.ok(outcome.text.includes(HISTORY_BLOCK_BEGIN));
    assert.deepEqual(applyHistoryPolicy(outcome.text), { text: outcome.text, changed: false, mode: 'unchanged' });
});

test('雛形ファイルと定数が drift していない（npm 配布では .gitignore が剥がされ定数が雛形になる）', async () => {
    const template = await readFile(path.join(REPO_ROOT, 'templates', 'project-default', '.gitignore'), 'utf8');
    assert.equal(template, PROJECT_GITIGNORE);
});
