import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readHistory, writeHistory } = require('../lib/node/history.js');

test('history written through a symlink is read from the canonical project', async () => {
    const base = await mkdtemp(join(tmpdir(), 'akari-chat-history-'));
    const actual = join(base, 'actual');
    const alias = join(base, 'alias');
    try {
        await mkdir(actual);
        await symlink(actual, alias);
        const history = { version: 1, sessions: [{ id: 'one', agent: 'claude', sessionRef: 'ref',
            title: 'one', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }] };
        await writeHistory(`${alias}/`, history);
        assert.deepEqual(await readHistory(actual), history);
        assert.deepEqual(JSON.parse(await readFile(join(actual, '.akari/chat/sessions.json'), 'utf8')), history);
    } finally { await rm(base, { recursive: true, force: true }); }
});

test('history read errors are exposed instead of looking empty', async () => {
    const base = await mkdtemp(join(tmpdir(), 'akari-chat-history-'));
    try {
        await mkdir(join(base, '.akari/chat'), { recursive: true });
        await mkdir(join(base, '.akari/chat/sessions.json'));
        await assert.rejects(readHistory(base));
    } finally { await rm(base, { recursive: true, force: true }); }
});
