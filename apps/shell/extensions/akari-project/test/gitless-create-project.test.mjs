import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

class GitlessProjectService extends AkariProjectServiceImpl {
    watched = false;

    fsPath(uri) {
        return uri;
    }

    async findTemplate() {
        return undefined;
    }

    async writeFallbackTemplate(root) {
        await mkdir(join(root, '.akari'), { recursive: true });
        await writeFile(join(root, 'edit.json'), '{}\n', 'utf8');
    }

    async installProjectSkills() {}

    async ensureRuntimeDirectories() {}

    async runGit() {
        throw new Error('xcode-select: note: No developer tools were found, requesting install.');
    }

    async watchProject() {
        this.watched = true;
    }
}

test('createProject: git 初期化失敗を警告に留めて watchProject へ進む', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-project-gitless-test-'));
    const service = new GitlessProjectService();
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
        await service.createProject(root);

        assert.equal(await readFile(join(root, 'edit.json'), 'utf8'), '{}\n');
        assert.equal(service.watched, true);
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0][0], '[akari-project] initial git init failed:');
        assert.match(String(warnings[0][1]), /xcode-select: note/);
    } finally {
        console.warn = originalWarn;
        await rm(root, { recursive: true, force: true });
    }
});
