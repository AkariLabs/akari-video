import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { PROJECT_GITIGNORE } from 'akari-video/src/history-policy.mjs';

import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

const execFileAsync = promisify(execFile);

const LEGACY_GITIGNORE = [
    '# Source video and audio are intentionally kept outside the project history.',
    'assets/**',
    '!assets/.gitkeep',
    '',
    '# Temporary files used by the friendly "変更を見る" view.',
    '.akari/diffs/**',
    '!.akari/diffs/.gitkeep',
    '',
    '# Local operating-system files.',
    '.DS_Store',
    'Thumbs.db',
    ''
].join('\n');

class MigrationService extends AkariProjectServiceImpl {
    fsPath(uri) {
        return uri;
    }
}

async function git(root, args) {
    return execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

async function writeAll(root, files) {
    for (const [relative, content] of Object.entries(files)) {
        const destination = join(root, relative);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content, 'utf8');
    }
}

async function trackedFiles(root) {
    const { stdout } = await git(root, ['ls-files']);
    return stdout.split('\n').filter(Boolean);
}

/** 節目の自動スナップショットと同じ内容で 1 本コミットしたプロジェクトを組む。 */
async function legacyProject(files = {}) {
    const root = await mkdtemp(join(tmpdir(), 'akari-history-migration-'));
    await git(root, ['init', '-q']);
    await writeAll(root, {
        '.gitignore': LEGACY_GITIGNORE,
        'edit.json': '{}\n',
        'captions.json': '[]\n',
        'planning/plan.md': '# 企画\n',
        'exports/.gitkeep': '',
        'exports/final.mp4': 'video-bytes',
        'exports/master.gpu-video.mp4': 'intermediate-bytes',
        '.akari/reports/contact-sheet.png': 'image-bytes',
        '.akari/reports/export-check/result.json': '{"ok":true}\n',
        '.akari/render-tmp/run-1/frame-000001.png': 'frame-bytes',
        '.akari/sidecars/shot-01/proxy.mp4': 'proxy-bytes',
        '.akari/events/2026-09-03-export-completed.json': '{"type":"export-completed"}\n',
        ...files
    });
    await git(root, ['add', '-A', '--', '.']);
    await git(root, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', '動画を書き出し']);
    return root;
}

test('プロジェクトを開いたとき: 旧世代の .gitignore を書き換え、生成物を履歴から外す', async () => {
    const root = await legacyProject();
    try {
        const before = await trackedFiles(root);
        assert.ok(before.includes('exports/final.mp4'), '前提: 旧世代では書き出しが履歴に入る');
        assert.ok(before.includes('.akari/render-tmp/run-1/frame-000001.png'));

        await new MigrationService().migrateHistoryPolicy(root);

        assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), PROJECT_GITIGNORE);
        const after = await trackedFiles(root);
        for (const gone of [
            'exports/final.mp4',
            'exports/master.gpu-video.mp4',
            '.akari/reports/contact-sheet.png',
            '.akari/render-tmp/run-1/frame-000001.png'
        ]) {
            assert.ok(!after.includes(gone), `${gone} が履歴に残っている`);
        }
        for (const kept of [
            'edit.json',
            'captions.json',
            'planning/plan.md',
            'exports/.gitkeep',
            '.akari/reports/export-check/result.json',
            '.akari/sidecars/shot-01/proxy.mp4',
            '.akari/events/2026-09-03-export-completed.json'
        ]) {
            assert.ok(after.includes(kept), `${kept} が履歴から落ちた`);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('プロジェクトを開いたとき: ディスク上のファイルは 1 つも消さない', async () => {
    const root = await legacyProject();
    try {
        await new MigrationService().migrateHistoryPolicy(root);

        for (const relative of [
            'exports/final.mp4',
            'exports/master.gpu-video.mp4',
            '.akari/reports/contact-sheet.png',
            '.akari/render-tmp/run-1/frame-000001.png'
        ]) {
            assert.equal((await stat(join(root, relative))).isFile(), true, `${relative} を消してしまった`);
        }
        assert.equal(await readFile(join(root, 'exports/final.mp4'), 'utf8'), 'video-bytes');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('プロジェクトを開いたとき: 移行は 1 本のコミットで終わり、作業ツリーを汚さない', async () => {
    const root = await legacyProject();
    try {
        await new MigrationService().migrateHistoryPolicy(root);

        const { stdout: status } = await git(root, ['status', '--porcelain']);
        assert.equal(status.trim(), '', '移行後に未コミットの変更が残っている');
        const { stdout: log } = await git(root, ['log', '--format=%s']);
        assert.deepEqual(log.split('\n').filter(Boolean), [
            '変更履歴に入れない生成物を整理（ファイルはそのまま残っています）',
            '動画を書き出し'
        ]);
        // 過去のコミットは書き換えない（.git は横ばい）。
        const { stdout: historical } = await git(root, ['ls-tree', '-r', '--name-only', 'HEAD^']);
        assert.ok(historical.split('\n').includes('exports/final.mp4'));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('プロジェクトを開いたとき: 2 度目は何もしない', async () => {
    const root = await legacyProject();
    try {
        const service = new MigrationService();
        await service.migrateHistoryPolicy(root);
        const { stdout: first } = await git(root, ['rev-parse', 'HEAD']);
        await service.migrateHistoryPolicy(root);
        const { stdout: second } = await git(root, ['rev-parse', 'HEAD']);
        assert.equal(second, first, '変更が無いのにコミットが増えた');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('プロジェクトを開いたとき: 利用者が書き換えた .gitignore は消さず末尾へ足す', async () => {
    const root = await legacyProject({ '.gitignore': `${LEGACY_GITIGNORE}\n# 自分のメモ\nscratch/**\n` });
    try {
        await new MigrationService().migrateHistoryPolicy(root);

        const updated = await readFile(join(root, '.gitignore'), 'utf8');
        assert.ok(updated.includes('# 自分のメモ'), '利用者が書いた行を消した');
        assert.ok(updated.includes('scratch/**'));
        assert.ok(updated.includes('!.akari/sidecars/**'));
        assert.ok(!(await trackedFiles(root)).includes('exports/final.mp4'));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('親リポジトリの中にあるプロジェクトには触れない', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'akari-history-parent-'));
    try {
        await git(parent, ['init', '-q']);
        const root = join(parent, 'projects', 'my-video');
        await writeAll(root, {
            '.gitignore': LEGACY_GITIGNORE,
            'edit.json': '{}\n',
            'exports/final.mp4': 'video-bytes'
        });
        await git(parent, ['add', '-A', '--', '.']);
        await git(parent, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', '取り込み']);

        await new MigrationService().migrateHistoryPolicy(root);

        assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), LEGACY_GITIGNORE);
        assert.ok((await trackedFiles(parent)).includes('projects/my-video/exports/final.mp4'));
    } finally {
        await rm(parent, { recursive: true, force: true });
    }
});

test('git の無いプロジェクトでは黙って何もしない', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-history-gitless-'));
    try {
        await writeAll(root, { '.gitignore': LEGACY_GITIGNORE, 'edit.json': '{}\n' });
        await new MigrationService().migrateHistoryPolicy(root);
        assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), LEGACY_GITIGNORE);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
