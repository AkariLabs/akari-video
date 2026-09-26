import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtemp, mkdir, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

test('installSkillAdapters は Devin のスキル入口を .claude/skills へ張る', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-devin-skills-'));
    const service = new AkariProjectServiceImpl();
    service.fsImpl = fs;
    try {
        await mkdir(join(root, '.claude', 'skills', 'analyze-footage'), { recursive: true });
        await service.installSkillAdapters(root);
        assert.equal(await readlink(join(root, '.devin', 'skills', 'analyze-footage')),
            '../../.claude/skills/analyze-footage');
        assert.equal(await readlink(join(root, '.agents', 'skills', 'analyze-footage')),
            '../../.claude/skills/analyze-footage');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
