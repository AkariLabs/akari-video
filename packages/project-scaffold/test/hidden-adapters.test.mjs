import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFallbackTemplate } from '../src/index.mjs';

test('scaffold の fallback workflow は全スキルリンク置き場を隠す', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-hidden-adapters-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFallbackTemplate(root);
    const workflow = JSON.parse(await readFile(join(root, '.akari', 'workflow.json'), 'utf8'));
    for (const adapter of ['.agents', '.codex', '.cursor', '.opencode', '.devin']) {
        assert.ok(workflow.tree.hidden.includes(adapter), adapter);
    }
});
